'use strict'

/*
 * 1.7.10 的 C04/C06 位置包线序：x, y(脚底), stance(眼睛), z, ...
 * minecraft-data 把第 2、3 个字段命名成 stance、y（顺序相反），
 * 直接发会被服务器当成非法 stance 踢掉（hodgepodge.disconnect.illegal_stance）。
 */

const assert = require('node:assert/strict')
const test = require('node:test')
const mc = require('minecraft-protocol')

const { mergeCustomPackets, GTNH_MOVEMENT_PACKETS } = require('../src')

const custom = mergeCustomPackets(GTNH_MOVEMENT_PACKETS)

function serializer () {
  return mc.createSerializer({ state: 'play', isServer: false, version: '1.7.10', customPackets: custom })
}

function deserializer () {
  return mc.createDeserializer({ state: 'play', isServer: true, version: '1.7.10', customPackets: custom })
}

test('position_look 的字段顺序是 x, y, stance, z', () => {
  const params = { x: 1.5, y: 69.5, stance: 71.12, z: 2.5, yaw: 90, pitch: 0, onGround: true }
  const body = serializer().proto.createPacketBuffer('packet_position_look', params)
  assert.equal(body.length, 41)

  // 前四个 double 依次是 x / y / stance / z
  assert.equal(body.readDoubleBE(0), 1.5)
  assert.equal(body.readDoubleBE(8), 69.5)
  assert.equal(body.readDoubleBE(16), 71.12)
  assert.equal(body.readDoubleBE(24), 2.5)
  assert.equal(body.readFloatBE(32), 90)
  assert.equal(body.readFloatBE(36), 0)
  assert.equal(body[40], 1)

  // 眼睛高度必须比脚底高 1.62，服务器就是这么校验的
  assert.ok(Math.abs((params.stance - params.y) - 1.62) < 1e-9)
})

test('position 的字段顺序是 x, y, stance, z', () => {
  const body = serializer().proto.createPacketBuffer('packet_position', {
    x: 0,
    y: 69,
    stance: 70.62,
    z: -3,
    onGround: false
  })
  assert.equal(body.length, 33)
  assert.equal(body.readDoubleBE(8), 69)
  assert.equal(body.readDoubleBE(16), 70.62)
})

test('反序列化能把字段还原成同一组值', () => {
  const params = { x: -3.5, y: 69.02, stance: 70.64, z: 6.58, yaw: -45.5, pitch: 12.25, onGround: true }
  const body = serializer().proto.createPacketBuffer('packet_position_look', params)
  const framed = Buffer.concat([Buffer.from([0x06]), body])
  const parsed = deserializer().parsePacketBuffer(framed)
  assert.equal(parsed.data.name, 'position_look')
  assert.deepEqual(parsed.data.params, params)
})

test('minecraft-data 1.7 把第 2、3 个字段命名反了（这是我们打补丁的原因）', () => {
  // 直接读协议定义，别用 createSerializer：nmp 的 createProtocol 只按
  // state/direction/version 做缓存，customPackets 不参与 key，先建过的协议会被复用。
  // 从磁盘重新读：nmp 建协议时会把 customPackets 合并进这份 JSON（require 缓存里就是同一个对象）
  const fs = require('node:fs')
  const path = require.resolve('minecraft-data/minecraft-data/data/pc/1.7/protocol.json')
  const proto = JSON.parse(fs.readFileSync(path, 'utf8'))
  const fields = proto.play.toServer.types.packet_position_look[1].map((f) => f.name)
  assert.deepEqual(fields, ['x', 'stance', 'y', 'z', 'yaw', 'pitch', 'onGround'])

  // 真实线序是 x, y(脚底), stance(眼睛), z —— 我们用自己的定义覆盖掉
  const ours = GTNH_MOVEMENT_PACKETS['1.7'].play.toServer.types.gtnh_position_look[1].map((f) => f.name)
  assert.deepEqual(ours, ['x', 'y', 'stance', 'z', 'yaw', 'pitch', 'onGround'])
})
