'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  createSerializer,
  createDeserializer
} = require('minecraft-protocol/src/transforms/serializer')

const {
  GTNH_CUSTOM_PACKETS,
  CHUNKAPI_PACKETS,
  mergeCustomPackets,
  decodeChunkApiPacket
} = require('../src/index')

const customPackets = mergeCustomPackets(GTNH_CUSTOM_PACKETS, CHUNKAPI_PACKETS)

function roundTrip (name, params, isServer = true) {
  const serializer = createSerializer({
    state: 'play', isServer, version: '1.7.10', customPackets
  })
  const deserializer = createDeserializer({
    state: 'play', isServer: !isServer, version: '1.7.10', customPackets
  })
  const buffer = serializer.createPacketBuffer({ name, params })
  return deserializer.parsePacketBuffer(buffer).data
}

/*
 * 这条测试防的是 lodash.merge 的坑：nmp 合并 customPackets 时数组按下标逐项合并，
 * 如果直接把 packet_map_chunk 写成单字段 container，原版剩下 7 个字段会留下来，
 * 序列化时 Buffer.from(undefined) 直接抛 ERR_INVALID_ARG_TYPE。
 */
test('ChunkAPI: 三个包都被替换成 payload 容器，且保留原事件名', () => {
  for (const name of ['map_chunk', 'block_change', 'multi_block_change']) {
    const parsed = roundTrip(name, { payload: Buffer.from([1, 2, 3]) })
    assert.strictEqual(parsed.name, name)
    assert.deepStrictEqual(parsed.params.payload, Buffer.from([1, 2, 3]))
  }
})

test('custom_payload: 仍然是 channel + restBuffer（varshort 由 codec 剥）', () => {
  const parsed = roundTrip('custom_payload', {
    channel: 'FML|HS',
    data: Buffer.from([0x02, 0x01, 0x02])
  })
  assert.strictEqual(parsed.params.channel, 'FML|HS')
  assert.deepStrictEqual(parsed.params.data, Buffer.from([0x02, 0x01, 0x02]))
})

test('decodeChunkApiPacket: 事件分派与错误不抛出', () => {
  assert.strictEqual(decodeChunkApiPacket('chat', Buffer.alloc(3)), undefined)

  // 12 字节 = 8 字节 packedPos + 4 字节 managerCount(0)，正好读完
  const ok = decodeChunkApiPacket('block_change', Buffer.alloc(12))
  assert.strictEqual(ok.name, 'gtnh_block_change')
  assert.ok(!ok.error)

  // 多余字节必须报错，否则说明还有没登记的 manager
  const leftover = decodeChunkApiPacket('block_change', Buffer.alloc(16))
  assert.ok(leftover.error instanceof Error)

  const bad = decodeChunkApiPacket('multi_block_change', Buffer.alloc(2))
  assert.strictEqual(bad.name, 'gtnh_multi_block_change')
  assert.ok(bad.error instanceof Error)
})
