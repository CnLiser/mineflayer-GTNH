'use strict'

/*
 * 熔炉冒烟：连接 → RCON 给创造/传送 → 放熔炉 → 拿沙子+煤 → 开窗口
 * → 把沙子放进输入槽、煤放进燃料槽 → 等产物 → shift 点击取出。
 *
 *   node tools/furnace-smoke.js 127.0.0.1 54615 [--username furnBot] [--tp "20.5 90 20.5"]
 *
 * 1.7.10 熔炉窗口 = 3 个容器格（0 输入 / 1 燃料 / 2 产物）+ 36 玩家格 = 39 槽。
 * 一次烧炼 200 tick（10 秒），所以默认等 25 秒。
 */

const { createBot } = require('..')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const username = opt('--username', 'furnBot')
const tp = opt('--tp', '20.5 90 20.5')
const { loadServerMods } = require('mineflayer-gtnh/src/index')
const { rcon } = require('protocol-fml/tools/rcon')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (msg) => { console.error('✗', msg); process.exit(1) }

const IRON_ORE = 15
const COAL = 263
const IRON_INGOT = 265

async function main () {
  const [tx, ty, tz] = tp.split(/\s+/).map(Number)

  const bot = createBot({ host, port, username, mods: loadServerMods(), hideErrors: true })
  bot.on('error', () => {})
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    bot.once('end', () => reject(new Error('连接被断开')))
    setTimeout(() => reject(new Error('生成超时（25s）')), 25000)
  })
  console.log(`✓ 生成于 ${bot.entity.position}`)

  for (const cmd of [`op ${username}`, `gamemode 1 ${username}`, `tp ${username} ${tp}`]) {
    try { await rcon([cmd], { host }) } catch (err) { console.warn(`  (${cmd} 失败：${err.message})`) }
  }
  await sleep(2000)

  // 传送后要按**落地后**的脚底坐标算，否则会放到够不到的空中
  const feet = bot.entity.position.floored()
  const furnacePos = `${feet.x + 2} ${feet.y} ${feet.z}`
  const [setOut] = await rcon([`setblock ${furnacePos} minecraft:furnace`], { host })
  console.log(`  setblock → ${String(setOut).trim()}`)
  await sleep(800)

  const block = bot.blockAt({ x: feet.x + 2, y: feet.y, z: feet.z })
  if (!block || block.name !== 'minecraft:furnace') fail(`熔炉没放上：${block && block.name}`)
  console.log(`  熔炉 ${furnacePos} type=${block.type} name=${block.name}`)

  // 一次给两格：沙子进 36，煤进 37（尾字节当 count 用，所以每个只给 1 个）
  bot._client.write('set_creative_slot', {
    slot: 36, item: { blockId: IRON_ORE, itemCount: 1, itemDamage: 0, nbtData: undefined, gtnhFlag: 1 }
  })
  await sleep(400)
  bot._client.write('set_creative_slot', {
    slot: 37, item: { blockId: COAL, itemCount: 1, itemDamage: 0, nbtData: undefined, gtnhFlag: 1 }
  })
  await sleep(800)
  console.log('  背包：' + (bot.inventory.items().map((i) => `${i.name}x${i.count}@${i.slot}`).join(',') || '(空)'))

  const furnace = await bot.openFurnace(block)
  console.log(`  窗口 type=${furnace.type} slots=${furnace.slots.length} invStart=${furnace.inventoryStart}`)

  const ore = bot.inventory.findInventoryItem(IRON_ORE)
  const coal = bot.inventory.findInventoryItem(COAL)
  if (!ore || !coal) fail('材料没拿到')
  // 背包槽号 ≠ 窗口槽号：容器窗口的玩家格从 window.inventoryStart 开始
  const toWindowSlot = (invSlot) => furnace.inventoryStart + (invSlot - bot.inventory.inventoryStart)
  await bot.clickWindow(toWindowSlot(ore.slot), 0, 0)
  await bot.clickWindow(0, 0, 0)
  await bot.clickWindow(toWindowSlot(coal.slot), 0, 0)
  await bot.clickWindow(1, 0, 0)
  await sleep(600)
  console.log(`  输入槽=${furnace.slots[0] && furnace.slots[0].name} 燃料槽=${furnace.slots[1] && furnace.slots[1].name}`)

  let glass = null
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    if (furnace.slots[2]) { glass = furnace.slots[2]; break }
    await sleep(500)
  }
  if (!glass) fail('25 秒内没有产物（输入/燃料没进去？）')
  console.log(`  产物槽=${glass.name} x${glass.count}`)
  if (glass.type !== IRON_INGOT) fail(`产物不是玻璃：${glass.name}`)

  await bot.clickWindow(2, 0, 1)
  await sleep(1500)
  const items = bot.inventory.items()
  const got = items.find((i) => i.type === IRON_INGOT)
  if (!got) fail(`取出后背包没有铁锭（背包：${items.map((i) => `${i.name}@${i.slot}`).join(',') || '空'}，产物槽：${bot.currentWindow && bot.currentWindow.slots[2] && bot.currentWindow.slots[2].name || '空'}）`)
  console.log(`  ✓ 背包出现 ${got.name} x${got.count}@${got.slot}`)

  await bot.closeWindow(furnace)
  await sleep(500)
  console.log('✓ 熔炉冒烟通过')
  bot.quit()
  await sleep(200)
  process.exit(0)
}

main().catch((err) => { console.error('✗', err.message); process.exit(1) })
