'use strict'

/*
 * 冒烟脚本共用的场景搭建：清平台、给物品、右键放置、开 GUI。
 *
 * 目的：冒烟脚本不再依赖「用户事先手放在某个坐标的机器」。每个脚本自己铺一小块
 * 石头地、把机器放下来、把 bot 传送过去，跑完不收拾（服务端是测试服）。
 *
 *   const scene = require('./scene')
 *   const R = scene.rconAt(host)
 *   const area = await scene.prepareArena(R, { x: 60, y: 80, z: 60 })   // 铺 9x9 平台并返回中心
 *   await scene.giveItem(bot, Item, { id: 3003, meta: 1, count: 1, slot: 36 })
 *   await scene.placeAt(bot, { x: 60, y: 80, z: 60 }, 1, { type: 3003, meta: 1 })
 *   await scene.openAt(bot, { x: 60, y: 81, z: 60 }, 1)
 *
 * 方向 dir 用协议里的 0-5（0=-y 1=+y 2=-z 3=+z 4=-x 5=+x），CUR 是每面的中心像素坐标。
 */

const { rcon } = require('../../protocol-fml/tools/rcon')
const { Vec3 } = require('vec3')

// 每个面在 16x16 贴图上的中心点（放方块时服务端要这个，否则算不出放置面）
const CUR = { 0: [8, 0, 8], 1: [8, 16, 8], 2: [8, 8, 0], 3: [8, 8, 16], 4: [0, 8, 8], 5: [16, 8, 8] }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const P = (x, y, z) => new Vec3(x, y, z)

function rconAt (host, timeout = 40000) {
  return (commands) => rcon(commands, { host, timeout })
}

/*
 * 清一块场地：上方 3 层空气 + 一层石头地面。区块没加载时 setblock/fill 会失败，
 * 所以先 tp 一个假实体过去把区块拉起来？不行——只能先把玩家 tp 过去再 fill。
 * 因此约定：调用方先把 bot 登录上来，再把它的位置 tp 到场地中心。
 */
async function prepareArena (R, { x, y, z, radius = 1, username }) {
  // 1.7.10 没有 /fill（1.8 才有），只能一格一格 setblock。默认只铺 3x3，
  //   够放一台机器 + 站人；要更大的场地就调 radius。
  // fill 只作用于已加载的区块，所以先 tp 把区块拉起来、等它同步完
  if (username) {
    // 先吊到同区块高空：区块加载了才能 setblock，而且不会卡在地里
    await R([`tp ${username} ${x + 0.5} ${y + 20} ${z + 0.5}`])
    await sleep(2500)
  }
  const cmds = []
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      cmds.push(`setblock ${x + dx} ${y} ${z + dz} minecraft:stone`)
      cmds.push(`setblock ${x + dx} ${y + 1} ${z + dz} minecraft:air`)
      cmds.push(`setblock ${x + dx} ${y + 2} ${z + dz} minecraft:air`)
    }
  }
  const out = await R(cmds)
  // 目标位置已经是同一个方块时 1.7.10 会回 "couldn't be placed"，这是正常噪音
  const failed = out.filter((r) => /error|outside/i.test(String(r)))
  if (failed.length) console.log(`  setblock 有问题（${failed.length}/${out.length}）：`, failed[0])
  await sleep(800)
  return P(x, y, z)
}

/* 把玩家 tp 到某处（机器旁边，别站在机器上——站上去右键点到的是脚下方块） */
async function tpTo (R, username, loc) {
  await R([`tp ${username} ${loc.x} ${loc.y} ${loc.z}`])
  await sleep(1200)
}

/*
 * 往 bot 背包某个槽塞物品（创造模式直接 setInventorySlot，比 /give 稳）。
 * slot 36..44 是快捷栏。
 */
async function giveItem (bot, Item, { id, meta = 0, count = 1, slot }) {
  try {
    await bot.creative.setInventorySlot(slot, new Item(id, count, meta))
  } catch (err) {
    console.log(`  give 失败 id=${id} meta=${meta}: ${err.message}`)
  }
  await sleep(350)
}

/*
 * 右键「方块位置的某一面」把它放下去（创造模式手持方块，右键地面/相邻面）。
 * hold 传 { type, meta } 时先切到那个物品。
 */
async function placeAt (bot, loc, dir = 1, hold = null, waitMs = 1300) {
  if (hold) {
    const item = bot.inventory.items().find((i) => i.type === hold.type && i.metadata === hold.meta)
    if (item) { await bot.equip(item, 'hand'); await sleep(150) }
  }
  const c = CUR[dir]
  await bot.lookAt(P(loc.x + 0.5 + (c[0] - 8) / 32, loc.y + 0.5 + (c[1] - 8) / 32, loc.z + 0.5 + (c[2] - 8) / 32))
  await sleep(120)
  bot._client.write('block_place', { location: loc, direction: dir, heldItem: { blockId: -1 }, cursorX: c[0], cursorY: c[1], cursorZ: c[2] })
  await sleep(waitMs)
}

/*
 * 右键一台机器打开 GUI：先关掉已开的窗口（1.7.10 一次只能开一个），再右键，
 * 等 windowOpen 或 modularOpen（MUI2 的包比 windowOpen 早）。
 */
async function openAt (bot, loc, dir = 1, { timeout = 6000 } = {}) {
  if (bot.currentWindow) {
    bot.closeWindow(bot.currentWindow)
    await sleep(600)
  }
  // 手上还拿着方块的话，右键会「又放一台」而不是打开 GUI；先收起来
  if (bot.heldItem) {
    try { await bot.unequip('hand') } catch {}
    await sleep(250)
  }
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve))
  const modular = new Promise((resolve) => bot.once('modularOpen', resolve))
  // 用 activateBlock 而不是手搓 block_place：它会做射线检测、算出命中的面和光标位置，
  // 机器 GUI 要求真的「瞄准」了（放方块则不用）
  const block = bot.blockAt(P(loc.x, loc.y, loc.z))
  if (block) await bot.activateBlock(block)
  await sleep(700)
  const result = await Promise.race([opened, modular, sleep(timeout).then(() => null)])
  return result
}

module.exports = { CUR, sleep, P, rconAt, prepareArena, tpTo, giveItem, placeAt, openAt }
