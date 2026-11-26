'use strict'

// 实体类型表：由 jmx 探针从运行中的 GTNH 服务器导出（EntityList 的 id→Class 与 Class→名字）。
const { test } = require('node:test')
const assert = require('node:assert')
const { loadEntities, ENTITIES_FILE } = require('../src/entities')
const fs = require('fs')

const types = loadEntities()

test('数据文件存在，148 个实体 id', () => {
  assert.ok(fs.existsSync(ENTITIES_FILE))
  assert.strictEqual(types.size, 148)
})

test('原版实体名字与原版一致（id 没被 mod 挤掉）', () => {
  assert.strictEqual(types.nameOf(1), 'Item')
  assert.strictEqual(types.nameOf(20), 'PrimedTnt')
  assert.strictEqual(types.nameOf(50), 'Creeper')
  assert.strictEqual(types.nameOf(61), 'Blaze')
  assert.strictEqual(types.idOf('Blaze'), 61)
})

test('mod 实体有名字（98 个）', () => {
  assert.strictEqual(types.get(6).name, 'enderzoo.ConcussionCreeper')
  assert.strictEqual(types.get(6).cls, 'crazypants.enderzoo.entity.EntityConcussionCreeper')
  const mods = types.modEntities()
  assert.strictEqual(mods.length, 98)
  assert.ok(mods.every((e) => !e.cls.startsWith('net.minecraft')))
})

test('未知 id 返回 null，不瞎猜', () => {
  assert.strictEqual(types.get(999), null)
  assert.strictEqual(types.nameOf(999), null)
  assert.strictEqual(types.idOf('NoSuchEntity'), null)
})

test('minecraft-data 认得的原版实体，这张表都覆盖到了', () => {
  const mcData = require('minecraft-data')('1.7.10')
  const missing = mcData.entitiesArray
    .filter((e) => typeof e.internalId === 'number')
    .filter((e) => !types.get(e.internalId))
    .map((e) => `${e.internalId}:${e.name}`)
  assert.deepStrictEqual(missing, [])
})
