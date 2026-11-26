#!/usr/bin/env node
'use strict'

/*
 * 容器窗口冒烟：在玩家旁边造一个箱子，右键打开，打印窗口内容。
 *   node tools/window-smoke.js [host] [port] --seconds 6 [--tp "x y z"]
 *   npm --workspace mineflayer-fork run window-smoke -- --tp "20 90 20"
 *
 * 原来在 packages/mineflayer-gtnh/tools/window-smoke.js，旧包归档后搬到 fork；
 * 区别只是 createBot 要显式带 mods（FML 握手回声）。
 */
const { createBot, loadServerMods } = require('..')
const { rcon } = require('../../protocol-fml/tools/rcon')
const { loadLang } = require('gtnh-data')
const { Vec3 } = require('vec3')

const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith('--'))
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : fallback
}
const host = positional[0] || '127.0.0.1'
const port = Number(positional[1] || 54615)
const seconds = Number(opt('seconds', 6))
const tp = opt('tp')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

;(async () => {
  const bot = createBot({
    host,
    port,
    username: opt('username', 'windowBot'),
    mods: loadServerMods(),
    lang: loadLang(), // 窗口标题若是 ChatMessage，translate 键用整合包 lang 渲染
    hideErrors: true
  })
  await new Promise((resolve) => bot.once('spawn', resolve))
  if (tp) {
    await rcon([`tp ${bot.username} ${tp}`, `gamemode 1 ${bot.username}`], {})
    await sleep(2500)
  }
  const p = bot.entity.position
  const x = Math.floor(p.x) + 1
  const y = Math.floor(p.y)
  const z = Math.floor(p.z)
  await rcon([`setblock ${x} ${y} ${z} minecraft:chest`], {})
  await sleep(600)

  let ok = false
  bot.on('windowOpen', (w) => {
    ok = true
    const slots = w.slots.length
    console.log(`窗口 #${w.id} type=${w.type} title=${JSON.stringify(bot.formatMessage(w.title))} slots=${slots}`)
    let shown = 0
    for (let i = 0; i < w.inventoryStart; i++) {
      const it = w.slots[i]
      if (!it) continue
      shown++
      console.log(`  槽 ${i}: ${it.displayName || it.name} x${it.count}`)
    }
    if (!shown) console.log('  （空箱子）')
  })

  const block = bot.blockAt(new Vec3(x, y, z))
  if (!block) throw new Error(`blockAt(${x}, ${y}, ${z}) 没方块，区块可能没加载`)
  await bot.activateBlock(block, new Vec3(0, 1, 0))
  await sleep(Math.max(1000, seconds * 200))
  if (bot.currentWindow) {
    console.log(`当前窗口 ${bot.formatMessage(bot.currentWindow.title)}，${bot.currentWindow.slots.length} 槽`)
    await bot.closeWindow(bot.currentWindow)
  }
  console.log(ok ? '✓ 窗口层通了' : '✗ 没等到 open_window')
  bot.end()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
