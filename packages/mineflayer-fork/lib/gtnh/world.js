'use strict'

/*
 * GTNH-PATCH: 1.7.10 的"世界"。
 *
 * mineflayer 上游用 prismarine-chunk + prismarine-world，两者都是 1.8+ 的状态 id 模型，
 * 对 1.7.10 根本没有实现（prismarine-chunk 抛 No chunk implementation for pc 1.7）。
 * 这个文件用我们自己的 prismarine-chunk-1.7 撑出 mineflayer 需要的世界接口：
 *
 *   getColumn / getColumnAt / setColumn / unloadColumn
 *   getBlock / setBlock / setBlockStateId / raycast
 *   EventEmitter（chunkColumnLoad / chunkColumnUnload / blockUpdate）
 *
 * 方块 id 是 GTNH 的 24 位 id（EndlessIDs），原版 prismarine-block 的 stateId 只有
 * 12 位，所以这里对 >4095 的 id 自己造方块对象（碰撞箱按整块算）。
 */

const { EventEmitter } = require('events')
const { Vec3 } = require('vec3')
const { ChunkStore, META_SCALE } = require('prismarine-chunk-1.7')
const { RaycastIterator } = require('prismarine-world/src/iterators')

const FULL_CUBE = [[0, 0, 0, 1, 1, 1]]

class GTNHWorld extends EventEmitter {
  constructor ({ version = '1.7.10', nameOf = null } = {}) {
    super()
    this.mcData = require('minecraft-data')(version)
    this.Block = require('prismarine-block')(version)
    this.store = new ChunkStore()
    // 注意：prismarine-registry 的 blocks 和 minecraft-data 的 blocks 可能是同一个对象，
    // loader 往里灌 GTNH 方块后，mcData.blocks[id] 对 mod 方块也会「有值」。
    // 这里先记下原版真正认识的 id，免得把 mod 方块当成原版方块造出 bb=empty 的对象。
    this.knownBlockIds = new Set(Object.keys(this.mcData.blocks))
    this.nameOf = nameOf // (blockId) => 注册名 | null
    this._prototypes = new Map()
  }

  get columns () {
    return this.store.columns
  }

  getColumn (chunkX, chunkZ) {
    return this.store.getColumn(chunkX, chunkZ)
  }

  getColumnAt (pos) {
    return this.store.getColumn(Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4)
  }

  setColumn (chunkX, chunkZ, column) {
    this.store.setColumn(chunkX, chunkZ, column)
    this.emit('chunkColumnLoad', new Vec3(chunkX * 16, 0, chunkZ * 16))
    return true
  }

  unloadColumn (chunkX, chunkZ) {
    this.store.unloadColumn(chunkX, chunkZ)
    this.emit('chunkColumnUnload', new Vec3(chunkX * 16, 0, chunkZ * 16))
  }

  /* 名字表变了（FML 注册表到位后）要丢掉旧原型，否则会一直显示 unknown:<id> */
  invalidate () {
    this._prototypes.clear()
  }

  /* 方块原型：同一个 (id, meta) 只造一次，位置上再派生 */
  _prototype (id, meta) {
    const key = `${id}:${meta}`
    let proto = this._prototypes.get(key)
    if (proto) return proto

    const descriptor = this.knownBlockIds.has(String(id)) ? this.mcData.blocks[id] : null
    const registeredName = this.nameOf ? this.nameOf(id) : null
    // 注册表里有名字、但 minecraft-data 不认识 → 一样按整块处理
    if (descriptor) {
      proto = new this.Block(id, 0, meta & 0xf)
      // 统一 stateId 口径（prismarine-block 给的是原版 (id<<4)|meta，装不下 24 位 id）
      proto.stateId = id * META_SCALE + meta
      // 名字优先用 FML 注册表（GTNH 的 id 与 minecraft-data 对不上）
      if (registeredName) {
        proto.name = registeredName
        proto.displayName = registeredName
      }
    } else {
      // GTNH 的 24 位 id 或未知 mod 方块：按整块处理
      proto = Object.create(this.Block.prototype)
      proto.type = id
      proto.metadata = meta
      proto.stateId = id * META_SCALE + meta
      proto.name = (this.nameOf && this.nameOf(id)) || `unknown:${id}`
      proto.displayName = proto.name
      proto.hardness = 1.5
      proto.shapes = FULL_CUBE
      proto.boundingBox = 'block'
      proto.diggable = true
      proto.transparent = false
      proto
        .material = null
      proto.harvestTools = undefined
      proto.drops = []
      proto.light = 0
      proto.skyLight = 0
      proto.biome = 0
      proto.computedStates = undefined
      proto._properties = undefined
      proto.isWaterlogged = false
    }
    this._prototypes.set(key, proto)
    return proto
  }

  getBlock (pos, extraInfos = false) {
    const x = Math.floor(pos.x)
    const y = Math.floor(pos.y)
    const z = Math.floor(pos.z)
    const column = this.store.getColumn(x >> 4, z >> 4)
    if (!column) return null
    if (y < column.minY || y >= column.maxY) return null
    const local = { x: x & 15, y, z: z & 15 }
    const block = Object.create(this._prototype(column.getBlockId(local), column.getMetadata(local)))
    block.position = new Vec3(x, y, z)
    block.light = column.getBlockLight(local)
    block.skyLight = column.getSkyLight(local)
    block.biome = column.getBiome(local)
    if (extraInfos) block.painting = undefined
    return block
  }

  /* mineflayer 的接口是按 stateId 写的；我们这里 stateId = blockId * 65536 + metadata */
  setBlockStateId (pos, stateId) {
    const column = this.store.getColumn(Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4)
    if (!column) return
    column.setBlockStateId({ x: Math.floor(pos.x) & 15, y: Math.floor(pos.y), z: Math.floor(pos.z) & 15 }, stateId)
  }

  setBlock (pos, blockId, metadata = 0) {
    const column = this.store.getColumn(Math.floor(pos.x) >> 4, Math.floor(pos.z) >> 4)
    if (!column) return false
    column.setBlockStateId({ x: Math.floor(pos.x) & 15, y: Math.floor(pos.y), z: Math.floor(pos.z) & 15 }, blockId * META_SCALE + metadata)
    return true
  }

  raycast (from, direction, range, matcher = null) {
    const iter = new RaycastIterator(from, direction, range)
    let pos = from
    while (pos) {
      const block = this.getBlock(pos)
      if (block && (!matcher || matcher(block))) {
        const intersect = iter.intersect(block.shapes, block.position)
        if (intersect) {
          block.face = intersect.face
          block.intersect = intersect.pos
          return block
        }
      }
      pos = iter.next()
    }
    return null
  }
}

module.exports = { GTNHWorld }
