'use strict'

const test = require('node:test')
const assert = require('node:assert')

const {
  ChunkColumn,
  ChunkStore,
  encodeState,
  decodeState,
  BLOCKS_PER_SECTION
} = require('../src')

// 造一列「解码器输出」，形状与 protocol-fml 的 decodeChunkData 一致
function fakeDecoded (x, z, mask) {
  const sections = new Array(16).fill(null)
  const newSection = () => ({
    blockIds: new Uint32Array(BLOCKS_PER_SECTION),
    metadata: new Uint16Array(BLOCKS_PER_SECTION),
    blockLight: null,
    skyLight: null,
    hasBlockIds: true,
    hasMetadata: true
  })
  for (let i = 0; i < 16; i++) {
    if (!(mask & (1 << i))) continue
    const s = newSection()
    s.blockIds[0] = 1 // (0,0,0) 局部
    s.metadata[0] = 3
    s.blockIds[257] = 3039 // 局部 (x=1, y=1, z=0)
    s.metadata[257] = 28931
    s.skyLight = new Uint8Array(BLOCKS_PER_SECTION).fill(15)
    s.blockLight = new Uint8Array(BLOCKS_PER_SECTION).fill(7)
    sections[i] = s
  }
  const biomes = new Uint16Array(256).fill(1)
  biomes[0] = 42
  return { x, z, mask, groundUp: true, sections, biomes, hasBiomes: true }
}

test('stateId 编码能装下 24 位 id 与 16 位 metadata', () => {
  for (const [id, meta] of [[0, 0], [7, 0], [3039, 28931], [16777215, 65535]]) {
    const state = encodeState(id, meta)
    assert.deepStrictEqual(decodeState(state), { blockId: id, metadata: meta })
    assert.ok(Number.isSafeInteger(state))
  }
})

test('柱体：按世界坐标读写方块与 metadata', () => {
  const column = new ChunkColumn({ x: 32, z: -16 })
  column.setBlockId({ x: 33, y: 5, z: -15 }, 3039)
  column.setMetadata({ x: 33, y: 5, z: -15 }, 12)
  assert.strictEqual(column.getBlockId({ x: 33, y: 5, z: -15 }), 3039)
  assert.strictEqual(column.getMetadata({ x: 33, y: 5, z: -15 }), 12)
  // 数组形式的位置也接受
  assert.strictEqual(column.getBlockStateId([33, 5, -15]), encodeState(3039, 12))
  // 没写过的位置是空气
  assert.strictEqual(column.getBlockId({ x: 32, y: 5, z: -16 }), 0)
})

test('柱体：光照与生物群系', () => {
  const column = new ChunkColumn({ x: 0, z: 0 })
  column.setSkyLight({ x: 1, y: 1, z: 1 }, 15)
  column.setBlockLight({ x: 1, y: 1, z: 1 }, 7)
  assert.strictEqual(column.getSkyLight({ x: 1, y: 1, z: 1 }), 15)
  assert.strictEqual(column.getBlockLight({ x: 1, y: 1, z: 1 }), 7)
  column.setBiome({ x: 2, z: 3 }, 42)
  assert.strictEqual(column.getBiome({ x: 2, z: 3 }), 42)
  assert.strictEqual(column.getBiome({ x: 15, z: 15 }), 0)
})

test('setFromDecoded：整列吃进来（含 24 位 id / 16 位 meta / 光照）', () => {
  const column = new ChunkColumn({ x: -16, z: 48 })
  column.setFromDecoded(fakeDecoded(-16, 48, 0b11))

  assert.strictEqual(column.bitMap, 0b11)
  assert.strictEqual(column.getBlockId({ x: -16, y: 0, z: 48 }), 1)
  assert.strictEqual(column.getMetadata({ x: -16, y: 0, z: 48 }), 3)
  // 第二个段
  assert.strictEqual(column.getBlockId({ x: -15, y: 17, z: 48 }), 3039)
  assert.strictEqual(column.getMetadata({ x: -15, y: 17, z: 48 }), 28931)
  assert.strictEqual(column.getSkyLight({ x: -16, y: 0, z: 48 }), 15)
  assert.strictEqual(column.getBlockLight({ x: -16, y: 0, z: 48 }), 7)
  assert.strictEqual(column.getBiome({ x: -16, z: 48 }), 42)
  // 没发过的段保持 null
  assert.strictEqual(column.getSectionAtIndex(5), null)
  assert.strictEqual(column.getBlockId({ x: -16, y: 80, z: 48 }), 0)
})

test('dump / load 往返', () => {
  const column = new ChunkColumn({ x: 16, z: 16 })
  column.setFromDecoded(fakeDecoded(16, 16, 0b1111))
  column.setBiome({ x: 16, z: 16 }, 130)
  const saved = column.dump()

  const restored = new ChunkColumn({ x: 0, z: 0 }).load(saved)
  assert.strictEqual(restored.x, 16)
  assert.strictEqual(restored.bitMap, 0b1111)
  assert.strictEqual(restored.getBlockId({ x: 16, y: 0, z: 16 }), 1)
  assert.strictEqual(restored.getBlockId({ x: 17, y: 49, z: 16 }), 3039)
  assert.strictEqual(restored.getMetadata({ x: 17, y: 49, z: 16 }), 28931)
  assert.strictEqual(restored.getSkyLight({ x: 16, y: 1, z: 16 }), 15)
  assert.strictEqual(restored.getBiome({ x: 16, z: 16 }), 130)
})

test('ChunkStore：未加载的区块查不到方块', () => {
  const store = new ChunkStore()
  assert.strictEqual(store.getBlock({ x: 0, y: 64, z: 0 }), null)
  assert.strictEqual(store.isLoaded(0, 0), false)

  store.applyDecodedColumn(fakeDecoded(0, 0, 0b1))
  assert.strictEqual(store.isLoaded(3, 3), true)
  const block = store.getBlock({ x: 0, y: 0, z: 0 })
  assert.strictEqual(block.blockId, 1)
  assert.strictEqual(block.metadata, 3)
  assert.strictEqual(block.biome, 42)
  // 另一个区块仍未加载
  assert.strictEqual(store.getBlock({ x: 16, y: 0, z: 0 }), null)
})

test('ChunkStore：批量区块 + 方块变更 + 统计', () => {
  const store = new ChunkStore()
  const bulk = {
    columns: [fakeDecoded(0, 0, 0b11), fakeDecoded(16, 0, 0b1)]
  }
  assert.strictEqual(store.applyBulk(bulk), 2)
  assert.strictEqual(store.columnCount, 2)

  // S23：改一块
  assert.strictEqual(store.applyBlockChange({ x: 1, y: 1, z: 0, blockId: 7, metadata: 0 }), true)
  assert.strictEqual(store.getBlock({ x: 1, y: 1, z: 0 }).blockId, 7)

  // S22：未加载的区块不追
  assert.strictEqual(store.applyMultiBlockChange({ chunkX: 9, chunkZ: 9, changes: [{ x: 145, y: 1, z: 145, blockId: 1, metadata: 0 }] }), 0)

  const stats = store.stats()
  assert.strictEqual(stats.columns, 2)
  assert.strictEqual(stats.maxBlockId, 3039)
  assert.strictEqual(stats.maxMetadata, 28931)
  assert.strictEqual(stats.maxSkyLight, 15)
  assert.strictEqual(stats.maxBlockLight, 7)
  assert.strictEqual(stats.blockUpdates, 1)
})
