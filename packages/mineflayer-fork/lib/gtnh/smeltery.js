'use strict'

// TiC 冶炼炉 / 浇筑（GTNH 1.7.10）辅助：读方块实体、按槽投料、点水龙头浇铸。
//
// 这一层的线格式与行为都来自实机逆向，见 docs/FINDINGS.md 第二十九节：
//   - tile_entity_data 在 GTNH 上比原版多 1 字节（protocol-fml 的 GTNH_TE_PACKETS 负责）
//   - 冶炼炉槽位「一格一件」，投料必须一件一件塞；熔炼是并行的（槽数决定速度）
//   - 水龙头按自身 direction 找同高的排液口，液体倒进自己脚下那格，需要潜行点击才走 onItemUse

const CURSOR = {
  0: { x: 8, y: 0, z: 8 }, // 底面 -y
  1: { x: 8, y: 16, z: 8 }, // 顶面 +y
  2: { x: 8, y: 8, z: 0 }, // -z
  3: { x: 8, y: 8, z: 16 }, // +z
  4: { x: 0, y: 8, z: 8 }, // -x
  5: { x: 16, y: 8, z: 8 } // +x
}

function teValue (bot, pos) {
  const key = `${pos.x},${pos.y},${pos.z}`
  const te = bot.blockEntities?.get(key)
  return te && te.value ? te.value : null
}

function plain (tag) {
  if (!tag || typeof tag !== 'object') return tag
  if ('value' in tag && 'type' in tag) return plain(tag.value)
  if (Array.isArray(tag)) return tag.map(plain)
  const out = {}
  for (const k of Object.keys(tag)) out[k] = plain(tag[k])
  return out
}

// 冶炼炉控制器：{ valid, layers, maxLiquid, direction, liquids: [{ fluid, amount }] }
function readSmeltery (bot, pos) {
  const v = teValue(bot, pos)
  if (!v) return null
  const liq = plain(v.Liquids) || []
  return {
    valid: !!plain(v.ValidStructure),
    layers: plain(v.Layers) || 0,
    maxLiquid: plain(v.MaxLiquid) || 0,
    direction: plain(v.Direction) ?? 0,
    // 每 1440mb 容量对应 1 个内部方块 = 1 格 = 1 件并行的熔炼位
    capacity: Math.round((plain(v.MaxLiquid) || 0) / 1440),
    liquids: (Array.isArray(liq) ? liq : []).map((l) => ({ fluid: l.FluidName, amount: l.Amount })),
    raw: plain(v)
  }
}

// 冶炼炉里某流体的总量（默认取第一种）
function smelteryAmount (bot, pos, fluid) {
  const s = readSmeltery(bot, pos)
  if (!s) return 0
  if (!fluid) return s.liquids.reduce((a, l) => a + l.amount, 0)
  return s.liquids.filter((l) => l.fluid === fluid).reduce((a, l) => a + l.amount, 0)
}

// 浇筑台/盆：{ hasLiquid, capacity, items: [...], maxDelay }
function readCastingBlock (bot, pos) {
  const v = teValue(bot, pos)
  if (!v) return null
  const items = plain(v.Items) || []
  return {
    hasLiquid: !!plain(v.hasLiquid),
    capacity: plain(v.Capacity) || 0,
    items: Array.isArray(items) ? items : [],
    maxDelay: plain(v.maxCastingDelay) || 0,
    raw: plain(v)
  }
}

// 储罐：{ fluid, amount }
function readTank (bot, pos) {
  const v = teValue(bot, pos)
  if (!v) return null
  return { fluid: plain(v.fluidName) || null, amount: plain(v.amount) || 0 }
}

// 往冶炼炉里投料：每格一件（SmelteryLogic.getInventoryStackLimit() == 1）。
// 用 shift 点击把玩家物品推进炉子槽（服务端 transferStackInSlot 每次只转移 1 件）。
// entries = [{ slot, type, count, metadata }]，返回重开窗口后确认的已投入件数。
async function insertIntoSmeltery (bot, smelteryPos, entries, opts = {}) {
  const S = { x: smelteryPos.x, y: smelteryPos.y, z: smelteryPos.z }
  const open = async () => {
    const block = bot.blockAt(new bot.entity.position.constructor(S.x, S.y, S.z))
    if (!block) throw new Error('insertIntoSmeltery: 方块未加载 ' + JSON.stringify(S))
    bot.lookAt(block.position.offset(0.5, 0.5, 0.5), true)
    await new Promise((r) => setTimeout(r, 250))
    bot.activateBlock(block)
    for (let i = 0; i < 25 && !bot.currentWindow; i++) await new Promise((r) => setTimeout(r, 150))
    if (!bot.currentWindow) throw new Error('insertIntoSmeltery: 窗口没打开')
    return bot.currentWindow
  }
  const filled = (w) => {
    const n = Math.max(0, w.slots.length - 36)
    let c = 0
    for (let i = 0; i < n; i++) if (w.slots[i]) c++
    return c
  }

  let w = await open()
  const before = filled(w)
  const invStart = w.slots.length - 36
  const winSlot = (slot) => (slot >= 36 ? invStart + 27 + (slot - 36) : invStart + (slot - 9))
  try {
    for (const e of entries) {
      if (!bot.inventory.items().some((i) => i.slot === e.slot && i.type === e.type)) continue
      await bot.clickWindow(winSlot(e.slot), 0, 1)
      await new Promise((r) => setTimeout(r, 350))
    }
  } finally {
    await bot.closeWindow(w)
  }
  await new Promise((r) => setTimeout(r, 600))
  w = await open()
  const after = filled(w)
  await bot.closeWindow(w)
  return Math.max(0, after - before)
}

// 放水龙头：潜行 + 点排液口朝向自己的那个面，方向才会指向排液口。
// faucetPos 必须与 drainPos 同高且水平相邻；返回放置后的方块是否就位。
async function placeFaucet (bot, faucetPos, drainPos) {
  const Item = require('./items')(bot)
  const f = { x: faucetPos.x, y: faucetPos.y, z: faucetPos.z }
  const d = { x: drainPos.x, y: drainPos.y, z: drainPos.z }
  const dx = f.x - d.x; const dz = f.z - d.z
  let face = null
  if (dx === 1) face = { dir: 5, cx: 0, cz: 8 }      // 点排液口的 +x 面 → 落在它东侧，朝 -x
  else if (dx === -1) face = { dir: 4, cx: 16, cz: 8 } // 点 -x 面 → 落在西侧，朝 +x
  else if (dz === 1) face = { dir: 2, cx: 8, cz: 0 }   // 点 -z 面 → 落在南侧，朝 +z
  else if (dz === -1) face = { dir: 3, cx: 8, cz: 16 } // 点 +z 面 → 落在北侧，朝 -z
  if (!face) throw new Error('placeFaucet: 水龙头必须与排液口水平相邻')
  const held = bot.heldItem && bot.heldItem.type === 568 ? bot.heldItem : null
  if (!held) throw new Error('placeFaucet: 手上不是水龙头物品（568:1）')
  bot.setControlState('sneak', true)
  await new Promise((r) => setTimeout(r, 250))
  try {
    await bot.lookAt(new (require('vec3'))(d.x + 0.5, d.y + 0.5, d.z + 0.5), true)
    bot._client.write('block_place', { location: d, direction: face.dir, heldItem: Item.toNotch(held), cursorX: face.cx, cursorY: 8, cursorZ: face.cz })
    await new Promise((r) => setTimeout(r, 1500))
  } finally {
    bot.setControlState('sneak', false)
  }
  const b = bot.blockAt(new (require('vec3'))(f.x, f.y, f.z))
  return !!(b && b.name === 'TConstruct:SearedBlock' && b.metadata === 1)
}

// 点一下水龙头：潜行 + block_place（走 onItemUse），direction 用「正对它」的那面
async function pourFaucet (bot, faucetPos, face = 1, opts = {}) {
  const block = bot.blockAt(faucetPos)
  if (!block) throw new Error('pourFaucet: 方块未加载 ' + faucetPos)
  const c = CURSOR[face] || CURSOR[1]
  const sneak = opts.sneak === true // 只有在「往排液口上贴水龙头」时才需要潜行
  if (sneak) bot.setControlState('sneak', true)
  try {
    bot.lookAt(block.position.offset(0.5, face === 1 ? 1 : 0.5, 0.5), true)
    await new Promise((r) => setTimeout(r, 200))
    const held = bot.heldItem
    bot._client.write('block_place', {
      location: { x: faucetPos.x, y: faucetPos.y, z: faucetPos.z },
      direction: face,
      heldItem: held ? { blockId: held.type, itemCount: held.count, itemDamage: held.metadata, gtnhFlag: held.count } : { blockId: -1 },
      cursorX: c.x, cursorY: c.y, cursorZ: c.z
    })
  } finally {
    await new Promise((r) => setTimeout(r, 300))
    if (sneak) bot.setControlState('sneak', false)
  }
}

function attachSmeltery (bot) {
    bot.placeFaucet = (faucetPos, drainPos) => placeFaucet(bot, faucetPos, drainPos)
  bot.readSmeltery = (pos) => readSmeltery(bot, pos)
  bot.smelteryAmount = (pos, fluid) => smelteryAmount(bot, pos, fluid)
  bot.readCastingBlock = (pos) => readCastingBlock(bot, pos)
  bot.readTank = (pos) => readTank(bot, pos)
  bot.insertIntoSmeltery = (pos, entries, opts) => insertIntoSmeltery(bot, pos, entries, opts)
  bot.pourFaucet = (pos, face, opts) => pourFaucet(bot, pos, face, opts)
}

module.exports = {
  placeFaucet, attachSmeltery, readSmeltery, smelteryAmount, readCastingBlock, readTank, insertIntoSmeltery, pourFaucet, CURSOR }
