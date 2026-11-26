'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { Vec3 } = require('vec3')
const { ChunkColumn } = require('prismarine-chunk-1.7')
const { GTNHWorld } = require('../lib/gtnh/world')

function makeWorld () {
  // 只要有 blocksByName 就够（未知 id 会走「整块」兜底）
  return new GTNHWorld({})
}

function flatColumn (blockId = 1) {
  const column = new ChunkColumn(0, 0)
  for (let index = 0; index < 16; index++) {
    column.ensureSection(index).blockIds.fill(blockId)
  }
  return column
}

test('GTNHWorld: setColumn / getColumn 用区块坐标', () => {
  const world = makeWorld()
  world.setColumn(3, -2, flatColumn(1))
  assert.ok(world.getColumn(3, -2))
  assert.ok(world.getColumnAt(new Vec3(3 * 16, 0, -2 * 16)))
  assert.strictEqual(world.getColumn(0, 0), null)
})

test('GTNHWorld: getBlock 返回方块名与整块碰撞箱', () => {
  const world = makeWorld()
  world.setColumn(0, 0, flatColumn(12))
  const block = world.getBlock(new Vec3(1, 20, 2))
  assert.strictEqual(block.type, 12)
  assert.strictEqual(block.boundingBox, 'block')
})

test('GTNHWorld: 未加载区块返回 null', () => {
  const world = makeWorld()
  assert.strictEqual(world.getBlock(new Vec3(500, 20, 500)), null)
})

test('GTNHWorld: stateId = blockId * 65536 + metadata', () => {
  const world = makeWorld()
  world.setColumn(0, 0, flatColumn(0))
  world.setBlockStateId(new Vec3(2, 33, 3), 12 * 65536 + 5)
  const block = world.getBlock(new Vec3(2, 33, 3))
  assert.strictEqual(block.type, 12)
  assert.strictEqual(block.metadata, 5)
  assert.strictEqual(block.stateId, 12 * 65536 + 5)
})

test('GTNHWorld: raycast 找到第一个非空气方块', () => {
  const world = makeWorld()
  const column = flatColumn(0)
  const section = column.ensureSection(4)
  for (let i = 0; i < 4096; i++) section.blockIds[i] = 0
  section.blockIds[0] = 1 // (0, 64, 0)
  world.setColumn(0, 0, column)
  const hit = world.raycast(new Vec3(0.5, 70, 0.5), new Vec3(0, -1, 0), 8)
  assert.ok(hit)
  assert.deepStrictEqual([hit.position.x, hit.position.y, hit.position.z], [0, 64, 0])
  assert.ok(hit.face)
})
