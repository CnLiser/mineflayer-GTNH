const { test } = require('node:test')
const assert = require('node:assert')
const { toolFor, needs, toolCounts, count } = require('../src/harvest')

test('矿石按材料报等级', () => {
  assert.deepEqual(toolFor('minecraft:stone'), { tool: 'pickaxe', level: 0 })
  assert.deepEqual(toolFor('minecraft:iron_ore'), { tool: 'pickaxe', level: 2 })
  assert.deepEqual(toolFor('minecraft:diamond_ore'), { tool: 'pickaxe', level: 4 })
})

test('GT 机器和线缆要扳手/剪线钳', () => {
  const wrench = toolFor('gregtech:gt.blockmachines', 1)
  assert.equal(wrench.tool, 'wrench')
  assert.ok(wrench.level >= 1)
  assert.equal(needs('gregtech:gt.blockmachines', 5), true)
})

test('meta 精确查不到时回落到 0', () => {
  assert.deepEqual(toolFor('minecraft:stone', 7), { tool: 'pickaxe', level: 0 })
})

test('表里没有的方块返回 null', () => {
  assert.equal(toolFor('minecraft:air'), null)
  assert.equal(toolFor('no_such_block:thing'), null)
  assert.equal(needs('no_such_block:thing'), false)
})

test('工具分布覆盖镐/扳手/斧/锹', () => {
  const counts = toolCounts()
  assert.ok(counts.pickaxe > 1000)
  assert.ok(counts.wrench > 100)
  assert.ok(counts.axe > 100)
  assert.ok(counts.shovel > 100)
  assert.ok(count() > 10000)
})
