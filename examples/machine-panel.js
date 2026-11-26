#!/usr/bin/env node
'use strict'

/*
 * 读一台 GT 机器（ModularUI2）的面板状态。
 *
 *   node examples/machine-panel.js 33 78 19                              # 已经有 op 且站得够近
 *   node examples/machine-panel.js 33 78 19 127.0.0.1 54615 "33 79 20"   # 先 rcon tp 到机器旁
 *
 * 右键有距离限制（服务端会拒绝 4 格以外的 use），不在旁边就先 tp。
 *
 * 右键方块的正面 → 服务器发 openGui + 全量 syncHandler → 打印面板与同步值。
 * 值类型：int / long / float / double / string / item / fluid / bool / nbt …
 * auto_sync:<panel>:0 多半是进度条（DoubleSyncValue，机器空转时是 NaN）。
 */

const { createBot, loadServerMods } = require('mineflayer-fork')
const { rcon } = require('protocol-fml/tools/rcon')
const { Vec3 } = require('vec3')

const [x, y, z] = process.argv.slice(2, 5).map(Number)
const host = process.argv[5] || '127.0.0.1'
const port = Number(process.argv[6] || 54615)
const tp = process.argv[7]
const username = 'example-panel'

if (!Number.isFinite(x)) {
  console.log('用法：node examples/machine-panel.js <x> <y> <z> [host] [port]')
  process.exit(1)
}

const bot = createBot({ host, port, username, mods: loadServerMods() })

bot.on('error', (err) => {
  if (!/Read error for undefined/.test(err.message)) console.log('错误：', err.message)
})

bot.once('spawn', async () => {
  if (tp) {
    await rcon([`gamemode 1 ${username}`, `tp ${username} ${tp}`], { host })
    await bot.waitForTicks(20)
  }
  await bot.waitForTicks(10)
  const block = bot.blockAt(new Vec3(x, y, z))
  console.log('目标方块：', block ? `${block.name}:${block.metadata}` : '（读不到，区块没加载？）')
  if (!block || block.name === 'air') return quit()

  // 右键打开 GUI。modularOpen 是 MUI2 的 openGui 包，比 windowOpen 早
  const opened = new Promise((resolve) => bot.once('modularOpen', resolve))
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 5000).unref())
  await bot.activateBlock(block)
  const panel = await Promise.race([opened, timeout])

  if (!panel) {
    console.log('没收到 openGui：这台方块不是 ModularUI2 机器，或者右键没生效')
    return quit()
  }
  const pos = panel.blockPos
  const where = pos ? `${pos.x ?? pos[0]},${pos.y ?? pos[1]},${pos.z ?? pos[2]}` : '?'
  console.log(`\n面板：${panel.factory}  window=${panel.windowId}  方块=${where}`)

  // 等这一轮全量同步落下来（GUI 打开后 head 包很快，但值是一批一批到的）
  await new Promise((resolve) => setTimeout(resolve, 800))

  for (const name of bot.modularPanels()) {
    const state = bot.panelState(name) || {}
    const keys = Object.keys(state)
    console.log(`\n[${name}] ${keys.length} 个同步值`)
    for (const key of keys.slice(0, 12)) {
      const v = state[key]
      let value = v.value
      if (v.kind === 'item') {
        const it = v.value?.item
        if (!it || !it.blockId) value = '（空槽）'
        else {
          const name = bot.registry.items[it.blockId]?.name ?? `#${it.blockId}`
          value = `${name}${it.itemDamage ? `:${it.itemDamage}` : ''} x${it.itemCount}`
        }
      }
      if (v.kind === 'double' && Number.isNaN(v.value)) value = 'NaN（进度 0/0）'
      console.log(`  ${key}  (${v.kind})  = ${value}`)
    }
    if (keys.length > 12) console.log(`  … 还有 ${keys.length - 12} 个`)
  }

  console.log('\n提示：要一份全量快照就重开 GUI（服务器发现你已开着时会整份重发）')
  quit()
})

function quit () {
  try { bot.closeWindow(bot.currentWindow) } catch {}
  bot.quit()
  setTimeout(() => process.exit(0), 300)
}
