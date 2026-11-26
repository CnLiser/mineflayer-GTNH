'use strict'

/*
 * 一个 1.7.10 区块柱体（16×16×256）。
 *
 * 坐标约定：pos 可以是 {x,y,z} 也可以是 [x,y,z]，x/z 是**世界坐标**（与 prismarine-chunk 一致，
 * 柱体自己只做 x&15 / z&15）。y 是 0..255。
 *
 * 方块状态：GTNH 的 id 是 24 位、metadata 是 16 位，塞不进原版的 (id<<4)|meta。
 * 本包统一用 stateId = id * 65536 + metadata（最大 2^40，远小于 Number.MAX_SAFE_INTEGER）。
 * mineflayer 层要展示方块名时再拿 (id, meta) 去 gtnh-data 的注册表查。
 */

const { ChunkSection, BLOCKS_PER_SECTION } = require('./section')

const SECTION_COUNT = 16
const SECTION_HEIGHT = 16
const WORLD_HEIGHT = SECTION_COUNT * SECTION_HEIGHT
const META_SCALE = 65536

function encodeState (blockId, metadata) {
  return blockId * META_SCALE + (metadata & 0xffff)
}

function decodeState (stateId) {
  const metadata = stateId % META_SCALE
  return { blockId: (stateId - metadata) / META_SCALE, metadata }
}

function posOf (pos) {
  if (Array.isArray(pos)) return { x: pos[0], y: pos[1], z: pos[2] }
  return pos
}

class ChunkColumn {
  constructor (options = {}) {
    this.x = options.x ?? 0
    this.z = options.z ?? 0
    this.minY = options.minY ?? 0
    this.worldHeight = options.worldHeight ?? WORLD_HEIGHT
    this.sectionCount = Math.ceil(this.worldHeight / SECTION_HEIGHT)
    this.sections = new Array(this.sectionCount).fill(null)
    this.biomes = new Uint16Array(256) // GTNH 的生物群系是 16 位
    this.hasBiomes = false
    // 服务端发过的段位图：1 = 该段数据有效。C2S 里也会用到
    this.bitMap = 0
  }

  /* ---------------------------------------------------------------- */
  /* 段访问                                                            */
  /* ---------------------------------------------------------------- */

  sectionIndexFor (y) {
    return Math.floor((y - this.minY) / SECTION_HEIGHT)
  }

  getSectionAtIndex (index) {
    return this.sections[index] || null
  }

  setSectionAtIndex (index, section) {
    this.sections[index] = section
    this.bitMap = (this.bitMap | (1 << index)) & 0xffff
  }

  // 读写用：没有就建
  ensureSection (index) {
    if (!this.sections[index]) this.sections[index] = new ChunkSection(this.minY + index * SECTION_HEIGHT)
    return this.sections[index]
  }

  getSection (pos) {
    const { y } = posOf(pos)
    const index = this.sectionIndexFor(y)
    return this.sections[index] || null
  }

  /* ---------------------------------------------------------------- */
  /* 方块                                                              */
  /* ---------------------------------------------------------------- */

  getBlockId (pos) {
    const { x, y, z } = posOf(pos)
    const section = this.sections[this.sectionIndexFor(y)]
    if (!section) return 0
    return section.getBlockId(x, y, z)
  }

  getMetadata (pos) {
    const { x, y, z } = posOf(pos)
    const section = this.sections[this.sectionIndexFor(y)]
    if (!section) return 0
    return section.getMetadata(x, y, z)
  }

  getBlockStateId (pos) {
    return encodeState(this.getBlockId(pos), this.getMetadata(pos))
  }

  setBlockId (pos, blockId) {
    const { x, y, z } = posOf(pos)
    this.ensureSection(this.sectionIndexFor(y)).setBlockId(x, y, z, blockId)
  }

  setMetadata (pos, metadata) {
    const { x, y, z } = posOf(pos)
    this.ensureSection(this.sectionIndexFor(y)).setMetadata(x, y, z, metadata)
  }

  setBlockStateId (pos, stateId) {
    const { blockId, metadata } = decodeState(stateId)
    const { x, y, z } = posOf(pos)
    const section = this.ensureSection(this.sectionIndexFor(y))
    section.setBlockId(x, y, z, blockId)
    section.setMetadata(x, y, z, metadata)
  }

  /* ---------------------------------------------------------------- */
  /* 光照                                                              */
  /* ---------------------------------------------------------------- */

  getBlockLight (pos) {
    const { x, y, z } = posOf(pos)
    const section = this.sections[this.sectionIndexFor(y)]
    return section ? section.getBlockLight(x, y, z) : 0
  }

  setBlockLight (pos, light) {
    const { x, y, z } = posOf(pos)
    this.ensureSection(this.sectionIndexFor(y)).setBlockLight(x, y, z, light)
  }

  getSkyLight (pos) {
    const { x, y, z } = posOf(pos)
    const section = this.sections[this.sectionIndexFor(y)]
    return section ? section.getSkyLight(x, y, z) : 0
  }

  setSkyLight (pos, light) {
    const { x, y, z } = posOf(pos)
    this.ensureSection(this.sectionIndexFor(y)).setSkyLight(x, y, z, light)
  }

  /* ---------------------------------------------------------------- */
  /* 生物群系                                                          */
  /* ---------------------------------------------------------------- */

  biomeIndex (x, z) {
    return ((z & 0x0f) << 4) | (x & 0x0f)
  }

  getBiome (pos) {
    const { x, z } = posOf(pos)
    return this.biomes[this.biomeIndex(x, z)]
  }

  setBiome (pos, biomeId) {
    const { x, z } = posOf(pos)
    this.biomes[this.biomeIndex(x, z)] = biomeId & 0xffff
    this.hasBiomes = true
  }

  /* ---------------------------------------------------------------- */
  /* 吃解码器的输出                                                    */
  /* ---------------------------------------------------------------- */

  /*
   * decoded = protocol-fml 的 decodeChunkData / decodeMapChunkBulk 里的一列：
   *   { x, z, mask, sections[16], biomes: Uint16Array(256), hasBiomes, groundUp, skylight }
   * section 是 { blockIds: Uint32Array(4096), metadata: Uint16Array(4096),
   *              blockLight: Uint8Array(4096)|null, skyLight: ... }，段数组是惰性的（可能为 null）
   */
  setFromDecoded (decoded) {
    this.x = decoded.x ?? this.x
    this.z = decoded.z ?? this.z

    for (let i = 0; i < this.sectionCount; i++) {
      const incoming = decoded.sections[i]
      if (!incoming) continue
      const section = this.ensureSection(i)
      section.blockIds.set(incoming.blockIds)
      section.metadata.set(incoming.metadata)
      if (incoming.blockLight) {
        section.blockLight = new Uint8Array(incoming.blockLight)
      }
      if (incoming.skyLight) {
        section.skyLight = new Uint8Array(incoming.skyLight)
      }
    }

    if (decoded.biomes && decoded.hasBiomes !== false) {
      this.biomes.set(decoded.biomes)
      this.hasBiomes = true
    }
    this.bitMap = decoded.mask & 0xffff
    this.groundUp = decoded.groundUp !== false
    return this
  }

  // S23 单方块变更
  applyBlockChange (change) {
    this.setBlockId(change, change.blockId)
    this.setMetadata(change, change.metadata)
    return this
  }

  /* ---------------------------------------------------------------- */
  /* 序列化（供世界缓存用）                                            */
  /* ---------------------------------------------------------------- */

  // mineflayer / prismarine-world 会调 dump() 存盘，load() 读回
  dump () {
    const sections = []
    for (let i = 0; i < this.sectionCount; i++) {
      const s = this.sections[i]
      if (!s || s.isEmpty()) continue
      sections.push([
        i,
        Buffer.from(s.blockIds.buffer, s.blockIds.byteOffset, s.blockIds.byteLength).toString('base64'),
        Buffer.from(s.metadata.buffer, s.metadata.byteOffset, s.metadata.byteLength).toString('base64'),
        s.blockLight ? Buffer.from(s.blockLight).toString('base64') : null,
        s.skyLight ? Buffer.from(s.skyLight).toString('base64') : null
      ])
    }
    return {
      version: '1.7.10',
      x: this.x,
      z: this.z,
      minY: this.minY,
      worldHeight: this.worldHeight,
      bitMap: this.bitMap,
      biomes: Array.from(this.biomes),
      hasBiomes: this.hasBiomes,
      sections
    }
  }

  load (data) {
    if (!data || data.version !== '1.7.10') throw new Error(`prismarine-chunk-1.7: 不认识的存档版本 ${data && data.version}`)
    this.x = data.x
    this.z = data.z
    this.minY = data.minY ?? 0
    this.bitMap = data.bitMap ?? 0
    if (data.biomes) {
      this.biomes.set(data.biomes)
      this.hasBiomes = data.hasBiomes === true
    }
    this.sections = new Array(this.sectionCount).fill(null)
    for (const [index, ids, meta, blockLight, skyLight] of data.sections || []) {
      const s = this.ensureSection(index)
      const idsBuf = Buffer.from(ids, 'base64')
      const metaBuf = Buffer.from(meta, 'base64')
      s.blockIds.set(new Uint32Array(idsBuf.buffer, idsBuf.byteOffset, BLOCKS_PER_SECTION))
      s.metadata.set(new Uint16Array(metaBuf.buffer, metaBuf.byteOffset, BLOCKS_PER_SECTION))
      s.blockLight = blockLight ? new Uint8Array(Buffer.from(blockLight, 'base64')) : null
      s.skyLight = skyLight ? new Uint8Array(Buffer.from(skyLight, 'base64')) : null
    }
    return this
  }

  toJson () {
    return {
      x: this.x,
      z: this.z,
      biomes: Array.from(this.biomes),
      sections: this.sections.map((s, i) => s && { y: s.y, empty: s.isEmpty() }).filter(Boolean),
      generation: 0,
      version: '1.7.10'
    }
  }

  // 该柱体有多少个非空段——调试用
  nonEmptySectionCount () {
    let n = 0
    for (const s of this.sections) if (s && !s.isEmpty()) n++
    return n
  }
}

module.exports = {
  ChunkColumn,
  ChunkSection,
  SECTION_COUNT,
  SECTION_HEIGHT,
  WORLD_HEIGHT,
  BLOCKS_PER_SECTION,
  META_SCALE,
  encodeState,
  decodeState
}
