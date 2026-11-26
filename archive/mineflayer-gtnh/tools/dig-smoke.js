'use strict'

/*
 * 挖掘/放置冒烟测试。
 *   node tools/dig-smoke.js 127.0.0.1 54615 [--username digBot] [--tp 20 90 20]
 *
 * 注意：服务器 spawn-protection=1 时出生点 16 格内挖不动，用 --tp 走远一点。
 */

const { createBot } = require('../src')
const { rcon } = require('../../protocol-fml/tools/rcon')

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : fallback
}

const host = process.argv[2] ?? '127.0.0.1'
const port = Number(process.argv[3] ?? 54615)
const username = arg('--username', 'digBot')
const tp = arg('--tp')

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function findDiggable (bot) {
  const base = bot.entity.position
  const candidates = []
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      for (let dy = -1; dy <= 2; dy++) {
        const x = Math.floor(base.x) + dx
        const y = Math.floor(base.y) + dy
        const z = Math.floor(base.z) + dz
        const block = bot.blockAt({ x, y, z })
        if (!block || !block.blockId) continue
        const name = bot.blockNameAt({ x, y, z }) ?? ''
        if (/bedrock|barrier|command|portal|chest|spawner|water|lava|air/.test(name)) continue
        if (bot._isSolid(x, y, z) !== true) continue
        candidates.push({ x, y, z, block, name, dist: Math.hypot(dx, dz) + Math.abs(dy) })
      }
    }
  }
  candidates.sort((a, b) => a.dist - b.dist)
  return candidates[0] ?? null
}

async function main () {
  const bot = await createBot({ host, port, username })
  bot.on('kicked', (reason) => {
    console.error('被踢：', JSON.stringify(reason))
    process.exit(1)
  })

  await new Promise((resolve) => (bot.entity ? resolve() : bot.once('spawn', resolve)))
  await sleep(1500)

  if (tp) {
    const [x, y, z] = tp.split(/\s+/)
    await rcon([`tp ${username} ${x} ${y} ${z}`], { host })
    await sleep(2500) // 传送后要等区块下发，否则周围全是 null
    console.log(`已传送（服务器会把位置同步回来）`)
  }

  const target = findDiggable(bot)
  if (!target) {
    console.error('✗ 附近没有可挖的方块')
    process.exit(1)
  }
  console.log(`目标 (${target.x}, ${target.y}, ${target.z}) = ${target.name.name} (id=${target.block.blockId} meta=${target.block.metadata})`)

  const before = bot.blockAt({ x: target.x, y: target.y, z: target.z })
  const updated = new Promise((resolve) => {
    bot.once('blockUpdate', resolve)
    setTimeout(() => resolve(null), 3000)
  })
  await bot.dig({ position: { x: target.x, y: target.y, z: target.z } })
  const event = await updated
  await sleep(200)

  const after = bot.blockAt({ x: target.x, y: target.y, z: target.z })
  const removed = after && after.blockId === 0
  console.log(`挖完：id=${after ? after.blockId : 'null'}（事件：${event ? '收到 blockUpdate' : '没收到'}）`)

  const problems = []
  if (!removed) problems.push('方块没被挖掉')
  if (!event) problems.push('没收到 blockUpdate')

  // ---- 放置：创造模式给个石头再放回去 ----
  const stoneId = bot.registry.blockId('minecraft:stone') ?? 1
  bot.client.write('set_creative_slot', {
    slot: 36,
    item: { blockId: stoneId, itemCount: 64, itemDamage: 0, gtnhFlag: 1 }
  })
  await sleep(500)
  console.log(`手持：${bot.heldItem ? `id=${bot.heldItem.blockId}` : '空'}`)

  if (bot.heldItem) {
    // 放在刚挖出来的那个位置的地面（目标方块下方）
    const ref = { x: target.x, y: target.y - 1, z: target.z }
    bot.placeBlock({ position: ref }, { x: 0, y: 1, z: 0 })
    await sleep(1200)
    const placed = bot.blockAt({ x: target.x, y: target.y, z: target.z })
    const ok = placed && placed.blockId === stoneId
    console.log(`放置：id=${placed ? placed.blockId : 'null'}（期望 ${stoneId}）`)
    if (!ok) problems.push('放置没成功')
  } else {
    problems.push('创造模式没拿到物品')
  }

  if (before.blockId === 0) problems.push('目标本来就是空气')

  console.log(problems.length ? `✗ ${problems.join('；')}` : '✓ 挖掘/放置层通了')

  bot.quit()
  await sleep(300)
  process.exit(problems.length ? 1 : 0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
