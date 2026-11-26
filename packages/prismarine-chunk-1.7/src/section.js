'use strict'

/*
 * 1.7.10 的 16 层段（section）。
 *
 * 与 1.8+ 的「调色板 + 位压缩」不同，1.7.10 的方块数组是定长直存：
 *   - GTNH 上 blockId 是 24 位（EndlessIDs），所以用 Uint32Array（原版只需 Uint16）；
 *   - metadata 是 16 位（EndlessIDs），原版 4 位；
 *   - 光照按「一个字节一个值」存（0..15），不用半字节压——解码器本来就把半字节展开了，
 *     再压回去只会让读写变慢；一个满配段多占 2KB，换来的是读写都只有一次数组访问。
 *
 * 段内索引顺序与上游 prismarine-chunk 一致：((y & 0xf) << 8) | ((z & 0xf) << 4) | (x & 0xf)
 */

const BLOCKS_PER_SECTION = 4096

function blockIndex (x, y, z) {
  return ((y & 0xf) << 8) | ((z & 0xf) << 4) | (x & 0xf)
}

class ChunkSection {
  constructor (y) {
    this.y = y
    this.blockIds = new Uint32Array(BLOCKS_PER_SECTION)
    this.metadata = new Uint16Array(BLOCKS_PER_SECTION)
    // 光照按需分配：只有服务端发过光照的段才有数组
    this.blockLight = null
    this.skyLight = null
  }

  static index (x, y, z) {
    return blockIndex(x, y, z)
  }

  getBlockId (x, y, z) {
    return this.blockIds[blockIndex(x, y, z)]
  }

  setBlockId (x, y, z, id) {
    this.blockIds[blockIndex(x, y, z)] = id >>> 0
  }

  getMetadata (x, y, z) {
    return this.metadata[blockIndex(x, y, z)]
  }

  setMetadata (x, y, z, meta) {
    this.metadata[blockIndex(x, y, z)] = meta & 0xffff
  }

  getBlockLight (x, y, z) {
    return this.blockLight ? this.blockLight[blockIndex(x, y, z)] : 0
  }

  setBlockLight (x, y, z, light) {
    if (!this.blockLight) this.blockLight = new Uint8Array(BLOCKS_PER_SECTION)
    this.blockLight[blockIndex(x, y, z)] = light & 0x0f
  }

  getSkyLight (x, y, z) {
    return this.skyLight ? this.skyLight[blockIndex(x, y, z)] : 0
  }

  setSkyLight (x, y, z, light) {
    if (!this.skyLight) this.skyLight = new Uint8Array(BLOCKS_PER_SECTION)
    this.skyLight[blockIndex(x, y, z)] = light & 0x0f
  }

  // 该段是否「全空」——blockId 全 0 且没有光照，序列化时可以跳掉
  isEmpty () {
    for (let i = 0; i < BLOCKS_PER_SECTION; i++) {
      if (this.blockIds[i] !== 0 || this.metadata[i] !== 0) return false
    }
    return true
  }
}

module.exports = { ChunkSection, BLOCKS_PER_SECTION, blockIndex }
