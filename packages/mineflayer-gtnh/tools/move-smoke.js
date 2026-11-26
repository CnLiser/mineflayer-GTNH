'use strict'

/*
 * 走路/跳跃冒烟测试。
 *   node tools/move-smoke.js 127.0.0.1 54615 [--username moveBot] [--seconds 3] [--tp "20 90 20"]
 *
 * 建议带 --tp：出生点常常在坑里或贴着坎，测出来的是「撞墙」而不是「走路」。
 */

const { createBot } = require('../src')
const { rcon } = require('../../protocol-fml/tools/rcon')

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}

const host = process.argv[2] ?? '127.0.0.1'
const port = Number(process.argv[3] ?? 54615)
const username = arg('--username', 'moveBot')
const seconds = Number(arg('--seconds', 3))
const tp = arg('--tp')

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main () {
  const bot = await createBot({ host, port, username })
  bot.on('kicked', (reason) => {
    console.error('被踢：', JSON.stringify(reason))
    process.exit(1)
  })

  await new Promise((resolve) => (bot.entity ? resolve() : bot.once('spawn', resolve)))
  await sleep(1500) // 等区块加载，否则脚下是 air 会直接掉下去

  if (tp) {
    await rcon([`tp ${username} ${tp.split(/\s+/).join(' ')}`], { host })
    await sleep(1500)
    console.log(`已传送到 ${tp}`)
  }

  const start = bot.physicsState.position.clone()
  console.log(`起点 (${start.x.toFixed(2)}, ${start.y.toFixed(2)}, ${start.z.toFixed(2)})`)

  // ---- 走路 ----
  // 地形起伏会让「总位移」偏小（走两步就撞上坎），所以主要看峰值速度：
  // 走到最高速后水平速度应该稳定在 4.317 格/秒。
  let maxSpeed = 0
  bot.setControlState('forward', true)
  for (let i = 0; i < seconds * 10; i++) {
    await sleep(100)
    const v = bot.physicsState.velocity
    maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z) * 20)
  }
  bot.setControlState('forward', false)
  await sleep(300)

  const afterWalk = bot.physicsState.position.clone()
  const walked = Math.hypot(afterWalk.x - start.x, afterWalk.z - start.z)
  console.log(`走了 ${walked.toFixed(2)} 格 / ${seconds}s，峰值速度 ${maxSpeed.toFixed(2)} 格/秒（期望 4.32）`)

  // ---- 跳跃 ----
  if (!bot.onGround) await sleep(800) // 先落地
  const groundY = bot.physicsState.position.y
  let apex = groundY
  bot.setControlState('jump', true)
  await sleep(120)
  bot.setControlState('jump', false)
  for (let i = 0; i < 30; i++) {
    await sleep(25)
    apex = Math.max(apex, bot.physicsState.position.y)
  }
  await sleep(500)
  const jumpHeight = apex - groundY
  console.log(`跳跃高度 ${jumpHeight.toFixed(2)} 格（期望 ≈ 1.25），落地：${bot.onGround ? '是' : '否'}`)

  // ---- 结论 ----
  const problems = []
  if (maxSpeed < 3.6 || maxSpeed > 4.8) problems.push(`行走速度异常（峰值 ${maxSpeed.toFixed(2)} 格/秒）`)
  if (walked < 1) problems.push(`完全没走动（${walked.toFixed(2)} 格）`)
  if (jumpHeight < 0.8) problems.push(`跳不起来（${jumpHeight.toFixed(2)} 格）`)
  if (!bot.onGround) problems.push('没有落地')

  console.log(problems.length ? `✗ ${problems.join('；')}` : '✓ 移动层通了')

  bot.quit()
  await sleep(300)
  process.exit(problems.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
