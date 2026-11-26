const { test } = require('node:test')
const assert = require('node:assert')
const { createOfflineBot } = require('./helpers/offline-bot')

// heldItem 是 inventory 插件定义的 getter（读 slots[quickBarSlot+36]），不能直接赋值，
// 所以往快捷栏第一格塞物品。
const withHeld = async (item) => {
  const { bot } = await createOfflineBot()
  bot.inventory.slots[bot.quickBarSlot + 36] = item
  // digTime 会读「眼睛所在方块」判断水下、以及 onGround/effects；离线 bot 没 spawn 过
  if (!bot.entity) bot.entity = {}
  bot.entity.position = require('vec3')(0, 64, 0)
  bot.entity.onGround = true
  bot.entity.effects = {}
  return bot
}

test('匠魂镐挖石头：mcdata 按徒手算 7.5 秒，补丁按铁级速度压到 1 秒内', async () => {
  const bot = await withHeld({ name: 'TConstruct:pickaxe', metadata: 0, type: 4482 })
  const block = { name: 'minecraft:stone', hardness: 1.5, digTime: () => 7500 }
  const t = bot.digTime(block)
  assert.ok(t > 0 && t < 1000, `应小于 1 秒，实际 ${t}`)
})

test('原版木镐的 mcdata 估算不动（它认得）', async () => {
  const bot = await withHeld({ name: 'wooden_pickaxe', metadata: 0, type: 270 })
  const block = { name: 'minecraft:stone', hardness: 1.5, digTime: () => 1150 }
  assert.equal(bot.digTime(block), 1150)
})

test('被 GT 禁掉的钻石镐不会被补丁「提速」', async () => {
  const bot = await withHeld({ name: 'diamond_pickaxe', metadata: 0, type: 278 })
  const block = { name: 'minecraft:stone', hardness: 1.5, digTime: () => 7500 }
  assert.equal(bot.digTime(block), 7500)
})

test('空手保持原样', async () => {
  const bot = await withHeld(null)
  const block = { name: 'minecraft:stone', hardness: 1.5, digTime: () => 7500 }
  assert.equal(bot.digTime(block), 7500)
})
