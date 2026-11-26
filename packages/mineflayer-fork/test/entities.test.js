'use strict'

// GTNH 装了 98 个 mod 实体（原版只有 50 个），minecraft-data 不认识这些 id，
// 以前 spawn 出来一律是 name='unknown'。这里验证回落到服务器导出的实体表。
const { test } = require('node:test')
const assert = require('node:assert')
const { createOfflineBot } = require('./helpers/offline-bot')

function spawnLiving (client, id, type, extra = {}) {
  client.emit('spawn_entity_living', {
    entityId: id,
    entityUUID: '00000000-0000-4000-8000-00000000000' + (id % 10),
    type,
    x: 0,
    y: 640,
    z: 0,
    yaw: 0,
    pitch: 0,
    headPitch: 0,
    velocity: { x: 0, y: 0, z: 0 },
    metadata: [],
    ...extra
  })
}

test('mod 实体（EnderZoo 苦力怕）不再是 unknown', async () => {
  const { bot, client } = await createOfflineBot()
  spawnLiving(client, 100, 6)
  const e = bot.entities[100]
  assert.ok(e, '实体应该被创建')
  assert.strictEqual(e.name, 'enderzoo.ConcussionCreeper')
  assert.strictEqual(e.displayName, 'enderzoo.ConcussionCreeper')
  assert.strictEqual(e.type, 'mob')
  assert.strictEqual(e.entityType, 6)
  assert.strictEqual(e.width, 0.6)
  assert.strictEqual(e.height, 1.8)
})

test('原版实体仍走 minecraft-data（分类/尺寸不被覆盖）', async () => {
  const { bot, client } = await createOfflineBot()
  spawnLiving(client, 101, 50) // Creeper
  const e = bot.entities[101]
  assert.strictEqual(e.name, 'Creeper')
  assert.notStrictEqual(e.kind, 'Unknown')
})

test('表里没有的 id 仍然落 unknown（不瞎猜）', async () => {
  const { bot, client } = await createOfflineBot()
  spawnLiving(client, 102, 250)
  const e = bot.entities[102]
  assert.strictEqual(e.name, 'unknown')
  assert.strictEqual(e.type, 'other')
})
