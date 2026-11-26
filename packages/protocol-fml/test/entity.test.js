'use strict'

// 实体生成包：EndlessIDs 把 spawn_entity_living 的 type 从 u8 加宽成 i16。
// 用真实抓包帧做 fixture，防止再退回 u8（那会让 x/y/z 全部错位 1 字节）。

const test = require('node:test')
const assert = require('node:assert')
const mc = require('minecraft-protocol')
const { mergeCustomPackets, GTNH_ENTITY_PACKETS } = require('../src/index.js')

function deserializer () {
  return mc.createDeserializer({
    state: 'play',
    isServer: false,
    version: '1.7.10',
    customPackets: mergeCustomPackets(GTNH_ENTITY_PACKETS),
    hideErrors: true
  })
}

// data/raw/mobcap.jsonl 里的真实帧：Bat 在 (24.72, 65.09, 7.72)
const BAT_FRAME = '0fef0100410000031700000823000000f7e0000c0000000000000000000010010101012c030640c0' +
  '0000020700000000000800000900040a0100000b007f'

test('spawn_entity_living: type 是 i16，位置按 /32 定点数还原', () => {
  const result = deserializer().parsePacketBuffer(Buffer.from(BAT_FRAME, 'hex'))
  const packet = result.data ?? result
  assert.strictEqual(packet.name, 'spawn_entity_living')
  const p = packet.params
  assert.strictEqual(p.entityId, 239)
  assert.strictEqual(p.type, 65) // 65 = Bat
  assert.ok(Math.abs(p.x / 32 - 24.71875) < 1e-9, `x = ${p.x / 32}`)
  assert.ok(Math.abs(p.y / 32 - 65.09375) < 1e-9, `y = ${p.y / 32}`)
  assert.ok(Math.abs(p.z / 32 - 7.71875) < 1e-9, `z = ${p.z / 32}`)
})

test('spawn_entity_living: metadata 能读到结尾（16 条）', () => {
  const result = deserializer().parsePacketBuffer(Buffer.from(BAT_FRAME, 'hex'))
  const p = (result.data ?? result).params
  assert.strictEqual(p.metadata.length, 16)
})

// 注意：这里不测「原版定义会读错」的反证。nmp 的 createProtocol 缓存 key 不含
// customPackets，一旦本进程合并过补丁，之后建的 deserializer 拿到的还是补丁版
// （见 docs/MEMORY.md §4.7）。要复现原版行为必须另起进程。
