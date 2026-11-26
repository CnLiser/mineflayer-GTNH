'use strict'

/*
 * 联机冒烟：建一个 bot，打印它「看到」的世界。
 *   node tools/smoke.js 127.0.0.1 54615 --seconds 20 [--chat "hi"]
 */

const path = require('path')
const fs = require('fs')
const { createBot } = require('../src')
const { Lang } = require('gtnh-data')

function arg (name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const host = process.argv[2] ?? '127.0.0.1'
const port = Number(process.argv[3] ?? 54615)
const seconds = Number(arg('seconds', 20))
const chatMessage = arg('chat')

const langDir = path.join(__dirname, '..', '..', 'gtnh-data', 'data', 'raw', 'gtnh-2.9.0', 'lang')
const lang = new Lang({
  en: JSON.parse(fs.readFileSync(path.join(langDir, 'en_US.json'), 'utf8')),
  zh: JSON.parse(fs.readFileSync(path.join(langDir, 'zh_CN.json'), 'utf8'))
})

async function main () {
  const bot = await createBot({
    host,
    port,
    username: arg('username', 'gtnh-bot'),
    lang
  })

  const stats = { chunks: 0, blockUpdates: 0, entitySpawn: 0, chat: [], errors: [] }
  bot.on('chunk', () => stats.chunks++)
  bot.on('blockUpdate', () => stats.blockUpdates++)
  bot.on('blockUpdates', (changes) => { stats.blockUpdates += changes.length })
  bot.on('entitySpawn', () => stats.entitySpawn++)
  bot.on('chat', ({ text }) => stats.chat.push(text))
  bot.on('error', (err) => stats.errors.push(err.message))

  bot.on('spawn', () => console.log('[spawn] 出生点已同步'))
  bot.on('end', (reason) => console.log(`[end] ${reason}`))

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000))

  const position = bot.entity.position
  const feet = bot.blockNameAt(position.offset(0, -1, 0))
  const below = bot.blockNameAt(position.offset(0, -2, 0))
  const head = bot.blockNameAt(position)

  console.log('\n=== bot 状态 ===')
  console.log(`用户名: ${bot.username}  entityId: ${bot.entity.id}  维度: ${bot.dimension}  游戏模式: ${bot.gameMode}`)
  console.log(`坐标: ${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`)
  console.log(`生命: ${bot.health} 饥饿: ${bot.food} 饱和: ${bot.saturation.toFixed(1)}  等级: ${bot.experience.level}`)
  console.log(`时间: 第 ${bot.time.day} 天 ${bot.time.timeOfDay} tick`)
  console.log(`区块: ${stats.chunks} 次更新 / 世界 ${bot.world ? bot.world.stats().columns : 0} 列`)
  console.log(`方块更新: ${stats.blockUpdates}  实体生成: ${stats.entitySpawn}  当前实体数: ${bot.entities.size}`)
  const describe = (block, label) => {
    if (!block) return console.log(`${label}: 未加载`)
    const display = block.displayName && block.displayName !== block.name ? `${block.displayName} / ` : ''
    console.log(`${label}: ${display}${block.name ?? `id=${block.blockId}`} (id=${block.blockId} meta=${block.metadata}) sky=${block.skyLight} light=${block.blockLight} biome=${block.biome}`)
  }
  describe(feet, '脚下')
  describe(below, '脚下方块之下')
  describe(head, '身体所在')
  if (bot.players.size) {
    console.log(`玩家列表: ${[...bot.players.keys()].join(', ')}`)
  }
  if (bot.entities.size) {
    const list = [...bot.entities.values()].slice(0, 5).map((entity) => {
      const name = entity.username ?? entity.name ?? entity.type
      return `${name}@${entity.position.x.toFixed(1)},${entity.position.y.toFixed(1)},${entity.position.z.toFixed(1)}`
    })
    console.log(`附近实体: ${list.join(' | ')}${bot.entities.size > 5 ? ` …共 ${bot.entities.size} 个` : ''}`)
  }
  if (stats.chat.length) {
    console.log(`聊天: ${stats.chat.slice(0, 5).join(' | ')}`)
  }
  if (stats.errors.length) {
    console.log(`错误: ${stats.errors.slice(0, 5).join(' | ')}`)
  }

  if (chatMessage) {
    bot.chat(chatMessage)
    console.log(`[chat] 已发送: ${chatMessage}`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }

  const ok = bot.spawned && bot.health === 20 && bot.world && bot.world.stats().columns > 0 && stats.errors.length === 0
  bot.quit()
  console.log(ok ? '\n✓ bot 层通了' : '\n✗ bot 层未通过')
  await new Promise((resolve) => setTimeout(resolve, 300))
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
