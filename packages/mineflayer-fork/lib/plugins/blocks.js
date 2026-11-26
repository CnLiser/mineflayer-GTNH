'use strict'

/*
 * GTNH-PATCH: 这个文件整个重写成 1.7.10 版本。
 *
 * 上游的 blocks 插件是按 1.8+ 写的：prismarine-chunk 的调色板/状态 id、
 * map_chunk/map_chunk_bulk 的字段、block_change 的 varint 状态 id，1.7.10 全都不一样。
 * protocol-fml 那一层已经把区块和方块包解成 gtnh_* 事件，这里只负责：
 *
 *   - 建世界（我们的 GTNHWorld）
 *   - blockAt / findBlock(s) / canSeeBlock / waitForChunksToLoad
 *   - 把区块、方块变更、方块实体灌进世界
 */

const { Vec3 } = require('vec3')
const { onceWithCleanup } = require('../promise_utils')
const { OctahedronIterator } = require('prismarine-world').iterators
const { GTNHWorld } = require('../gtnh/world')
const { META_SCALE } = require('prismarine-chunk-1.7')

module.exports = inject

function inject (bot, { version, storageBuilder, hideErrors }) {
  const mcData = require('minecraft-data')(version ?? '1.7.10')
  const world = new GTNHWorld({
    version: version ?? '1.7.10',
    // GTNH-PATCH: 方块名来自 ModIdData 注册表（client.fml.registry.blocks），
    // minecraft-data 里没有 GT 的方块
    nameOf: (id) => {
      const fml = bot._client && bot._client.fml
      const blocks = fml && fml.registry && fml.registry.blocks
      // FmlHandshake 里 blocks 是 Map<id, 名字>
      if (blocks instanceof Map) {
        const name = blocks.get(id) ?? blocks.get(Number(id)) ?? blocks.get(String(id))
        if (name) return name
      } else if (blocks && blocks[id]) {
        return blocks[id]
      }
      const descriptor = mcData.blocks[id]
      return descriptor ? descriptor.name : null
    }
  })
  bot.world = world
  bot.blockEntities = new Map()

  const blockUpdateListeners = new Set()

  function emitBlockUpdate (oldBlock, newBlock) {
    bot.emit('blockUpdate', oldBlock, newBlock)
    bot.emit(`blockUpdate:${newBlock.position}`, oldBlock, newBlock)
  }

  function blockAt (absolutePoint, extraInfos = true) {
    return world.getBlock(absolutePoint, extraInfos)
  }

  function blockKey (pos) {
    return `${pos.x},${pos.y},${pos.z}`
  }

  function setBlockEntity (pos, entity) {
    bot.blockEntities.set(blockKey(pos), entity)
  }

  /* ---------- 区块 ---------- */

  function applyColumn (decoded, source) {
    const column = columnFromDecoded(decoded)
    const chunkX = Math.floor(decoded.x / 16)
    const chunkZ = Math.floor(decoded.z / 16)
    const existed = world.getColumn(chunkX, chunkZ) !== null
    world.setColumn(chunkX, chunkZ, column)
    if (!existed) bot.emit('chunkColumnLoad', new Vec3(chunkX * 16, 0, chunkZ * 16))
    bot.emit('chunk', decoded, source)
  }

  function columnFromDecoded (decoded) {
    const { ChunkColumn } = require('prismarine-chunk-1.7')
    const column = new ChunkColumn()
    column.setFromDecoded(decoded)
    return column
  }

  // protocol-fml 解好的单列（0x21，GTNH 里基本不发）
  bot._client.on('gtnh_chunk', (chunk) => applyColumn(chunk, 'map_chunk'))
  // 多列（0x26，GTNH 实际用的）
  bot._client.on('gtnh_chunk_bulk', (bulk) => {
    for (const column of bulk.columns) applyColumn(column, 'map_chunk_bulk')
  })

  /* ---------- 方块变更 ---------- */

  function setBlockAndEmit (pos, blockId, metadata) {
    const point = new Vec3(pos.x, pos.y, pos.z)
    const oldBlock = blockAt(point)
    if (!world.setBlock(point, blockId, metadata)) return
    const newBlock = blockAt(point)
    emitBlockUpdate(oldBlock, newBlock)
    bot.emit('blockUpdateAny', point, blockId, metadata)
  }

  bot._client.on('gtnh_block_change', (change) => {
    setBlockAndEmit(change, change.blockId, change.metadata)
  })

  bot._client.on('gtnh_multi_block_change', (multi) => {
    for (const change of multi.changes) setBlockAndEmit(change, change.blockId, change.metadata)
  })

  /* ---------- 方块实体 / 告示牌之类 ---------- */

  bot._client.on('tile_entity_data', (packet) => {
    if (typeof packet.location !== 'object') {
      setBlockEntity(packet.location, packet.nbtData)
      return
    }
    const pos = new Vec3(packet.location.x, packet.location.y, packet.location.z)
    setBlockEntity(pos, packet.nbtData)
  })

  /* ---------- 查询 ---------- */

  function getMatchingFunction (matching) {
    if (typeof matching !== 'function') {
      if (!Array.isArray(matching)) matching = [matching]
      return (block) => block !== null && matching.indexOf(block.type) >= 0
    }
    return matching
  }

  function toVec3 (pos) {
    return pos instanceof Vec3 ? pos : new Vec3(pos.x, pos.y, pos.z)
  }

  bot.blockAt = blockAt

  bot.findBlocks = (options) => {
    const matcher = getMatchingFunction(options.matching)
    const point = toVec3(options.point || bot.entity.position).floored()
    const maxDistance = options.maxDistance || 16
    const count = options.count || 1
    const useExtraInfo = options.useExtraInfo || false
    const fullMatcher = typeof useExtraInfo === 'boolean' && useExtraInfo
      ? (p) => matcher(blockAt(p, true))
      : (p) => {
          const block = blockAt(p, true)
          return matcher(block) && (typeof useExtraInfo === 'function' ? useExtraInfo(block) : true)
        }

    const start = new Vec3(Math.floor(point.x / 16), Math.floor(point.y / 16), Math.floor(point.z / 16))
    const it = new OctahedronIterator(start, Math.ceil((maxDistance + 8) / 16))
    let next = start
    let found = []
    const visited = new Set()
    let startedLayer = 0
    while (next) {
      const column = world.getColumn(next.x, next.z)
      const sectionY = next.y
      if (column && sectionY >= 0 && sectionY < column.sectionCount && !visited.has(next.toString())) {
        visited.add(next.toString())
        const begin = new Vec3(next.x * 16, sectionY * 16, next.z * 16)
        const cursor = begin.clone()
        for (cursor.x = begin.x; cursor.x < begin.x + 16; cursor.x++) {
          for (cursor.y = begin.y; cursor.y < begin.y + 16; cursor.y++) {
            for (cursor.z = begin.z; cursor.z < begin.z + 16; cursor.z++) {
              if (fullMatcher(cursor) && cursor.distanceTo(point) <= maxDistance) found.push(cursor.clone())
            }
          }
        }
      }
      if (startedLayer !== it.apothem && found.length >= count) break
      startedLayer = it.apothem
      next = it.next()
    }
    found.sort((a, b) => a.distanceTo(point) - b.distanceTo(point))
    if (found.length > count) found = found.slice(0, count)
    return found
  }

  bot.findBlock = (options) => {
    const blocks = bot.findBlocks(options)
    return blocks.length ? blockAt(blocks[0]) : null
  }

  bot.canSeeBlock = (block) => {
    const headPos = bot.entity.position.offset(0, bot.entity.eyeHeight, 0)
    const range = headPos.distanceTo(block.position)
    const dir = block.position.offset(0.5, 0.5, 0.5).minus(headPos)
    const hit = world.raycast(headPos, dir.normalize(), range, (b) => b !== null)
    return !!hit && hit.position.equals(block.position)
  }

  bot.waitForChunksToLoad = async () => {
    const until = Date.now() + 10000
    while (Date.now() < until) {
      const column = world.getColumnAt(bot.entity.position)
      if (column) return
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error('等待区块加载超时（10000ms）')
  }

  /* 兼容上游的一些小接口 */
  bot.world.getBlockStateId = (pos) => {
    const block = blockAt(pos)
    return block ? block.stateId : 0
  }
  bot.world.setBlockStateId = (pos, stateId) => {
    world.setBlockStateId(pos, stateId)
  }
  bot.world.blockAt = (pos) => blockAt(pos)

  // GTNH-PATCH: 1.7.10 没有 block state，挖完之后 digging 插件会调 bot._updateBlockState(pos, 0)
  // 期望本地立刻变成空气；这里把 stateId 拆回 blockId/meta 再写进我们的世界。
  bot._updateBlockState = (point, stateId) => {
    const blockId = Math.floor(stateId / META_SCALE)
    const metadata = stateId % META_SCALE
    world.setBlock(point, blockId, metadata)
  }
  bot._client.on('unload_chunk', (packet) => world.unloadColumn(packet.chunkX, packet.chunkZ))
  bot.on('end', () => blockUpdateListeners.clear())
}
