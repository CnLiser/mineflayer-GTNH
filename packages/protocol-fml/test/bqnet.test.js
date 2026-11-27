'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('zlib')
const nbt = require('prismarine-nbt')

const {
  CHANNEL, PART_SIZE, PAYLOAD_ID, ACTION,
  uuidToNbt, nbtToUuid, encodeQuestAction, encodePackets, decodePacket, joinPackets
} = require('../src/gtnh/bqnet')

const A = '00000000-0000-0000-0000-000000000ac7'
const B = '80c46e7c-5b51-4516-b7d0-b136d5ba0535'

test('uuid 拆成四个 int 再拼回来', () => {
  const v = uuidToNbt(B)
  assert.deepEqual(v.questIDHigh, [0x80c46e7c | 0, 0x5b514516 | 0])
  assert.deepEqual(v.questIDLow, [0xb7d0b136 | 0, 0xd5ba0535 | 0])
  assert.equal(nbtToUuid(v), B)
  assert.equal(nbtToUuid(uuidToNbt(A)), A)
})

test('包体是三字节头 + gzip 的分片 NBT', async () => {
  const [pkt] = encodeQuestAction([A])
  assert.equal(pkt.readUInt8(0), 0, 'discriminator 0')
  const len = pkt.readUInt16BE(1)
  assert.equal(len, pkt.length - 3, 'u16 长度就是后面 NBT 的字节数')
  const { tag } = await decodePacket(pkt)
  assert.equal(tag.end.value, 1, '单包就是最后一片')
  assert.equal(tag.index.value, 0)
  // data 解开后是 payload 的 gzip
  const gz = Buffer.from(Array.from(tag.data.value, (v) => v & 0xff))
  const raw = zlib.gunzipSync(gz)
  // size 记的是 gzip 流的长度（分片存的就是 gzip 字节），不是解压后的长度
  assert.equal(gz.length, tag.size.value)
  const body = (await nbt.parse(raw, 'big')).parsed.value
  assert.equal(body.ID.value, PAYLOAD_ID)
  assert.equal(body.action.value, ACTION.CLAIM)
  assert.deepEqual(body.questIDs.value.value.map(nbtToUuid), [A])
})

test('编解码往返：多个 UUID + action=1', async () => {
  const pkts = encodeQuestAction([A, B], ACTION.DETECT)
  const { payload, raw, compressed } = await joinPackets(pkts)
  assert.equal(payload.ID.value, PAYLOAD_ID)
  assert.equal(payload.action.value, ACTION.DETECT)
  assert.deepEqual(payload.questIDs.value.value.map(nbtToUuid), [A, B])
  assert.ok(compressed > 0 && raw.length > compressed, '压缩率不合理')
})

test('超长 payload 会分片，拼回来还是原样', async () => {
  const ids = []
  for (let i = 0; i < 3000; i++) {
    ids.push(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`)
  }
  const pkts = encodeQuestAction(ids, ACTION.CLAIM, { partSize: 2048 })
  assert.ok(pkts.length > 1, `应该分成多片，实际 ${pkts.length}`)
  for (const p of pkts) assert.ok(p.length <= 32767, '单片不能超 SimpleImpl 上限')
  const { payload } = await joinPackets(pkts.slice().reverse()) // 顺序无关
  assert.equal(payload.questIDs.value.value.length, ids.length)
  assert.equal(nbtToUuid(payload.questIDs.value.value[2999]), ids[2999])
  assert.equal(CHANNEL, 'BQ_NET_CHAN')
  assert.equal(PART_SIZE, 20480)
})
