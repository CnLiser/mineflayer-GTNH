'use strict'

// 对比镐与锤的采矿效率（工具需已在背包里，见 .probe/pick1.js / hammer9.js 的造法）
//
//   node tools/tool-mine-smoke.js 127.0.0.1 54615 --pick pickBot1 --hammer hamBot9
//
// 做法：各自在脚下同层造 3x3 竖直石墙，只挖中心一块，统计
//   (1) 挖中心耗时（客户端按 TiC 材料数据算，见 bot.tconDigTime）
//   (2) 一次挥动连带破坏几块（锤 = 3x3 AoE）
const mineflayer = require('..')
const { rcon } = require('../../protocol-fml/tools/rcon')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : args[i + 1] }
const pickName = opt('pick', 'pickBot1')
const hammerName = opt('hammer', 'hamBot9')
const WAIT = (ms) => new Promise((r) => setTimeout(r, ms))

async function bench (username, label) {
  const bot = mineflayer.createBot({ host, port, username, auth: 'offline', version: '1.7.10', hideErrors: true })
  bot.on('error', () => {})
  await new Promise((res) => bot.once('spawn', res))
  await WAIT(2000)
  const tool = bot.inventory.items().find((i) => /pickaxe|hammer/.test(i.name))
  if (!tool) throw new Error(`${username} 背包里没有镐/锤`)
  const info = bot.tconstructToolInfo(tool)

  // 用 TiC 材料数据覆盖 mineflayer 的挖速计算（它只认原版工具）
  const orig = bot.digTime.bind(bot)
  bot.digTime = (b) => { const t = bot.tconDigTime(b); return t == null ? orig(b) : t * 1000 }

  const p = bot.entity.position.floored()
  await rcon([`gamemode 0 ${username}`, `tp ${username} ${p.x + 0.5} ${p.y} ${p.z + 0.5}`], { host })
  await WAIT(700)
  bot.game.gameMode = 0

  const cells = []
  for (let dy = 0; dy <= 2; dy++) for (let dz = -1; dz <= 1; dz++) cells.push({ x: p.x + 2, y: p.y + dy, z: p.z + dz })
  for (const c of cells) await rcon([`setblock ${c.x} ${c.y} ${c.z} minecraft:stone 0 replace`], { host })
  await WAIT(900)

  const stoneLeft = () => cells.map((c) => bot.blockAt(c)).filter((b) => b && b.name === 'minecraft:stone')
  const before = stoneLeft()
  const centerPos = { x: p.x + 2, y: p.y, z: p.z }
  let t0 = 0
  let elapsed = 0
  let swings = 0
  let predicted = 0
  // 一直挖到墙清空：镐要 9 下，锤每下连带 3 块
  while (true) {
    const rest = stoneLeft()
    if (!rest.length) break
    const target = rest.find((b) => b.position.x === centerPos.x && b.position.y === centerPos.y && b.position.z === centerPos.z) || rest[0]
    predicted += bot.digTime(target)
    if (swings === 0) t0 = Date.now()
    swings++
    await bot.dig(target)
    await WAIT(350)
    if (swings > before.length + 2) break // 防御：避免死循环
  }
  elapsed = Date.now() - t0
  await WAIT(600)
  const after = stoneLeft()
  bot.quit()

  const broke = before.length - after.length
  console.log(`${label} ${tool.name}（${info.material.displayName} 速度 ${info.speed} 等级 ${info.harvestLevel}）`)
  console.log(`  清空 ${before.length} 块墙：${swings} 次挥动 ${elapsed}ms（${(elapsed / Math.max(1, before.length)).toFixed(0)}ms/块），理论合计 ${predicted.toFixed(0)}ms`)
  return { broke, elapsed, predicted, swings }
}

async function main () {
  const pick = await bench(pickName, '镐')
  await WAIT(1200)
  const hammer = await bench(hammerName, '锤')
  const ok = hammer.elapsed < pick.elapsed
  console.log(`\n锤清空同一面墙耗时 ${hammer.elapsed}ms vs 镐 ${pick.elapsed}ms → ${ok ? '✓ 锤更快' : '✗ 锤没有更快'}`)
  if (!ok) { console.error('✗ 采矿对比不达标'); process.exit(1) }
  console.log('✓ 工具采矿对比通过')
}

main().catch((e) => { console.error('✗', e.message); process.exit(1) })
