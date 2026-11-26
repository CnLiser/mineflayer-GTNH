#!/usr/bin/env node
'use strict'

/*
 * 容器窗口冒烟：在玩家旁边造一个箱子，右键打开，打印窗口内容。
 *   node tools/window-smoke.js [host] [port] --seconds 6 [--tp "x y z"]
 */
const { createBot } = require('../src/index')
const { rcon } = require('../../protocol-fml/tools/rcon')

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
  const bot = await createBot({ host, port, username: opt('username', 'windowBot') })
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
    console.log(`窗口 #${w.id} type=${w.type} title=${JSON.stringify(w.title)} slots=${w.slotCount}`)
    const items = bot.windowItems().filter((i) => i.where === 'window' && i.name)
    for (const it of items) console.log(`  槽 ${it.slot}: ${it.displayName || it.name} x${it.itemCount}`)
    if (!items.length) console.log('  （空箱子）')
  })

  bot.activateBlock({ x, y, z }, { x: 0, y: 1, z: 0 })
  await sleep(Math.max(1000, seconds * 200))
  if (bot.currentWindow) {
    console.log(`当前窗口 ${bot.currentWindow.title}，${bot.currentWindow.slotCount} 槽`)
    bot.closeWindow()
  }
  console.log(ok ? '✓ 窗口层通了' : '✗ 没等到 open_window')
  bot.quit()
  process.exit(ok ? 0 : 1)
})().catch((e) => { console.error(e); process.exit(1) })
