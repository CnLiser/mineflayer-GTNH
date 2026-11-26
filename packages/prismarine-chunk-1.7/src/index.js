'use strict'

/*
 * prismarine-chunk-1.7 —— 1.7.10 的区块存储（GTNH 变体）。
 *
 * 上游 prismarine-chunk 没有 1.7 实现，而 1.7.10 的方块数组又是定长直存
 * （没有 1.8+ 的调色板），所以单独做一份最小的：
 *
 *   const { ChunkColumn, ChunkStore, encodeState } = require('prismarine-chunk-1.7')
 *   const store = new ChunkStore()
 *   store.applyBulk(decodeMapChunkBulk(payload))       // 区块包
 *   store.applyBlockChange(decodeBlockChange(payload)) // 单方块
 *   store.getBlock({ x, y, z })                        // { blockId, metadata, ... } | null
 *
 * 方块状态编码：stateId = blockId * 65536 + metadata（见 chunk-column.js 的说明）。
 */

const {
  ChunkColumn,
  SECTION_COUNT,
  SECTION_HEIGHT,
  WORLD_HEIGHT,
  BLOCKS_PER_SECTION,
  META_SCALE,
  encodeState,
  decodeState
} = require('./chunk-column')
const { ChunkSection, blockIndex } = require('./section')
const { ChunkStore } = require('./world')

module.exports = {
  ChunkColumn,
  ChunkSection,
  ChunkStore,
  SECTION_COUNT,
  SECTION_HEIGHT,
  WORLD_HEIGHT,
  BLOCKS_PER_SECTION,
  META_SCALE,
  encodeState,
  decodeState,
  blockIndex
}
