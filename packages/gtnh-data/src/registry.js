'use strict'

/*
 * 服务器端的方块/物品注册表（FML ModIdData）。
 *
 * 关键点：**id 是服务器运行时分配的**，同一个整合包里少一个 mod 就会整体错位，
 * 所以注册表必须跟着具体的服务器/整合包走（tools/dump-registry.js 抓一份存一份）。
 *
 * 注册表里的名字是 GTNH 的全名，例如：
 *   7    -> minecraft:bedrock
 *   12   -> minecraft:sand
 *   11298-> ProjRed|Exploration:projectred.exploration.lily
 */

class ModRegistry {
  constructor (data = {}) {
    this.blocks = new Map()
    this.items = new Map()
    this._blockIdsByName = new Map()
    this._itemIdsByName = new Map()
    const entries = (value) => value instanceof Map ? value.entries() : Object.entries(value ?? {})
    for (const [id, name] of entries(data.blocks)) {
      this._addBlock(Number(id), name)
    }
    for (const [id, name] of entries(data.items)) {
      this._addItem(Number(id), name)
    }
    this.meta = {
      host: data.host,
      port: data.port,
      capturedAt: data.capturedAt,
      mods: data.mods
    }
  }

  _addBlock (id, name) {
    this.blocks.set(id, name)
    // 同名多 id 时保留最小的：GTNH 里同一个方块可能被注册多次（替换/别名）
    if (!this._blockIdsByName.has(name)) this._blockIdsByName.set(name, id)
  }

  _addItem (id, name) {
    this.items.set(id, name)
    if (!this._itemIdsByName.has(name)) this._itemIdsByName.set(name, id)
  }

  static fromObject (data) {
    return new ModRegistry(data)
  }

  static fromJSON (json) {
    return new ModRegistry(JSON.parse(json))
  }

  /* ---------------- 查询 ---------------- */

  blockName (id) {
    return this.blocks.get(id)
  }

  blockId (name) {
    return this._blockIdsByName.get(name)
  }

  itemName (id) {
    return this.items.get(id)
  }

  itemId (name) {
    return this._itemIdsByName.get(name)
  }

  hasBlock (id) {
    return this.blocks.has(id)
  }

  // 名字 -> { id, metadata }：GTNH 的名字里可能带 ":meta" 后缀（如 "minecraft:stone:1"）
  parseBlockName (name) {
    const parts = name.split(':')
    let metadata = 0
    let base = name
    if (parts.length === 3) {
      metadata = Number(parts[2])
      base = `${parts[0]}:${parts[1]}`
    }
    const id = this._blockIdsByName.get(name) ?? this._blockIdsByName.get(base)
    return id === undefined ? null : { id, metadata: Number.isFinite(metadata) ? metadata : 0 }
  }

  get blockCount () {
    return this.blocks.size
  }

  get itemCount () {
    return this.items.size
  }

  // 覆盖了哪些 mod（按名字前缀统计），用来检查注册表跟整合包对不对得上
  modPrefixes () {
    const counts = new Map()
    for (const name of this.blocks.values()) {
      const prefix = name.includes(':') ? name.slice(0, name.indexOf(':')) : name
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1)
    }
    return counts
  }

  summary () {
    const ids = [...this.blocks.keys()]
    return {
      blocks: this.blocks.size,
      items: this.items.size,
      blockIdRange: ids.length ? [Math.min(...ids), Math.max(...ids)] : [0, 0],
      mods: this.meta.mods
    }
  }
}

module.exports = { ModRegistry }
