'use strict'

/*
 * 区块表：按 "cx,cz" 存柱体，给 mineflayer 的 world 打底。
 *
 * 只做「存 + 按世界坐标查」，不做加载/卸载策略（那是 mineflayer-gtnh 的 world 层的事）。
 * 未加载的柱体一律返回 null —— 与 mineflayer 的 blockAt 语义一致（不能假装那里是空气）。
 */

const { ChunkColumn, WORLD_HEIGHT } = require('./chunk-column')

function key (x, z) {
  return `${x},${z}`
}

function posOf (pos) {
  if (Array.isArray(pos)) return { x: pos[0], y: pos[1], z: pos[2] }
  return pos
}

class ChunkStore {
  constructor (options = {}) {
    this.columns = new Map()
    this.columnCount = 0
    this.blockUpdates = 0
    this.lastError = null
    this.worldHeight = options.worldHeight ?? WORLD_HEIGHT
  }

  /* ---------------------------------------------------------------- */

  getColumn (cx, cz) {
    return this.columns.get(key(cx, cz)) || null
  }

  // 不存在就建（收到的区块包、或本地预生成的柱体）
  ensureColumn (cx, cz) {
    const k = key(cx, cz)
    let column = this.columns.get(k)
    if (!column) {
      column = new ChunkColumn({ x: cx * 16, z: cz * 16, worldHeight: this.worldHeight })
      this.columns.set(k, column)
      this.columnCount++
    }
    return column
  }

  setColumn (cx, cz, column) {
    const k = key(cx, cz)
    if (!this.columns.has(k)) this.columnCount++
    this.columns.set(k, column)
  }

  unloadColumn (cx, cz) {
    if (this.columns.delete(key(cx, cz))) this.columnCount--
  }

  clear () {
    this.columns.clear()
    this.columnCount = 0
  }

  /* ---------------------------------------------------------------- */
  /* 解码器输出 → 柱体                                                 */
  /* ---------------------------------------------------------------- */

  // col = decodeChunkData(...) 或 decodeMapChunkBulk(...).columns[i]，x/z 是方块坐标
  applyDecodedColumn (col) {
    const cx = Math.floor(col.x / 16)
    const cz = Math.floor(col.z / 16)
    const column = this.ensureColumn(cx, cz)
    column.setFromDecoded(col)
    return column
  }

  applyBulk (bulk) {
    for (const col of bulk.columns) this.applyDecodedColumn(col)
    return bulk.columns.length
  }

  applyBlockChange (change) {
    const cx = Math.floor(change.x / 16)
    const cz = Math.floor(change.z / 16)
    const column = this.getColumn(cx, cz)
    if (!column) return false // 没加载的区块不追
    column.applyBlockChange(change)
    this.blockUpdates++
    return true
  }

  applyMultiBlockChange (multi) {
    const column = this.getColumn(multi.chunkX, multi.chunkZ)
    if (!column) return 0
    let n = 0
    for (const change of multi.changes) {
      column.applyBlockChange(change)
      n++
    }
    this.blockUpdates += n
    return n
  }

  /* ---------------------------------------------------------------- */
  /* 查询                                                              */
  /* ---------------------------------------------------------------- */

  // 返回 { x, y, z, blockId, metadata, biome, blockLight, skyLight } 或 null
  getBlock (pos) {
    const { x, y, z } = posOf(pos)
    if (y < 0 || y >= this.worldHeight) return null
    const column = this.getColumn(Math.floor(x / 16), Math.floor(z / 16))
    if (!column) return null
    const local = { x, y, z }
    return {
      x,
      y,
      z,
      blockId: column.getBlockId(local),
      metadata: column.getMetadata(local),
      biome: column.getBiome(local),
      blockLight: column.getBlockLight(local),
      skyLight: column.getSkyLight(local)
    }
  }

  getBlockId (pos) {
    const block = this.getBlock(pos)
    return block ? block.blockId : null
  }

  isLoaded (x, z) {
    return this.columns.has(key(Math.floor(x / 16), Math.floor(z / 16)))
  }

  // 统计：给冒烟脚本看的
  stats () {
    let sections = 0
    let nonEmpty = 0
    let maxBlockId = 0
    let maxMetadata = 0
    let maxSky = 0
    let maxBlock = 0
    for (const column of this.columns.values()) {
      for (const section of column.sections) {
        if (!section) continue
        sections++
        if (section.isEmpty()) continue
        nonEmpty++
        for (let i = 0; i < section.blockIds.length; i++) {
          const id = section.blockIds[i]
          const meta = section.metadata[i]
          if (id > maxBlockId) maxBlockId = id
          if (meta > maxMetadata) maxMetadata = meta
        }
        if (section.skyLight) for (let i = 0; i < 4096; i++) if (section.skyLight[i] > maxSky) maxSky = section.skyLight[i]
        if (section.blockLight) for (let i = 0; i < 4096; i++) if (section.blockLight[i] > maxBlock) maxBlock = section.blockLight[i]
      }
    }
    return { columns: this.columnCount, sections, nonEmpty, maxBlockId, maxMetadata, maxSkyLight: maxSky, maxBlockLight: maxBlock, blockUpdates: this.blockUpdates }
  }
}

module.exports = { ChunkStore, key }
