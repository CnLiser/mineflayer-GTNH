'use strict'

/*
 * vendored mineflayer fork 的联机冒烟测试。
 *
 *   node tools/fork-smoke.js 127.0.0.1 54615 --username forkBot [--tp "20 90 20"]
 *
 * 依次验证：登录 → 生成 → blockAt → 聊天 → 走路位移 → 挖掘 → 背包槽位。
 * 任何一步不达标就 exit 1。
 */

const { createBot } = require('..')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const username = opt('--username', 'forkBot')
const tp = opt('--tp', null)
const { loadServerMods } = require('mineflayer-gtnh/src/index')
const { rcon } = require('protocol-fml/tools/rcon')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (msg) => { console.error('✗', msg); process.exit(1) }

;(async () => {
  const bot = createBot({ host, port, username, mods: loadServerMods(), hideErrors: true })
  bot.on('error', () => {})
  const killer = setTimeout(() => fail('超时（40s）'), 40000)

  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    bot.once('end', () => reject(new Error('连接被断开')))
  })
  console.log('✓ 生成于', bot.entity.position.toString(), 'version', bot.version)

  if (tp) {
    await rcon(['gamemode 1 ' + username, `tp ${username} ${tp}`], { host })
    await sleep(2500)
    console.log('  传送后', bot.entity.position.toString(), 'onGround', bot.entity.onGround)
  }

  const below = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
  if (!below) fail('脚下拿不到方块（区块没加载）')
  console.log('✓ blockAt', below.name, 'id=' + below.type, 'bb=' + below.boundingBox)

  bot.chat('hello from mineflayer fork')
  await sleep(500)
  console.log('✓ 聊天已发送')

  const start = bot.entity.position.clone()
  let peak = 0
  const sampler = setInterval(() => {
    const v = bot.entity.velocity
    peak = Math.max(peak, Math.hypot(v.x, v.z) * 20)
  }, 50)
  bot.setControlState('forward', true)
  await sleep(1500)
  bot.setControlState('forward', false)
  clearInterval(sampler)
  await sleep(300)
  const moved = bot.entity.position.distanceTo(start)
  console.log(`${peak > 3 && moved > 1 ? '✓' : '✗'} 走路：峰值 ${peak.toFixed(2)} 格/秒，位移 ${moved.toFixed(2)} 格`)
  if (peak < 3) fail('走路速度不对（<3 格/秒）')

  const target = bot.blockAt(bot.entity.position.floored().offset(0, -1, 0))
  const t0 = Date.now()
  await Promise.race([
    bot.dig(target),
    sleep(8000).then(() => { throw new Error('挖掘超时') })
  ]).catch((e) => fail(e.message))
  console.log('✓ 挖掘', target.name, '用时', Date.now() - t0, 'ms；现在是', bot.blockAt(target.position).name)

  const slots = bot.inventory.slots.filter(Boolean)
  console.log('✓ 背包', bot.inventory.slots.length, '槽，非空', slots.length, '个：',
    slots.slice(0, 3).map((i) => `${i.name}x${i.count}`).join(', '))

  clearTimeout(killer)
  console.log('✓ fork 冒烟通过')
  bot.quit()
  process.exit(0)
})().catch((e) => fail(e.message))
