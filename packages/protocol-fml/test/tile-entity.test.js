const assert = require('node:assert')
const test = require('node:test')
const { GTNH_TE_PACKETS, mergeCustomPackets } = require('../src/index')

// GTNH 的 S35 tile_entity_data 比原版多 1 个字节（原版: location + action + compressedNbt）。
// 真实抓包帧（data/raw/faucet.jsonl，水龙头 TE，坐标 5/80/-7，action=1）：
const FRAME_HEX = '35000000050050fffffff9010000981f8b08000000000000005d8ed10ac2300c4553c760d3821f355f068222fe406c330d7455d708737fee53cd644fe6e526e4e4deac010cd4374c7b7ebed84301db1ec7069370bcee28e01bb40aa81a7ca063594633aa9415acf4c42ef4192f817435e59c3faa337a2cc0ba3fb31aca56a84f73afe19b36b230069ec81bfdc5f3404ef81e35c69e287a1a0e5d97487efc17f51a7d21b0000000'

test('gtnh_tile_entity_data 在 action 之后多一个字节', () => {
  const types = GTNH_TE_PACKETS['1.7'].play.toClient.types
  const fields = types.gtnh_tile_entity_data[1].map((f) => f.name)
  assert.deepStrictEqual(fields, ['location', 'action', 'extra', 'nbtData'])
  assert.strictEqual(types.packet_tile_entity_data, 'gtnh_tile_entity_data')
})

test('mergeCustomPackets 把 TE 定义带进 play.toClient', () => {
  const merged = mergeCustomPackets(GTNH_TE_PACKETS)
  const types = merged['1.7'].play.toClient.types
  assert.ok(types.gtnh_tile_entity_data)
  assert.strictEqual(types.packet_tile_entity_data, 'gtnh_tile_entity_data')
})

test('真实帧按「location + action + extra + i16 长度 + gzip」能手工解开', () => {
  const buf = Buffer.from(FRAME_HEX, 'hex')
  assert.strictEqual(buf[0], 0x35)
  const x = buf.readInt32BE(1)
  const y = buf.readInt16BE(5)
  const z = buf.readInt32BE(7)
  assert.deepStrictEqual({ x, y, z }, { x: 5, y: 80, z: -7 })
  assert.strictEqual(buf[11], 1) // action
  assert.strictEqual(buf[12], 0) // extra
  const nbtLen = buf.readInt16BE(13)
  assert.strictEqual(nbtLen, 152)
  assert.strictEqual(buf.length, 15 + nbtLen)
  assert.strictEqual(buf.readUInt16BE(15), 0x1f8b) // gzip magic
  const zlib = require('node:zlib')
  const nbt = zlib.gunzipSync(buf.subarray(15))
  assert.ok(nbt.length > 0)
})
