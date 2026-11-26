'use strict'

// TiC 冶炼 → 浇筑台 全链路冒烟（需要服务端已有可用的冶炼炉 / 排液口 / 水龙头 / 浇筑台）
//
//   node tools/smeltery-smoke.js 127.0.0.1 54615 --at 38.5,81,41.5 \
//        --controller 40,81,41 --faucet 41,81,39 --table 41,80,39
//
// 流程：投 9 个铁锭到炉子（一格一件，熔炼是并行的）→ 等 144mb 铁水 →
//       点水龙头浇到浇筑台（台里需先放金铸模 metalPattern:2）→ 冷却后取出镐头
const mineflayer = require('..')
const { rcon } = require('../../protocol-fml/tools/rcon')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1] }
const parsePos = (s, def) => {
  if (!s) return def
  const [x, y, z] = s.split(',').map(Number)
  return { x, y, z }
}
const at = parsePos(opt('at'), { x: 38.5, y: 81, z: 41.5 })
const controller = parsePos(opt('controller'), { x: 42, y: 81, z: 40 })
const faucet = parsePos(opt('faucet'), { x: 41, y: 81, z: 39 })
const table = parsePos(opt('table'), { x: 41, y: 80, z: 39 })
const user = opt('user', 'smokeSmelt')
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms))
const R = (c) => rcon(c, { host })

async function main () {
  const bot = mineflayer.createBot({ host, port, username: user, auth: 'offline', version: '1.7.10', hideErrors: true })
  bot.on('error', () => {})
  await new Promise((res) => bot.once('spawn', res))
  await WAIT(2000)
  const Item = require('../lib/gtnh/items')(bot)
  await R([`gamemode 1 ${user}`, `clear ${user}`, `tp ${user} ${at.x} ${at.y} ${at.z}`])
  await WAIT(4500)

  const sm = bot.readSmeltery(controller)
  if (!sm) throw new Error('读不到冶炼炉方块实体（控制器坐标对吗？）')
  if (!sm.valid) throw new Error('冶炼炉结构无效：' + JSON.stringify(sm.raw).slice(0, 120))
  console.log(`冶炼炉：${sm.layers} 层，上限 ${sm.maxLiquid}mb，当前 ${sm.liquids.map((l) => `${l.fluid} ${l.amount}mb`).join(' / ') || '空'}`)

  // 1) 浇筑台放上金铸模（镐头 = 图案 2）
  const cast = bot.readCastingBlock(table)
  if (!cast) throw new Error('读不到浇筑台方块实体')
  if (!cast.items.length) {
    await bot.creative.setInventorySlot(36, new Item(4526, 1, 2))
    await WAIT(1000)
    const tb = bot.blockAt(table)
    bot.lookAt(tb.position.offset(0.5, 1, 0.5), true)
    await WAIT(200)
    bot._client.write('block_place', {
      location: table, direction: 1, heldItem: { blockId: 4526, itemCount: 1, itemDamage: 2, gtnhFlag: 1 }, cursorX: 8, cursorY: 16, cursorZ: 8
    })
    await WAIT(1500)
    console.log('已把金铸模放到浇筑台：', JSON.stringify(bot.readCastingBlock(table).items))
  }

  // 2) 投 9 个铁锭（一格一件）
  const need = 144
  let have = bot.smelteryAmount(controller, 'iron.molten')
  if (have < need) {
    const want = Math.min(9, Math.ceil((need - have) / 144) + 1)
    await R([`clear ${user}`])
    for (let i = 0; i < want; i++) { await bot.creative.setInventorySlot(36 + i, new Item(265, 1, 0)); await WAIT(250) }
    const entries = bot.inventory.items().filter((i) => i.type === 265).map((i) => ({ slot: i.slot, type: 265, count: 1, metadata: 0 }))
    const placed = await bot.insertIntoSmeltery(controller, entries, { slotLimit: 9 })
    console.log(`投料：${placed} 件`)
    const t0 = Date.now()
    for (let i = 0; i < 30 && bot.smelteryAmount(controller, 'iron.molten') < need; i++) {
      await WAIT(10000)
      const a = bot.smelteryAmount(controller, 'iron.molten')
      console.log(`  t+${Math.round((Date.now() - t0) / 1000)}s ${a}mb`)
    }
  } else {
    console.log(`炉里已有 ${have}mb 铁水，跳过熔炼`)
  }
  const molten = bot.smelteryAmount(controller, 'iron.molten')
  if (molten < need) throw new Error(`铁水不足：${molten}mb`)
  console.log(`铁水 ${molten}mb`)

  // 3) 点水龙头浇一次
  await R([`tp ${user} ${faucet.x + 0.5} ${faucet.y} ${faucet.z - 2.0}`])
  await WAIT(3500)
  await bot.pourFaucet(faucet, 1)
  await WAIT(2500)
  const after = bot.readCastingBlock(table)
  console.log(`浇筑台：hasLiquid=${after.hasLiquid} capacity=${after.capacity} items=${JSON.stringify(after.items)}`)

  // 4) 冷却后取出
  await WAIT(4000)
  const tb = bot.blockAt(table)
  bot.lookAt(tb.position.offset(0.5, 1, 0.5), true)
  await WAIT(200)
  bot._client.write('block_place', { location: table, direction: 1, heldItem: { blockId: -1 }, cursorX: 8, cursorY: 16, cursorZ: 8 })
  await WAIT(2000)
  const inv = bot.inventory.items().map((i) => `${i.name}:${i.metadata}x${i.count}`)
  console.log('背包：', inv.join(',') || '(空)')
  const head = bot.inventory.items().find((i) => i.name === 'TConstruct:pickaxeHead')
  if (!head) throw new Error('没拿到镐头 —— 浇筑失败')
  console.log(`✓ 冶炼→浇筑链路通过（${head.name}:${head.metadata}）`)
  bot.quit()
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1) })
