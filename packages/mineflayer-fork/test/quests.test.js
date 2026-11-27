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

test('idOf：名字→数字 id，数字原样，未知返回 null', async () => {
  const { idOf, recipeFor, howToMake } = require('../lib/gtnh/quests')
  const { bot } = await createOfflineBot()
  assert.strictEqual(idOf(bot, 1), 1)
  assert.strictEqual(idOf(bot, 'stone'), 1)
  assert.strictEqual(idOf(bot, 'minecraft:stone'), 1)
  assert.strictEqual(idOf(bot, 'no_such_item'), null)
  bot.end()
})

test('recipeFor / howToMake：能查到配方就把原料列出来，再往下拆一层', () => {
  const { recipeFor, howToMake } = require('../lib/gtnh/quests')
  const fake = {
    registry: { itemsByName: { 'test:plate': { id: 900 }, 'test:ingot': { id: 901 } }, items: { 900: { name: 'test:plate' }, 901: { name: 'test:ingot' } } },
    recipesFor: (id) => (id === 900 ? [{ delta: [{ id: 901, metadata: 0, count: -2 }] }] : [])
  }
  const item = { id: 'test:plate', meta: 0 }
  const r = recipeFor(fake, item)
  assert.strictEqual(r.kind, 'craft')
  assert.deepStrictEqual(r.inputs, [{ id: 'test:ingot', meta: 0, count: 2 }])
  const deep = howToMake(fake, item, 1)
  assert.strictEqual(deep.next[0].how, null, '锭没有配方，到这里就停')
  assert.strictEqual(recipeFor(fake, { id: 'test:ingot', meta: 0 }), null)
})

test('bot.questPlan 离线也能给出缺料（查不到配方时 how=null）', async () => {
  const { bot } = await createOfflineBot()
  const q = bot.questByName('Shadow Metal')[0]
  const plan = bot.questPlan(q.id, { depth: 1, limit: 5 })
  assert.strictEqual(plan.length, 2)
  assert.strictEqual(plan[0].need, 6)
  assert.strictEqual(plan[0].how, null)
  bot.end()
})
