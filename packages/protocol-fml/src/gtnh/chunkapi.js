'use strict'

/*
 * GTNH 1.7.10 的「ChunkAPI + EndlessIDs」线格式解码。
 *
 * 原版 1.7.10 的 S21/S22/S23 一旦装上 ChunkAPI 就换了载荷：
 *   区块数据不再是「id 低 8 位 + metadata + 光照 + 生物群系」的固定拼盘，
 *   而是一串 manager 的键值对，每个 manager 自己决定怎么摆数据；
 *   方块变更包也不再是 (blockId 12bit | metadata 4bit) 的位域。
 *
 * 本模块只做「字节 -> 结构化数据」，不做区块对象管理（那是 prismarine-chunk-1.7 的事）。
 *
 * 字段大小的来源：ChunkAPI 0.8.4 + EndlessIDs 1.7.4 的字节码（javap -c 逐条核对），
 * 见 docs/FINDINGS.md 的「ChunkAPI 线格式」一节。
 */

const zlib = require('zlib')
const { readVarInt } = require('../codec')

const SECTIONS = 16
const BLOCKS_PER_SECTION = 4096
const NIBBLE_BYTES = 2048

/* ------------------------------------------------------------------ */
/* 基础读取                                                            */
/* ------------------------------------------------------------------ */

function reader (buf, offset = 0) {
  let p = offset
  const need = (n) => {
    if (p + n > buf.length) throw new Error(`chunkapi: 越界读取 (需要 ${n} 字节，剩余 ${buf.length - p})`)
  }
  return {
    get position () { return p },
    set position (v) { p = v },
    get remaining () { return buf.length - p },
    u8 () { need(1); return buf[p++] },
    i16be () { need(2); const v = buf.readInt16BE(p); p += 2; return v },
    u16be () { need(2); const v = buf.readUInt16BE(p); p += 2; return v },
    i32be () { need(4); const v = buf.readInt32BE(p); p += 4; return v },
    i32le () { need(4); const v = buf.readInt32LE(p); p += 4; return v },
    u64be () { need(8); const v = buf.readBigInt64BE(p); p += 8; return v },
    bytes (n) { need(n); const v = buf.subarray(p, p + n); p += n; return v },
    varint () { const { value, size } = readVarInt(buf, p); p += size; return value },
    utf () {
      const len = this.varint()
      need(len)
      const s = buf.toString('utf8', p, p + len)
      p += len
      return s
    }
  }
}

/* ------------------------------------------------------------------ */
/* 位/半字节工具                                                       */
/* ------------------------------------------------------------------ */

function readNibble (arr, index) {
  const b = arr[index >> 1]
  return (index & 1) === 0 ? b & 0x0f : (b >> 4) & 0x0f
}

function newSection () {
  return {
    blockIds: new Uint32Array(BLOCKS_PER_SECTION),
    metadata: new Uint16Array(BLOCKS_PER_SECTION),
    blockLight: null,
    skyLight: null,
    hasBlockIds: false,
    hasMetadata: false,
    hasBlockLight: false,
    hasSkyLight: false
  }
}

function newChunk (mask) {
  // 只为 mask 里的段分配数组：一个 16 段满配的柱体要 576KB，机器人走到哪下到哪会撑爆内存
  const sections = new Array(SECTIONS).fill(null)
  return { mask, sections, biomes: new Uint16Array(256), hasBiomes: false, groundUp: true }
}

function sectionAt (chunk, index) {
  if (!chunk.sections[index]) chunk.sections[index] = newSection()
  return chunk.sections[index]
}

/* 半字节数组展开到 Uint16Array */
function readNibbles (raw, target) {
  for (let i = 0; i < BLOCKS_PER_SECTION; i++) target[i] = readNibble(raw, i)
}

/* ------------------------------------------------------------------ */
/* manager 定义                                                        */
/* ------------------------------------------------------------------ */
/*
 * 每个 manager：
 *   chunk(reader, chunk, writeCtx)   —— 消费 S21 里自己的 blob
 *   block(reader, block, writeCtx)   —— 消费 S23/S22 里自己的定长数据
 *   fixedBlockSize                   —— 方块包里占多少字节（未知则不参与方块包）
 *
 * writeCtx = { groundUp, mask }，给出该包允许携带的 section 集合。
 */

// 原版 ChunkAPI 的 blockid 管理器：short msbMask + 每段 4096 字节 LSB + [2048 半字节 MSB]
const vanillaBlockId = {
  chunk (r, chunk) {
    const msbMask = r.u16be()
    for (let i = 0; i < SECTIONS; i++) {
      if (!(chunk.mask & (1 << i))) continue
      const sec = sectionAt(chunk, i)
      const lsb = r.bytes(BLOCKS_PER_SECTION)
      for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] = lsb[j]
      if (msbMask & (1 << i)) {
        const msb = r.bytes(NIBBLE_BYTES)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] |= readNibble(msb, j) << 8
      }
      sec.hasBlockIds = true
    }
  },
  block (r, block) { block.blockId = r.u16be() & 0xfff },
  fixedBlockSize: 2
}

// 原版 ChunkAPI 的 metadata 管理器（extends NibbleManager：**没有包头**）
const vanillaMetadata = {
  chunk (r, chunk) {
    for (let i = 0; i < SECTIONS; i++) {
      if (!(chunk.mask & (1 << i))) continue
      const sec = sectionAt(chunk, i)
      readNibbles(r.bytes(NIBBLE_BYTES), sec.metadata)
      sec.hasMetadata = true
    }
  },
  block (r, block) { block.metadata = r.u8() & 0x0f },
  fixedBlockSize: 1
}

function lightManager (field) {
  return {
    chunk (r, chunk) {
      for (let i = 0; i < SECTIONS; i++) {
        if (!(chunk.mask & (1 << i))) continue
        const sec = sectionAt(chunk, i)
        const arr = new Uint8Array(BLOCKS_PER_SECTION)
        readNibbles(r.bytes(NIBBLE_BYTES), arr)
        sec[field] = arr
        sec[field === 'blockLight' ? 'hasBlockLight' : 'hasSkyLight'] = true
      }
    }
  }
}

// EndlessIDs 的 24 位方块 id：LE int（每段 2 bit） + 每段 B1 / [B2Low] / [B2High] / [B3]
const endlessBlockId = {
  chunk (r, chunk) {
    const mask = r.i32be() // 注意：manager blob 是 slice，字节序默认大端
    for (let i = 0; i < SECTIONS; i++) {
      // 是否携带由包头的 section mask 决定；2 bit 字段只说明该段多了哪几个数组
      if (!(chunk.mask & (1 << i))) continue
      const kind = (mask >>> (i * 2)) & 3
      const sec = sectionAt(chunk, i)
      const b1 = r.bytes(BLOCKS_PER_SECTION)
      for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] = b1[j]
      if (kind >= 1) {
        const b2l = r.bytes(NIBBLE_BYTES)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] |= readNibble(b2l, j) << 8
      }
      if (kind >= 2) {
        const b2h = r.bytes(NIBBLE_BYTES)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] |= readNibble(b2h, j) << 12
      }
      if (kind >= 3) {
        const b3 = r.bytes(BLOCKS_PER_SECTION)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.blockIds[j] |= b3[j] << 16
      }
      sec.hasBlockIds = true
    }
  },
  block (r, block) { block.blockId = r.i32be() },
  fixedBlockSize: 4
}

// EndlessIDs 的 16 位 metadata：LE int（每段 2 bit） + 每段 M1Low / [M1High] / [M2]
const endlessMetadata = {
  chunk (r, chunk) {
    const mask = r.i32be()
    for (let i = 0; i < SECTIONS; i++) {
      if (!(chunk.mask & (1 << i))) continue
      const kind = (mask >>> (i * 2)) & 3
      const sec = sectionAt(chunk, i)
      const m1l = r.bytes(NIBBLE_BYTES)
      for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.metadata[j] = readNibble(m1l, j)
      if (kind >= 1) {
        const m1h = r.bytes(NIBBLE_BYTES)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.metadata[j] |= readNibble(m1h, j) << 4
      }
      if (kind >= 2) {
        const m2 = r.bytes(BLOCKS_PER_SECTION)
        for (let j = 0; j < BLOCKS_PER_SECTION; j++) sec.metadata[j] |= m2[j] << 8
      }
      sec.hasMetadata = true
    }
  },
  block (r, block) { block.metadata = r.u16be() },
  fixedBlockSize: 2
}

/*
 * GregTech 的 client meta（gregtech:clientmeta）
 *   domain/id 见 gregtech/crossmod/chunkapi/ClientMetaManager（javap 核对）
 *   区块 blob：对每个已注册 tracker 写 int count，然后 count 条 (long pos + short meta)
 *              —— tracker 数量由客户端注册决定，这里用 blob 剩余长度自定界
 *   方块包：writeBlockPacketToBuffer 直接 return，**一个字节都不写**
 */
const gtClientMeta = {
  chunk (r, chunk, ctx) {
    const entries = []
    while (r.position < ctx.end) {
      const count = r.i32be()
      if (count < 0 || r.position + count * 10 > ctx.end) {
        throw new Error(`chunkapi: gregtech:clientmeta 条目数异常 ${count}`)
      }
      for (let i = 0; i < count; i++) {
        const packed = r.bytes(8).readBigInt64BE(0)
        const meta = r.i16be()
        entries.push({ packed, meta })
      }
    }
    chunk.clientMeta = entries
  },
  block () {}, // 不占字节
  fixedBlockSize: 0
}

const vanillaBiome = {
  chunk (r, chunk) {
    const raw = r.bytes(256)
    for (let i = 0; i < 256; i++) chunk.biomes[i] = raw[i]
    chunk.hasBiomes = true
  }
}

const endlessBiome = {
  chunk (r, chunk) {
    for (let i = 0; i < 256; i++) chunk.biomes[i] = r.u16be() // ShortBuffer 默认大端
    chunk.hasBiomes = true
  }
}

/*
 * 注册表。键就是线上出现的 manager id 字符串。
 * 不在表里的 id：
 *   S21 —— 按 blobLen 跳过（ChunkAPI 的容器自带长度，天然向前兼容）
 *   S22/S23 —— 无长度前缀，无法跳过，直接抛错（宁可报错也不要错位解析）
 */
const MANAGERS = new Map([
  ['minecraft:blockid', vanillaBlockId],
  ['minecraft:metadata', vanillaMetadata],
  ['minecraft:blocklight', lightManager('blockLight')],
  ['minecraft:skylight', lightManager('skyLight')],
  ['minecraft:biome', vanillaBiome],
  ['endlessids:blockid', endlessBlockId],
  ['endlessids:metadata', endlessMetadata],
  ['endlessids:biome', endlessBiome],
  ['gregtech:clientmeta', gtClientMeta]
])

/* ------------------------------------------------------------------ */
/* S21 map_chunk                                                       */
/* ------------------------------------------------------------------ */
/*
 * int x; int z; bool groundUp; short mask;
 * int dataLength;      // 解压后长度
 * int deflatedSize;
 * byte[deflatedSize];  // zlib
 *
 * 解压后：
 *   int managerCount;
 *   { int idLen; utf8 id; int blobLen; byte[blobLen] } * managerCount
 * 以上都是小端。
 */
function decodeChunkPacket (payload, options = {}) {
  const r = reader(payload)
  const x = r.i32be()
  const z = r.i32be()
  const groundUp = r.u8() !== 0
  const mask = r.u16be()
  const dataLength = r.i32be()
  const deflatedSize = r.i32be()
  const deflated = r.bytes(deflatedSize)

  const raw = options.raw ? deflated : zlib.inflateSync(deflated)
  if (raw.length !== dataLength) {
    throw new Error(`chunkapi: 解压长度不符 (声明 ${dataLength}，实际 ${raw.length})`)
  }

  const chunk = decodeChunkData(raw, mask, { chunkX: x, chunkZ: z, groundUp })
  return chunk
}

/* 只解析 manager 容器（S26 的每列数据就是这个格式，没有 x/z/mask 头） */
function decodeChunkData (raw, mask, meta = {}) {
  const d = reader(raw)
  const managerCount = d.i32le()
  const chunk = newChunk(mask)
  chunk.groundUp = meta.groundUp !== false
  // 线上包头里的 x/z 是**区块坐标**；这里统一换算成方块坐标，与 S23 的坐标语义保持一致
  chunk.chunkX = meta.chunkX ?? 0
  chunk.chunkZ = meta.chunkZ ?? 0
  chunk.x = chunk.chunkX * 16
  chunk.z = chunk.chunkZ * 16
  chunk.managerIds = []
  chunk.unknownManagers = []

  for (let i = 0; i < managerCount; i++) {
    const idLength = d.i32le()
    if (idLength < 0 || idLength > 256) throw new Error(`chunkapi: manager id 长度异常 ${idLength}`)
    const id = raw.toString('utf8', d.position, d.position + idLength)
    d.position += idLength
    const blobLength = d.i32le()
    const start = d.position
    if (start + blobLength > raw.length) throw new Error(`chunkapi: manager ${id} blob 越界`)
    const handler = MANAGERS.get(id)
    chunk.managerIds.push(id)
    if (handler) {
      handler.chunk(reader(raw, start), chunk, { groundUp: chunk.groundUp, mask, end: start + blobLength })
    } else {
      chunk.unknownManagers.push({ id, length: blobLength })
    }
    d.position = start + blobLength
  }

  chunk.unparsedBytes = raw.length - d.position
  return chunk
}

/* ------------------------------------------------------------------ */
/* S26 map_chunk_bulk                                                  */
/* ------------------------------------------------------------------ */
/*
 * short chunkCount;
 * int[chunkCount] sizes;      // 每列解压后字节数
 * int deflatedSize; bool skylight; byte[deflatedSize];   // 所有列的 zlib 合在一起
 * chunkCount × { int x; int z; unsigned short subChunkMask }
 *
 * 解压后的字节按 sizes 依次切成 chunkCount 段，每段就是 S21 的 manager 容器。
 */
function decodeMapChunkBulk (payload) {
  const r = reader(payload)
  const count = r.i16be()
  if (count < 0 || count > 512) throw new Error(`chunkapi: bulk 列数异常 ${count}`)
  const sizes = []
  for (let i = 0; i < count; i++) sizes.push(r.i32be())
  const deflatedSize = r.i32be()
  const skylight = r.u8() !== 0
  const deflated = r.bytes(deflatedSize)
  const raw = zlib.inflateSync(deflated)

  const total = sizes.reduce((a, b) => a + b, 0)
  if (raw.length !== total) {
    throw new Error(`chunkapi: bulk 解压长度不符 (声明 ${total}，实际 ${raw.length})`)
  }

  const columns = []
  let offset = 0
  for (let i = 0; i < count; i++) {
    const x = r.i32be()
    const z = r.i32be()
    const mask = r.u16be()
    const body = raw.subarray(offset, offset + sizes[i])
    offset += sizes[i]
    const chunk = decodeChunkData(body, mask, { chunkX: x, chunkZ: z, groundUp: true })
    if (chunk.unparsedBytes !== 0) {
      throw new Error(`chunkapi: bulk 第 ${i} 列多出 ${chunk.unparsedBytes} 字节`)
    }
    chunk.skylight = skylight
    columns.push(chunk)
  }
  if (r.remaining !== 0) throw new Error(`chunkapi: bulk 多出 ${r.remaining} 字节`)
  return { skylight, columns }
}

/* ------------------------------------------------------------------ */
/* S23 block_change                                                    */
/* ------------------------------------------------------------------ */
/*
 * long packedPos; int blockManagerCount;
 * { utf8 id; <该 manager 的定长数据> } * blockManagerCount
 *
 * packedPos: x 26 位 << 38 | y 12 位 << 26 | z 26 位
 */
function unpackPosition (packed) {
  const X_MASK = 0x3ffffffn
  const Y_MASK = 0xfffn
  const x = signExtend26(Number((packed >> 38n) & X_MASK))
  const y = signExtend12(Number((packed >> 26n) & Y_MASK))
  const z = signExtend26(Number(packed & X_MASK))
  return { x, y, z }
}

function signExtend26 (v) { return (v & 0x2000000) ? v - 0x4000000 : v }
function signExtend12 (v) { return (v & 0x800) ? v - 0x1000 : v }

function decodeBlockContainer (r) {
  const count = r.i32be()
  if (count < 0 || count > 32) throw new Error(`chunkapi: block manager 数量异常 ${count}`)
  const block = { blockId: 0, metadata: 0, managers: [] }
  for (let i = 0; i < count; i++) {
    const id = r.utf()
    const handler = MANAGERS.get(id)
    if (!handler || !handler.block) {
      throw new Error(`chunkapi: 未知的 block manager "${id}"（无长度前缀，无法跳过）`)
    }
    const start = r.position
    handler.block(r, block)
    block.managers.push({ id, bytes: r.position - start })
  }
  return block
}

function decodeBlockChange (payload) {
  const r = reader(payload)
  const { x, y, z } = unpackPosition(r.u64be())
  const block = decodeBlockContainer(r)
  // 严格校验：正好读完才算格式对，多余字节说明还有没登记的 manager
  if (r.remaining !== 0) throw new Error(`chunkapi: block_change 多出 ${r.remaining} 字节`)
  return { x, y, z, blockId: block.blockId, metadata: block.metadata, managers: block.managers }
}

/* ------------------------------------------------------------------ */
/* S22 multi_block_change                                              */
/* ------------------------------------------------------------------ */
/*
 * int chunkX; int chunkZ; varint count;
 * 每条记录：short pos = (x&0xf)<<12 | (z&0xf)<<8 | (y&0xff)
 *           紧接与 S23 相同的 manager 容器
 */
function decodeMultiBlockChange (payload) {
  const r = reader(payload)
  const chunkX = r.i32be()
  const chunkZ = r.i32be()
  const count = r.varint()
  const changes = []
  for (let i = 0; i < count; i++) {
    const pos = r.u16be()
    const block = decodeBlockContainer(r)
    changes.push({
      x: chunkX * 16 + ((pos >> 12) & 0x0f),
      y: pos & 0xff,
      z: chunkZ * 16 + ((pos >> 8) & 0x0f),
      blockId: block.blockId,
      metadata: block.metadata
    })
  }
  if (r.remaining !== 0) throw new Error(`chunkapi: multi_block_change 多出 ${r.remaining} 字节`)
  return { chunkX, chunkZ, changes }
}

module.exports = {
  SECTIONS,
  BLOCKS_PER_SECTION,
  sectionAt,
  NIBBLE_BYTES,
  MANAGERS,
  decodeChunkPacket,
  decodeBlockChange,
  decodeMultiBlockChange,
  decodeChunkData,
  decodeMapChunkBulk,
  unpackPosition,
  readNibble
}
