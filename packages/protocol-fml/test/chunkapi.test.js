'use strict'

const test = require('node:test')
const assert = require('node:assert')
const zlib = require('zlib')

const {
  decodeChunkPacket,
  decodeChunkData,
  decodeMapChunkBulk,
  decodeBlockChange,
  decodeMultiBlockChange,
  unpackPosition,
  readNibble
} = require('../src/gtnh/chunkapi')

/* ------------------------------------------------------------------ */
/* 编码器：把结构化数据按 ChunkAPI 的线格式写回去，用来做往返测试        */
/* ------------------------------------------------------------------ */

function nibbleWriter (values) {
  const out = Buffer.alloc(2048)
  for (let i = 0; i < 4096; i++) {
    const v = values[i] & 0x0f
    if ((i & 1) === 0) out[i >> 1] |= v
    else out[i >> 1] |= v << 4
  }
  return out
}

function managerBlob (id, blob) {
  const idBuf = Buffer.from(id, 'utf8')
  const out = Buffer.alloc(4 + idBuf.length + 4 + blob.length)
  out.writeInt32LE(idBuf.length, 0)
  idBuf.copy(out, 4)
  out.writeInt32LE(blob.length, 4 + idBuf.length)
  blob.copy(out, 8 + idBuf.length)
  return out
}

/* S21 的 manager 容器（小端 int 长度） */
function chunkBody (managers) {
  const body = Buffer.concat([Buffer.alloc(4), ...managers.map(m => managerBlob(m.id, m.blob))])
  body.writeInt32LE(managers.length, 0)
  return body
}

function chunkPacket ({ x = 0, z = 0, groundUp = true, mask = 0, managers }) {
  const body = chunkBody(managers)
  const compressed = zlib.deflateSync(body)
  const head = Buffer.alloc(4 + 4 + 1 + 2 + 4 + 4)
  head.writeInt32BE(x, 0)
  head.writeInt32BE(z, 4)
  head.writeUInt8(groundUp ? 1 : 0, 8)
  head.writeUInt16BE(mask, 9)
  head.writeInt32BE(body.length, 11)
  head.writeInt32BE(compressed.length, 15)
  return Buffer.concat([head, compressed])
}

/* S26：short count + int[count] sizes + int deflated + bool sky + zlib + count×{x,z,mask} */
function bulkPacket (columns, { skylight = true } = {}) {
  const bodies = columns.map(c => chunkBody(c.managers))
  const raw = Buffer.concat(bodies)
  const compressed = zlib.deflateSync(raw)
  const head = Buffer.alloc(2 + 4 * columns.length + 4 + 1)
  head.writeInt16BE(columns.length, 0)
  columns.forEach((c, i) => head.writeInt32BE(bodies[i].length, 2 + i * 4))
  head.writeInt32BE(compressed.length, 2 + columns.length * 4)
  head.writeUInt8(skylight ? 1 : 0, 2 + columns.length * 4 + 4)
  const tail = Buffer.alloc(columns.length * 10)
  columns.forEach((c, i) => {
    tail.writeInt32BE(c.x ?? 0, i * 10)
    tail.writeInt32BE(c.z ?? 0, i * 10 + 4)
    tail.writeUInt16BE(c.mask ?? 0, i * 10 + 8)
  })
  return Buffer.concat([head, compressed, tail])
}

/*
 * 原版 ChunkAPI 的 blockid：short msbMask + 每段 4096 字节 LSB + [2048 半字节 MSB]
 * （metadata 是另一个 manager，不在这里）
 */
function vanillaBlockIdBlob (sections) {
  let msbMask = 0
  const parts = []
  for (const [i, ids] of sections) {
    parts.push(Buffer.from(Uint8Array.from(ids, v => v & 0xff)))
    if (ids.some(v => v > 0xff)) {
      msbMask |= 1 << i
      parts.push(nibbleWriter(Uint16Array.from(ids, v => (v >> 8) & 0x0f)))
    }
  }
  const head = Buffer.alloc(2)
  head.writeUInt16BE(msbMask, 0)
  return Buffer.concat([head, ...parts])
}

/* 原版 metadata / blocklight / skylight：NibbleManager，**没有包头**，每段 2048 字节 */
function nibbleBlob (sections, values) {
  return Buffer.concat(sections.map(() => nibbleWriter(values)))
}

/* EndlessIDs 的 blob 头是 int（大端！manager 数据走 slice，slice 默认大端） */
function endlessBlockIdBlob (sections) {
  let mask = 0
  const parts = []
  for (const [i, ids] of sections) {
    const kind = 3 // 用满 24 位，覆盖 B1/B2Low/B2High/B3 四条分支
    mask |= kind << (i * 2)
    const b1 = Buffer.alloc(4096)
    const b2l = new Uint16Array(4096)
    const b2h = new Uint16Array(4096)
    const b3 = Buffer.alloc(4096)
    for (let j = 0; j < 4096; j++) {
      const v = ids[j]
      b1[j] = v & 0xff
      b2l[j] = (v >> 8) & 0x0f
      b2h[j] = (v >> 12) & 0x0f
      b3[j] = (v >> 16) & 0xff
    }
    parts.push(b1, nibbleWriter(b2l), nibbleWriter(b2h), b3)
  }
  const head = Buffer.alloc(4)
  head.writeInt32BE(mask, 0)
  return Buffer.concat([head, ...parts])
}

function endlessMetaBlob (sections) {
  let mask = 0
  const parts = []
  for (const [i, meta] of sections) {
    const kind = 3 // M1Low + M1High + M2
    mask |= kind << (i * 2)
    const m1l = new Uint16Array(4096)
    const m1h = new Uint16Array(4096)
    const m2 = Buffer.alloc(4096)
    for (let j = 0; j < 4096; j++) {
      m1l[j] = meta[j] & 0x0f
      m1h[j] = (meta[j] >> 4) & 0x0f
      m2[j] = (meta[j] >> 8) & 0xff
    }
    parts.push(nibbleWriter(m1l), nibbleWriter(m1h), m2)
  }
  const head = Buffer.alloc(4)
  head.writeInt32BE(mask, 0)
  return Buffer.concat([head, ...parts])
}

function biomeBlob16 (biomes) {
  const out = Buffer.alloc(512)
  biomes.forEach((v, i) => out.writeUInt16BE(v, i * 2))
  return out
}

/* S23/S22 的 block manager 容器：int count(BE) + {varint idLen, id, 定长数据} */
function blockContainer (entries) {
  const parts = [Buffer.alloc(4)]
  parts[0].writeInt32BE(entries.length, 0)
  for (const { id, payload } of entries) {
    const idBuf = Buffer.from(id, 'utf8')
    const len = Buffer.alloc(1)
    let v = idBuf.length
    let i = 0
    // 简化版 varint（id 长度 < 128）
    len[i++] = v
    parts.push(len.subarray(0, i), idBuf, payload)
  }
  return Buffer.concat(parts)
}

/* ------------------------------------------------------------------ */
/* 测试                                                                */
/* ------------------------------------------------------------------ */

test('S21: 原版 ChunkAPI manager（blockid + metadata + 光照 + 生物群系）', () => {
  const ids = Uint32Array.from({ length: 4096 }, (_, i) => i % 200)
  const meta = Uint16Array.from({ length: 4096 }, (_, i) => i % 16)
  const light = Uint16Array.from({ length: 4096 }, (_, i) => i % 16)
  const biomes = Buffer.alloc(256)
  for (let i = 0; i < 256; i++) biomes[i] = i % 40

  const packet = chunkPacket({
    x: 3,
    z: -7,
    mask: 0b11,
    managers: [
      { id: 'minecraft:blockid', blob: vanillaBlockIdBlob(new Map([[0, ids], [1, ids]])) },
      { id: 'minecraft:metadata', blob: nibbleBlob([0, 1], meta) },
      { id: 'minecraft:blocklight', blob: nibbleBlob([0, 1], light) },
      { id: 'minecraft:skylight', blob: nibbleBlob([0, 1], light) },
      { id: 'minecraft:biome', blob: biomes }
    ]
  })

  const chunk = decodeChunkPacket(packet)
  // 线上包头是区块坐标，解码后统一换成方块坐标
  assert.strictEqual(chunk.chunkX, 3)
  assert.strictEqual(chunk.chunkZ, -7)
  assert.strictEqual(chunk.x, 48)
  assert.strictEqual(chunk.z, -112)
  assert.strictEqual(chunk.mask, 0b11)
  assert.deepStrictEqual(chunk.managerIds, [
    'minecraft:blockid', 'minecraft:metadata', 'minecraft:blocklight', 'minecraft:skylight', 'minecraft:biome'
  ])
  assert.strictEqual(chunk.sections[0].blockIds[123], 123 % 200)
  assert.strictEqual(chunk.sections[1].metadata[123], 123 % 16)
  assert.strictEqual(chunk.sections[0].blockLight[77], 77 % 16)
  assert.strictEqual(chunk.sections[1].skyLight[77], 77 % 16)
  assert.strictEqual(chunk.biomes[200], 200 % 40)
  assert.strictEqual(chunk.sections[2], null)
  assert.strictEqual(chunk.unparsedBytes, 0)
})

test('S21: 原版 blockid 的 12 位 id（msbMask 生效）', () => {
  const ids = Uint32Array.from({ length: 4096 }, (_, i) => 0xabc + (i % 3))
  const packet = chunkPacket({
    mask: 1,
    managers: [{ id: 'minecraft:blockid', blob: vanillaBlockIdBlob(new Map([[0, ids]])) }]
  })
  const chunk = decodeChunkPacket(packet)
  assert.strictEqual(chunk.sections[0].blockIds[0], 0xabc)
  assert.strictEqual(chunk.sections[0].blockIds[1], 0xabd)
})

test('S21: EndlessIDs 24 位 id + 16 位 metadata + 16 位生物群系', () => {
  const ids = Uint32Array.from({ length: 4096 }, (_, i) => (i * 7919) & 0xffffff)
  const meta = Uint16Array.from({ length: 4096 }, (_, i) => (i * 131) & 0xffff)
  const biomes = []
  for (let i = 0; i < 256; i++) biomes.push((i * 37) & 0xffff)

  const packet = chunkPacket({
    x: -1,
    z: 2,
    mask: 1,
    managers: [
      { id: 'endlessids:blockid', blob: endlessBlockIdBlob(new Map([[0, ids]])) },
      { id: 'endlessids:metadata', blob: endlessMetaBlob(new Map([[0, meta]])) },
      { id: 'endlessids:biome', blob: biomeBlob16(biomes) }
    ]
  })

  const chunk = decodeChunkPacket(packet)
  assert.strictEqual(chunk.sections[0].blockIds[4095], (4095 * 7919) & 0xffffff)
  assert.strictEqual(chunk.sections[0].metadata[4095], (4095 * 131) & 0xffff)
  assert.strictEqual(chunk.biomes[255], (255 * 37) & 0xffff)
  assert.strictEqual(chunk.unknownManagers.length, 0)
})

test('S21: 未知 manager 按长度跳过', () => {
  const packet = chunkPacket({
    managers: [
      { id: 'somemod:custom', blob: Buffer.from([1, 2, 3, 4, 5]) },
      { id: 'minecraft:biome', blob: Buffer.alloc(256, 7) }
    ]
  })
  const chunk = decodeChunkPacket(packet)
  assert.deepStrictEqual(chunk.unknownManagers, [{ id: 'somemod:custom', length: 5 }])
  assert.strictEqual(chunk.biomes[0], 7)
})

test('S26: map_chunk_bulk 多列，按 sizes 切段', () => {
  const biomesA = Array.from({ length: 256 }, (_, i) => 200 + (i % 5))
  const biomesB = Array.from({ length: 256 }, (_, i) => 300 + (i % 7))
  const packet = bulkPacket([
    { x: 10, z: -20, mask: 0b11, managers: [{ id: 'endlessids:biome', blob: biomeBlob16(biomesA) }] },
    { x: 11, z: -20, mask: 0b1, managers: [{ id: 'endlessids:biome', blob: biomeBlob16(biomesB) }] }
  ])

  const bulk = decodeMapChunkBulk(packet)
  assert.strictEqual(bulk.columns.length, 2)
  assert.strictEqual(bulk.skylight, true)
  assert.strictEqual(bulk.columns[0].chunkX, 10)
  assert.strictEqual(bulk.columns[0].chunkZ, -20)
  assert.strictEqual(bulk.columns[0].x, 160)
  assert.strictEqual(bulk.columns[0].z, -320)
  assert.strictEqual(bulk.columns[1].mask, 0b1)
  assert.strictEqual(bulk.columns[0].biomes[3], 203)
  assert.strictEqual(bulk.columns[1].biomes[3], 303)
})

test('gregtech:clientmeta 在区块里是「tracker 数 + 10 字节条目」，在方块包里 0 字节', () => {
  const entries = Buffer.alloc(4 + 10 + 10)
  entries.writeInt32BE(2, 0)
  entries.writeBigInt64BE(0x1122334455n, 4)
  entries.writeInt16BE(7, 12)
  entries.writeBigInt64BE(0x9988776655n, 14)
  entries.writeInt16BE(-3, 22)

  const chunk = decodeChunkPacket(chunkPacket({
    mask: 1,
    managers: [{ id: 'gregtech:clientmeta', blob: entries }]
  }))
  assert.strictEqual(chunk.clientMeta.length, 2)
  assert.strictEqual(chunk.clientMeta[0].packed, 0x1122334455n)
  assert.strictEqual(chunk.clientMeta[0].meta, 7)
  assert.strictEqual(chunk.clientMeta[1].meta, -3)

  // 方块包只写 id、不写数据（真实 GTNH 帧长 78 字节就是这么来的）
  const payload = Buffer.concat([
    Buffer.alloc(8),
    blockContainer([{ id: 'gregtech:clientmeta', payload: Buffer.alloc(0) }])
  ])
  const change = decodeBlockChange(payload)
  assert.deepStrictEqual(change.managers, [{ id: 'gregtech:clientmeta', bytes: 0 }])
})

test('S23: EndlessIDs 方块变更（int id + short metadata）', () => {
  const x = 26; const y = 64; const z = -3
  const pos = (BigInt(x) << 38n) | (BigInt(y & 0xfff) << 26n) | BigInt(z & 0x3ffffff)

  const payload = Buffer.concat([
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]),
    blockContainer([
      { id: 'endlessids:blockid', payload: Buffer.from([0x00, 0x12, 0x34, 0x56]) },
      { id: 'endlessids:metadata', payload: Buffer.from([0xab, 0xcd]) }
    ])
  ])
  payload.writeBigInt64BE(pos, 0)

  const change = decodeBlockChange(payload)
  assert.deepStrictEqual(
    { x: change.x, y: change.y, z: change.z },
    { x, y, z }
  )
  assert.strictEqual(change.blockId, 0x123456)
  assert.strictEqual(change.metadata, 0xabcd)
})

test('S23: 负数坐标的 26/12 位符号扩展', () => {
  const cases = [[-5, -1, -1000], [29999999, 255, -29999999], [0, 0, 0]]
  for (const [x, y, z] of cases) {
    const packed = (BigInt(x & 0x3ffffff) << 38n) | (BigInt(y & 0xfff) << 26n) | BigInt(z & 0x3ffffff)
    assert.deepStrictEqual(unpackPosition(packed), { x, y, z })
  }
})

test('S22: 多条方块变更', () => {
  const changes = [
    { x: 1, y: 5, z: 2, id: 0x0a0b0c, meta: 0x0102 },
    { x: 15, y: 255, z: 0, id: 0xffffff, meta: 0xffff }
  ]
  const parts = [Buffer.alloc(9)]
  parts[0].writeInt32BE(-2, 0) // chunkX
  parts[0].writeInt32BE(9, 4) // chunkZ
  parts[0].writeUInt8(changes.length, 8) // varint count

  for (const c of changes) {
    const pos = Buffer.alloc(2)
    pos.writeUInt16BE(((c.x & 0xf) << 12) | ((c.z & 0xf) << 8) | (c.y & 0xff), 0)
    parts.push(pos, blockContainer([
      { id: 'endlessids:blockid', payload: Buffer.from([0, (c.id >> 16) & 0xff, (c.id >> 8) & 0xff, c.id & 0xff]) },
      { id: 'endlessids:metadata', payload: Buffer.from([(c.meta >> 8) & 0xff, c.meta & 0xff]) }
    ]))
  }

  const out = decodeMultiBlockChange(Buffer.concat(parts))
  assert.strictEqual(out.chunkX, -2)
  assert.strictEqual(out.chunkZ, 9)
  assert.strictEqual(out.changes.length, 2)
  assert.deepStrictEqual(
    out.changes.map(c => [c.x, c.y, c.z, c.blockId, c.metadata]),
    [
      [-2 * 16 + 1, 5, 9 * 16 + 2, 0x0a0b0c, 0x0102],
      [-2 * 16 + 15, 255, 9 * 16 + 0, 0xffffff, 0xffff]
    ]
  )
})

test('S23: 未知 block manager 必须报错（无长度前缀）', () => {
  const payload = Buffer.concat([
    Buffer.alloc(8),
    blockContainer([{ id: 'weird:manager', payload: Buffer.alloc(4) }])
  ])
  assert.throws(() => decodeBlockChange(payload), /未知的 block manager "weird:manager"/)
})

test('严格校验：多出字节要报错', () => {
  const extra = Buffer.concat([Buffer.alloc(8), blockContainer([]), Buffer.from([0])])
  assert.throws(() => decodeBlockChange(extra), /多出 1 字节/)
  assert.throws(() => decodeChunkData(Buffer.alloc(2), 0), /越界/)
})

test('readNibble: 低半字节在前', () => {
  const arr = Uint8Array.from([0x21, 0x43])
  assert.strictEqual(readNibble(arr, 0), 1)
  assert.strictEqual(readNibble(arr, 1), 2)
  assert.strictEqual(readNibble(arr, 2), 3)
  assert.strictEqual(readNibble(arr, 3), 4)
})
