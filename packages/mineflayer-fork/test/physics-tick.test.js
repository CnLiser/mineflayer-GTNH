'use strict'

// 1.7.10 玩家物理的行为回归。物理 tick 是从 packages/mineflayer-gtnh/src/physics.js
// 搬过来的同一份实现（lib/gtnh/physics-tick.js），这里保留它原有的 13 条断言。

const assert = require('node:assert/strict')
const test = require('node:test')
const { Vec3 } = require('vec3')

const physics = require('../lib/gtnh/physics-tick')

const GROUND_Y = 64

function flatGround (extra = () => false) {
  return (x, y, z) => y < GROUND_Y || extra(x, y, z)
}

function state (x = 0.5, y = GROUND_Y, z = 0.5) {
  return { position: new Vec3(x, y, z), velocity: new Vec3(0, 0, 0), onGround: true }
}

function run (st, ticks, control, isSolid, yaw = 0) {
  for (let i = 0; i < ticks; i++) physics.tick(st, control, isSolid, yaw)
  return st
}

test('站在地面上会停住，不会往下沉', () => {
  const isSolid = flatGround()
  const st = run(state(), 20, {}, isSolid)
  assert.equal(st.position.y, GROUND_Y)
  assert.equal(st.onGround, true)
  // 站着不动时重力仍在累积（原版也一样），但位置被地面挡住
  assert.ok(st.velocity.y <= 0)
})

test('从空中落下会落到地面并停住', () => {
  const isSolid = flatGround()
  const st = run(state(0.5, GROUND_Y + 10, 0.5), 60, {}, isSolid)
  assert.ok(Math.abs(st.position.y - GROUND_Y) < 1e-3, `落到了 ${st.position.y}`)
  assert.equal(st.onGround, true)
})

test('嵌入方块里会自己顶出来', () => {
  const isSolid = flatGround()
  const st = state(0.5, GROUND_Y - 0.5, 0.5)
  physics.tick(st, {}, isSolid, 0)
  assert.ok(st.position.y > GROUND_Y - 0.5)
})

test('向前走一秒约 4.3 格（4.317 格/秒）', () => {
  const isSolid = flatGround()
  const st = run(state(), 20, { forward: true }, isSolid)
  const dz = st.position.z - 0.5
  assert.ok(dz > 3.8 && dz < 4.6, `走了 ${dz.toFixed(3)} 格`)
  assert.ok(Math.abs(st.position.x - 0.5) < 1e-9)
})

test('疾跑比走路快、潜行更慢', () => {
  const isSolid = flatGround()
  const walk = run(state(), 40, { forward: true }, isSolid).position.z
  const sprint = run(state(), 40, { forward: true, sprint: true }, isSolid).position.z
  const sneak = run(state(), 40, { forward: true, sneak: true }, isSolid).position.z
  assert.ok(sprint > walk)
  assert.ok(sneak < walk)
})

test('yaw 转 90 度后前进方向变成 x', () => {
  const isSolid = flatGround()
  const st = run(state(), 20, { forward: true }, isSolid, Math.PI / 2)
  assert.ok(st.position.x > 3.5, `x=${st.position.x}`)
  assert.ok(Math.abs(st.position.z - 0.5) < 1e-6)
})

test('跳跃高度约 1.25 格', () => {
  const isSolid = flatGround()
  const st = state()
  let apex = st.position.y
  physics.tick(st, { jump: true }, isSolid, 0) // 只按一 tick，之后松开，否则会连跳
  for (let i = 0; i < 40; i++) {
    physics.tick(st, {}, isSolid, 0)
    apex = Math.max(apex, st.position.y)
  }
  const height = apex - GROUND_Y
  assert.ok(height > 1.1 && height < 1.4, `跳了 ${height.toFixed(3)} 格`)
  assert.ok(Math.abs(st.position.y - GROUND_Y) < 1e-3, '最终要落回地面')
  assert.equal(st.onGround, true)
})

test('撞墙会停下并贴住墙面', () => {
  const isSolid = flatGround((x, y, z) => z >= 2)
  const st = run(state(), 40, { forward: true }, isSolid)
  assert.ok(st.position.z < 2, '不能穿墙')
  assert.ok(st.position.z > 1.6, `应贴到墙前，实际 z=${st.position.z}`)
})

test('半砖在体素模型里按整块算，走不上去（已知限制）', () => {
  // minecraft-data 1.7 的 boundingBox 只有 empty/block，没有半砖的真实高度，
  // 所以 stepUp 只对「方块之间的缝」有用，半砖仍需跳。
  const ledge = (x, y, z) => y < GROUND_Y || (z >= 1 && y < GROUND_Y + 0.5)
  const walking = run(state(), 40, { forward: true }, ledge)
  assert.equal(walking.position.y, GROUND_Y)
  assert.ok(walking.position.z < 1)

  const jumping = run(state(), 40, { forward: true, jump: true }, ledge)
  assert.ok(jumping.position.y >= GROUND_Y + 1 - 1e-6)
})

test('一格高的坎走不上去，跳才上得去', () => {
  const cliff = (x, y, z) => y < GROUND_Y || (z >= 1 && y < GROUND_Y + 1)
  const walking = run(state(), 60, { forward: true }, cliff)
  assert.equal(walking.position.y, GROUND_Y, '不跳不该上去')
  assert.ok(walking.position.z < 1)

  const jumping = run(state(), 60, { forward: true, jump: true }, cliff)
  assert.ok(jumping.position.z > 1, '跳上去后应该越过 z=1')
  assert.ok(jumping.position.y >= GROUND_Y + 1 - 1e-6)
})

test('掉出世界会被拉回出生点', () => {
  const isSolid = () => false
  const st = state(0.5, -80, 0.5)
  physics.tick(st, {}, isSolid, 0)
  assert.deepEqual([st.position.x, st.position.y, st.position.z], [0, 80, 0])
})

test('碰撞箱是 0.6 x 1.8', () => {
  assert.equal(physics.WIDTH, 0.6)
  assert.equal(physics.HEIGHT, 1.8)
  assert.equal(physics.EYE_HEIGHT, 1.62)
  // 脚下方块算实心，头顶再高一格不算
  const isSolid = () => true
  assert.equal(physics.collides(new Vec3(0, 10, 0), isSolid), true)
})
