'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { createOfflineBot } = require('./helpers/offline-bot')

test('bot.quests() 能读任务书', async () => {
  const { bot, client } = await createOfflineBot()
  const book = bot.quests()
  assert.strictEqual(book.total, 3814)
  assert.strictEqual(bot.questLines().length, 46)
  bot.end()
})

test('bot.questByName / questsOfLine / questChain', async () => {
  const { bot } = await createOfflineBot()
  const hits = bot.questByName('Shadow Metal')
  assert.strictEqual(hits.length, 1)
  const chain = bot.questChain(hits[0].id)
  assert.strictEqual(chain[chain.length - 1].id, hits[0].id)
  const line = bot.questLine('Mass Processing')
  assert.ok(line)
  assert.ok(bot.questsOfLine('Mass Processing').length > 10)
  bot.end()
})

test('bot.questReady / questMissing 按当前背包算', async () => {
  const { bot } = await createOfflineBot()
  const q = bot.questByName('Shadow Metal')[0]
  // 空背包：不 ready，缺两样
  assert.strictEqual(bot.questReady().some((x) => x.id === q.id), false)
  const missing = bot.questMissing(q.id)
  assert.strictEqual(missing.length, 2)
  // 塞够材料：ready
  bot.inventory.slots[36] = { type: 1, count: 6, metadata: 0, name: 'TaintedMagic:BlockShadowOre' }
  bot.inventory.slots[37] = { type: 2, count: 9, metadata: 11368, name: 'gregtech:gt.metaitem.01' }
  assert.strictEqual(bot.questMissing(q.id).length, 0)
  assert.strictEqual(bot.questReady().some((x) => x.id === q.id), true)
  bot.end()
})
