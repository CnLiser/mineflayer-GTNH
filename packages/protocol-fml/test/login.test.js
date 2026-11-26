'use strict'

/*
 * GTNH 的登录包（S01PacketJoinGame）比原版多一个 int 维度 id。
 * Hodgepodge 的 MixinS01PacketJoinGame_FixDimensionID 在 write 末尾追加 writeInt(dimensionID)，
 * 读端判断「还剩 >=4 字节才读」。minecraft-data 的定义没有这 4 字节，
 * 于是每一帧都报 `Chunk size is 17 but only 13 was read`，
 * mineflayer 的状态机会偶尔因此卡在登录、不触发 spawn。
 */

const test = require('node:test')
const assert = require('node:assert')
const mc = require('minecraft-protocol')
const { GTNH_LOGIN_PACKETS } = require('../src/index.js')

function deserializer () {
  return mc.createDeserializer({
    state: 'play',
    isServer: false,
    version: '1.7.10',
    customPackets: GTNH_LOGIN_PACKETS
  })
}

// 真实抓包：entityId=13302, gameMode=0, dimension=0, difficulty=3, maxPlayers=20, levelType=RWG
const GTNH_LOGIN = Buffer.from('01000033f6000003140352574700000000', 'hex')
const VANILLA_LOGIN = Buffer.from('01000033f60000031403525747', 'hex')

test('GTNH 登录包末尾 4 字节是维度 id', () => {
  const packet = deserializer().parsePacketBuffer(GTNH_LOGIN)
  assert.strictEqual(packet.data.name, 'login')
  assert.strictEqual(packet.data.params.entityId, 13302)
  assert.strictEqual(packet.data.params.levelType, 'RWG')
  assert.ok(Buffer.isBuffer(packet.data.params.dimensionId))
  assert.strictEqual(packet.data.params.dimensionId.readInt32BE(0), 0)
  assert.strictEqual(packet.metadata.size, GTNH_LOGIN.length, '必须正好读完，不能有剩余字节')
})

test('原版服不带维度 id 也能解析（dimensionId 为空）', () => {
  const packet = deserializer().parsePacketBuffer(VANILLA_LOGIN)
  assert.strictEqual(packet.data.name, 'login')
  assert.strictEqual(packet.data.params.dimensionId.length, 0)
  assert.strictEqual(packet.metadata.size, VANILLA_LOGIN.length)
})

test('大维度 id（>127）不被 i8 截断', () => {
  const buf = Buffer.concat([VANILLA_LOGIN, Buffer.from('0000012c', 'hex')]) // 300
  const packet = deserializer().parsePacketBuffer(buf)
  assert.strictEqual(packet.data.params.dimensionId.readInt32BE(0), 300)
  assert.strictEqual(packet.data.params.dimension, 0, '原版 dimension 字段仍是 i8，不要拿它当维度 id')
})
