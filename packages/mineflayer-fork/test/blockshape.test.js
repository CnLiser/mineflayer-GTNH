'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { blockShapes } = require('../lib/gtnh/blockshape')

function heights (shapes) {
  return shapes.map(s => [s.minY, s.maxY])
}

test('半砖是 0..0.5，双半砖（metadata 8）是整块', () => {
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:stone_slab', metadata: 0, boundingBox: 'block' })), [[0, 0.5]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:wooden_slab', metadata: 2, boundingBox: 'block' })), [[0, 0.5]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:stone_slab', metadata: 8, boundingBox: 'block' })), [[0, 1]])
})

test('台阶默认 0..0.5，倒置（metadata 8）在上半格', () => {
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:stone_stairs', metadata: 0, boundingBox: 'block' })), [[0, 0.5]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:stone_stairs', metadata: 8, boundingBox: 'block' })), [[0.5, 1]])
})

test('栅栏/墙是 1.5 格高', () => {
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:fence', metadata: 0, boundingBox: 'block' })), [[0, 1.5]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:cobblestone_wall', metadata: 0, boundingBox: 'block' })), [[0, 1.5]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:fence_gate', metadata: 0, boundingBox: 'block' })), [[0, 1.5]])
})

test('地毯 1/16、雪层按层数、0 层可穿过', () => {
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:carpet', metadata: 0, boundingBox: 'block' })), [[0, 0.0625]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:snow_layer', metadata: 3, boundingBox: 'block' })), [[0, 0.375]])
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:snow_layer', metadata: 0, boundingBox: 'block' })), [])
})

test('没进表的方块按整块，空气与未加载返回空', () => {
  assert.deepEqual(heights(blockShapes({ name: 'minecraft:stone', metadata: 0, boundingBox: 'block' })), [[0, 1]])
  assert.deepEqual(heights(blockShapes({ name: 'gregtech:gt.blockmachines', metadata: 0, boundingBox: 'block' })), [[0, 1]])
  assert.deepEqual(blockShapes(null), [])
  assert.deepEqual(blockShapes({ name: 'minecraft:air', boundingBox: 'empty' }), [])
})

test('数据里已经有 shapes 时直接采用，不再查表', () => {
  const custom = [{ minX: 0.25, minY: 0, minZ: 0.25, maxX: 0.75, maxY: 1, maxZ: 0.75 }]
  assert.equal(blockShapes({ name: 'minecraft:stone_slab', metadata: 0, boundingBox: 'block', shapes: custom }), custom)
})
