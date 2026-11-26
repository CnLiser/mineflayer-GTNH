'use strict'

/*
 * GTNH 的 slot 线格式（EndlessIDs PacketBufferMixin + 一个来源不明的尾字节）：
 *
 *   空槽   : i32(-1)                                    = 4 字节
 *   有物品 : i32(itemId) + i8(count) + i16(damage) + nbt + u8(gtnhFlag) = 10 + nbt
 *
 * 尾字节 gtnhFlag 实测恒为 1，位置在 NBT 之后（空槽没有）。这里用真实抓包帧
 * 当 fixture 锁死解析，避免以后改协议时把它弄丢。
 */

const test = require('node:test')
const assert = require('node:assert')
const {
  createSerializer,
  createDeserializer
} = require('minecraft-protocol/src/transforms/serializer')

const { GTNH_SLOT_PACKETS, mergeCustomPackets } = require('../src/index')

const customPackets = mergeCustomPackets(GTNH_SLOT_PACKETS)

// nmp 的 isServer 语义：序列化「服务器发给客户端」的包时 isServer=true，
// 反序列化客户端发来的包时 isServer=true。
function deserializer (fromClient = false) {
  return createDeserializer({ state: 'play', isServer: fromClient, version: '1.7.10', customPackets })
}

function serializer (fromClient = false) {
  return createSerializer({ state: 'play', isServer: !fromClient, version: '1.7.10', customPackets })
}

// 真实抓包：进服 0.2s 服务器把 questbook 塞进快捷栏 0 号槽
const SET_SLOT_QUESTBOOK = Buffer.from('2f00002400001861010000ffff01', 'hex')
// 真实抓包：空的光标槽
const SET_SLOT_EMPTY = Buffer.from('2fffffffffffffff', 'hex')

test('slot: 解析 set_slot（4 字节 id + 尾字节 flag）', () => {
  const parsed = deserializer().parsePacketBuffer(SET_SLOT_QUESTBOOK).data
  assert.strictEqual(parsed.name, 'set_slot')
  assert.deepStrictEqual(parsed.params, {
    windowId: 0,
    slot: 36,
    item: { blockId: 6241, itemCount: 1, itemDamage: 0, nbtData: undefined, gtnhFlag: 1 }
  })
})

test('slot: 空槽只有 4 字节，没有 flag', () => {
  const parsed = deserializer().parsePacketBuffer(SET_SLOT_EMPTY).data
  assert.deepStrictEqual(parsed.params, { windowId: -1, slot: -1, item: { blockId: -1 } })
})

test('slot: 写出来和抓包字节一致（10 字节物品）', () => {
  const buffer = serializer().createPacketBuffer({
    name: 'set_slot',
    params: {
      windowId: 0,
      slot: 36,
      item: { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 }
    }
  })
  assert.strictEqual(buffer.toString('hex'), SET_SLOT_QUESTBOOK.toString('hex'))
})

test('slot: 带 NBT 的物品，长度字段在 flag 之前', () => {
  // compressedNbt 收的是已解析的 NBT 对象（nmp 会自己 gzip），不是 Buffer
  const nbt = { type: 'compound', name: '', value: { display: { type: 'compound', name: 'display', value: { Name: { type: 'string', value: '测试' } } } } }
  const buffer = serializer().createPacketBuffer({
    name: 'set_slot',
    params: {
      windowId: 0,
      slot: 5,
      item: { blockId: 261, itemCount: 1, itemDamage: 3, nbtData: nbt, gtnhFlag: 1 }
    }
  })
  const parsed = deserializer().parsePacketBuffer(buffer).data
  assert.strictEqual(parsed.params.item.blockId, 261)
  assert.strictEqual(parsed.params.item.itemDamage, 3)
  assert.strictEqual(parsed.params.item.gtnhFlag, 1)
  assert.strictEqual(parsed.params.item.nbtData.value.display.value.Name.value, '测试')
  // 布局：id(4) count(1) damage(2) nbtLen(2) nbt flag(1)，flag 永远在最后
  assert.strictEqual(buffer.readInt32BE(4), 261)
  assert.strictEqual(buffer[8], 1)
  assert.strictEqual(buffer.readUInt16BE(9), 3)
  const nbtLen = buffer.readInt16BE(11)
  assert.strictEqual(13 + nbtLen + 1, buffer.length)
  assert.strictEqual(buffer[buffer.length - 1], 1)
  assert.deepStrictEqual(buffer.subarray(13, 13 + 2), Buffer.from([0x1f, 0x8b]))
})

test('slot: window_items 的字段名是 items，46 个槽位（Backhand 副手槽）', () => {
  const items = new Array(46).fill({ blockId: -1 })
  items[36] = { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 }
  const buffer = serializer().createPacketBuffer({
    name: 'window_items',
    params: { windowId: 0, items }
  })
  const parsed = deserializer().parsePacketBuffer(buffer).data
  assert.strictEqual(parsed.params.items.length, 46)
  assert.strictEqual(parsed.params.items[36].blockId, 6241)
  assert.strictEqual(parsed.params.items[0].blockId, -1)
  // 46 * 4 + 36 号那件多出来的 6 字节
  assert.strictEqual(buffer.length, 1 + 1 + 2 + 46 * 4 + 6)
})

test('slot: window_click 的 clickedItem 也走同一套 slot', () => {
  const buffer = serializer(true).createPacketBuffer({
    name: 'window_click',
    params: {
      windowId: 0,
      slot: 36,
      mouseButton: 0,
      action: 1,
      mode: 0,
      item: { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 }
    }
  })
  const parsed = deserializer(true).parsePacketBuffer(buffer).data
  assert.strictEqual(parsed.params.slot, 36)
  assert.strictEqual(parsed.params.item.blockId, 6241)
})
