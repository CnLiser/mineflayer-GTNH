'use strict'

// 1.7.10 的「使用物品 / 挥手」包参数（丢弃走 window_click(-999)，由 inventory 插件负责）。
const { test } = require('node:test')
const assert = require('node:assert')
const { useItemPlaceParams, armAnimationParams } = require('../lib/gtnh/actions')

test('使用物品 = block_place(-1,255,-1)，面 -1，光标全 0', () => {
  const p = useItemPlaceParams({ blockId: 297, itemCount: 3, itemDamage: 0, gtnhFlag: 3 })
  assert.deepStrictEqual({ x: p.location.x, y: p.location.y, z: p.location.z }, { x: -1, y: 255, z: -1 })
  assert.strictEqual(p.direction, -1)
  assert.deepStrictEqual([p.cursorX, p.cursorY, p.cursorZ], [0, 0, 0])
  // 物品本身走 GTNH 的 slot 格式：尾字节 = count
  assert.strictEqual(p.heldItem.blockId, 297)
  assert.strictEqual(p.heldItem.itemCount, 3)
  assert.strictEqual(p.heldItem.gtnhFlag, 3)
})

test('挥手包要带 entityId（1.7 的 arm_animation 没有 hand 字段）', () => {
  const bot = { version: '1.7.10', entity: { id: 4242 } }
  const p = armAnimationParams(bot)
  assert.strictEqual(p.entityId, 4242)
  assert.strictEqual(p.animation, 0)
})
