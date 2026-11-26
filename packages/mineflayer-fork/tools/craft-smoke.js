'use strict'

/*
 * 合成冒烟：连接 → RCON 把 bot 传到空地并给创造 → 造工作台 → 拿 1 个原木
 * → 打开工作台 → 点配方合成木板 → 校验背包和窗口。
 *
 *   node tools/craft-smoke.js 127.0.0.1 54615 [--username craftBot] [--tp "20.5 90 20.5"]
 *
 * GTNH 的三个前提：
 *   1. RCON 的 op/gamemode/tp 必须**在 bot 已登录后**发（离线时对玩家名无效）；
 *   2. `/give` 在本服是坏的（打印成功但不入库），材料只能用 `set_creative_slot`
 *      写进快捷栏——服务器会把 count 归一成 1，所以一次只能拿一个材料；
 *   3. 1.7 的 `open_window` 只带数字 inventoryType（工作台 = 1），上游 craft 插件按
 *      'minecraft:crafting_table' 字符串判断，已在 `lib/plugins/craft.js` 打补丁。
 */

const { createBot } = require('..')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const username = opt('--username', 'craftBot')
const tp = opt('--tp', '20.5 90 20.5')
const { loadServerMods } = require('..')
const { rcon } = require('protocol-fml/tools/rcon')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (msg) => { console.error('✗', msg); process.exit(1) }

const OAK_LOG = 17
const OAK_PLANKS = 5

async function main () {
  const [tx, ty, tz] = tp.split(/\s+/).map(Number)
  const tablePos = `${Math.floor(tx) + 2} ${Math.floor(ty)} ${Math.floor(tz)}`

  const bot = createBot({ host, port, username, mods: loadServerMods(), hideErrors: true })
  bot.on('error', () => {})
  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    bot.once('end', () => reject(new Error('连接被断开')))
    setTimeout(() => reject(new Error('生成超时（25s）')), 25000)
  })
  console.log(`✓ 生成于 ${bot.entity.position}`)

  // 玩家在线后才让 RCON 生效
  for (const cmd of [
    `op ${username}`,
    `gamemode 1 ${username}`,
    `tp ${username} ${tp}`
  ]) {
    try {
      const [out] = await rcon([cmd], { host })
      if (out && /not found|Unknown|no player/i.test(out)) console.warn(`  (${cmd} → ${out.trim()})`)
    } catch (err) {
      console.warn(`  (${cmd} 失败：${err.message})`)
    }
  }
  await sleep(2500) // 等传送后的新区块
  console.log(`  传送后位置 ${bot.entity.position}`)

  const Item = require('../lib/gtnh/items')(bot)
  const p = bot.entity.position
  const blockX = Math.floor(p.x) + 2
  const blockY = Math.floor(p.y)
  const blockZ = Math.floor(p.z)
  try {
    const [out] = await rcon([`setblock ${blockX} ${blockY} ${blockZ} minecraft:crafting_table`], { host })
    console.log(`  setblock → ${(out || '').trim()}`)
  } catch (err) {
    fail('setblock 失败：' + err.message)
  }
  await sleep(600)

  await bot.creative.setInventorySlot(36, new Item(OAK_LOG, 1))
  await sleep(500)
  const log = bot.inventory.items().find((i) => i.type === OAK_LOG)
  if (!log) fail('原木没进背包（set_creative_slot 被拒？确认 gamemode 是创造）')
  console.log(`  背包：${log.name || 'log'} x${log.count}`)

  const table = bot.findBlock({
    matching: (b) => /crafting_table/.test(b.name || ''),
    maxDistance: 8
  })
  if (!table) fail('附近没有工作台（setblock 失败？）')
  console.log(`  工作台 ${table.position} type=${table.type} name=${table.name}`)

  const recipes = bot.recipesFor(OAK_PLANKS, null, 1, table)
  if (!recipes.length) fail('没有木板配方（prismarine-recipe 数据缺失？）')
  const recipe = recipes[0]
  console.log(`  配方：${recipe.delta.map((d) => `${d.id}x${d.count}`).join(' ')} → ${recipe.result.id}x${recipe.result.count}`)

  const started = Date.now()
  await bot.craft(recipe, 1, table)
  await sleep(600)
  console.log(`  合成耗时 ${Date.now() - started}ms`)

  const planks = bot.inventory.items().find((i) => i.type === OAK_PLANKS)
  if (!planks) fail('合成后背包里没有木板')
  console.log(`✓ 合成出 ${planks.name || 'planks'} x${planks.count}`)
  if (bot.currentWindow) fail('合成后窗口没有关闭')
  console.log('✓ 工作台窗口已关闭')
  console.log('✓ 合成冒烟通过')
  bot.quit()
  process.exit(0)
}

main().catch((err) => {
  console.error('✗', err.message)
  process.exit(1)
})
