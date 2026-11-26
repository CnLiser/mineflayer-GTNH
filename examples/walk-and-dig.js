#!/usr/bin/env node
'use strict'

/*
 * 最简单的连服示例：登录 → 走一步 → 挖脚下那块 → 看背包。
 *
 *   node examples/walk-and-dig.js                          # 127.0.0.1:54615
 *   node examples/walk-and-dig.js 127.0.0.1 54615 "20 90 20"   # 先 rcon tp 到 (20,90,20)
 *
 * 需要本地 GTNH 服务端。不给 tp 就在出生点附近走，被围住时提示你。
 */

const { createBot, loadServerMods } = require('mineflayer-fork')
const { rcon } = require('protocol-fml/tools/rcon')

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 54615)
const tp = process.argv[4]          // 可选：rcon tp 到 "x y z"
const username = 'example-walker'

const bot = createBot({
  host,
  port,
  username,
  mods: loadServerMods(),   // FML 握手要 mod 列表，否则注册表是空的
  physicsEnabled: true
})

bot.on('kicked', (reason) => console.log('被踢：', reason))
// 未知包 id 的解析错误是 1.7.10 的常态（服务端会发 mod 自己的包），loader 默认已经静音，
// 这里只是示例，别把它当成失败
bot.on('error', (err) => {
  if (!/Read error for undefined/.test(err.message)) console.log('错误：', err.message)
})

bot.once('spawn', async () => {
  if (tp) {
    await rcon([`gamemode 1 ${username}`, `tp ${username} ${tp}`], { host })
    await bot.waitForTicks(20)
  }

  // spawn 事件比位置同步早一点，等两 tick 再取（否则读到 0,0,0）
  await bot.waitForTicks(10)
  const start = bot.entity.position.clone()
  console.log('出生：', start.toString())

  // 1. 等落地（走路前玩家常还在下落，此时脚下是空气）
  await waitUntil(() => bot.entity.onGround, 5000)

  // 2. 往前走 0.8 秒（先跳一下，万一出生在坑里能爬出来）
  bot.setControlState('jump', true)
  await new Promise((resolve) => setTimeout(resolve, 150))
  bot.setControlState('jump', false)
  bot.setControlState('forward', true)
  await new Promise((resolve) => setTimeout(resolve, 800))
  bot.setControlState('forward', false)
  await bot.waitForTicks(5)
  const moved = bot.entity.position.distanceTo(start)
  console.log(`走了 ${moved.toFixed(2)} 格，到 ${bot.entity.position.floored()}`)
  if (moved < 0.5) console.log('  （几乎没动：可能被方块围住了，先 rcon tp 到开阔地再跑）')

  // 3. 挖正前方看的方块（不挖脚下，否则自己会掉进坑里）
  await bot.look(bot.entity.yaw, 0.55)
  // 环顾四周找一块能挖的（跳过空气和脚下那一格——挖脚下会把自己挖进坑）
  const base = bot.entity.position.floored()
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]]
  let target = null
  for (const [dx, dy, dz] of dirs) {
    const block = bot.blockAt(base.offset(dx, dy, dz))
    if (block && block.name !== 'air' && block.name !== 'cave_air') { target = block; break }
  }

  if (!target) {
    console.log('附近没有可挖的方块，跳过挖掘')
  } else {
    const t0 = Date.now()
    await bot.dig(target)
    console.log(`挖掉 ${target.name} ${target.position}，用时 ${Date.now() - t0}ms`)
  }

  // 4. 看背包
  const items = bot.inventory.items()
  console.log(`背包 ${items.length} 格有东西：`, items.slice(0, 5).map((i) => `${i.name} x${i.count}`).join(', '))

  bot.quit()
  process.exit(0)
})

function waitUntil (fn, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (!fn()) return
      clearInterval(timer)
      resolve()
    }, 100)
    setTimeout(() => { clearInterval(timer); reject(new Error('等待超时')) }, timeout).unref()
  })
}
