'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { createOfflineBot } = require('./helpers/offline-bot')
const { stripColor } = require('../lib/gtnh/quests')
const { blockForItem } = require('../lib/gtnh/questrun')

test('任务脚本：挖就够的任务，计划里只有挖', async () => {
  const { bot } = await createOfflineBot({ username: 'qr1' })
  const p = bot.questSteps('Your First Night')
  assert.strictEqual(p.quest.name, 'Your First Night')
  assert.strictEqual(p.ready, false)
  assert.deepStrictEqual(p.blocked, [])
  assert.strictEqual(p.steps.length, 1)
  assert.strictEqual(p.steps[0].kind, 'mine')
  assert.strictEqual(p.steps[0].item, 'minecraft:dirt')
  assert.strictEqual(p.steps[0].block, 'dirt')
  assert.strictEqual(p.steps[0].count, 11)
  bot.end()
})

test('任务脚本：合成类任务（crafting）也能规划，顺序是先挖后做', async () => {
  const { bot } = await createOfflineBot({ username: 'qr2' })
  const p = bot.questSteps('Tools')
  assert.deepStrictEqual(p.blocked, [])
  const kinds = p.steps.map((s) => s.kind)
  const items = p.steps.map((s) => s.item)
  // 先挖木头，再合成
  assert.strictEqual(kinds[0], 'mine')
  assert.ok(items.some((n) => /wooden_pickaxe$/.test(n)))
  assert.ok(items.some((n) => /wooden_hoe$/.test(n)))
  // planks / stick 是中间产物，也在计划里
  assert.ok(items.some((n) => /planks$/.test(n)))
  assert.ok(items.some((n) => /stick$/.test(n)))
  // 挖出现在所有 craft 之前
  const lastMine = kinds.lastIndexOf('mine')
  const firstCraft = kinds.indexOf('craft')
  assert.ok(lastMine < firstCraft, '挖必须在合成之前')
  bot.end()
})

test('任务脚本：名字带 § 颜色码也能按名字找到', async () => {
  const { bot } = await createOfflineBot({ username: 'qr3' })
  const q = bot.quests().byName('More Steam, More Pressure!')[0]
  assert.ok(q)
  const p = bot.questSteps('More Steam, More Pressure!')
  assert.ok(p.blocked.length > 0, '这个任务要 GT 机器，应当有 blocked')
  assert.ok(p.blocked.some((b) => /需要|挖不到/.test(b.reason)))
  bot.end()
})

test('任务脚本：物品能反查方块（coal → coal_ore）', async () => {
  const { bot } = await createOfflineBot({ username: 'qr4' })
  assert.strictEqual(blockForItem(bot, { id: 'minecraft:coal', meta: 0 }), 'coal_ore')
  assert.strictEqual(blockForItem(bot, { id: 'minecraft:cobblestone', meta: 0 }), 'cobblestone')
  // 熔炉烧出来的东西不能靠挖
  assert.strictEqual(blockForItem(bot, { id: 'minecraft:iron_ingot', meta: 0 }), null)
  bot.end()
})

test('任务脚本：stripColor 去掉颜色码', () => {
  assert.strictEqual(stripColor('§c§lMore Steam, More Pressure!'), 'More Steam, More Pressure!')
  assert.strictEqual(stripColor('plain'), 'plain')
})
