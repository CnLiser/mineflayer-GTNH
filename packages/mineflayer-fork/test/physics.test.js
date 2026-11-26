'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { Vec3 } = require('vec3')
const { Physics, PlayerState } = require('../lib/gtnh/physics')

/* 一个极简世界：y < 0 全是实心方块，其余是空气 */
function flatWorld () {
  return {
    getBlock (pos) {
      if (pos.y < 0) return { type: 1, boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]] }
      return { type: 0, boundingBox: 'empty', shapes: [] }
    }
  }
}

function fakeBot (y = 0.5) {
  return {
    entity: {
      position: new Vec3(0.5, y, 0.5),
      velocity: new Vec3(0, 0, 0),
      onGround: false,
      yaw: 0,
      pitch: 0
    }
  }
}

test('Physics: 从空中落到地面后 onGround = true', () => {
  const bot = fakeBot(2)
  const physics = Physics(null, flatWorld())
  const control = {}
  for (let i = 0; i < 20; i++) {
    const state = new PlayerState(bot, control)
    physics.simulatePlayer(state, flatWorld()).apply(bot)
  }
  assert.strictEqual(bot.entity.onGround, true, '落地后 onGround 必须回写到实体')
  assert.ok(Math.abs(bot.entity.position.y - 0) < 1e-3, `应停在地面 y≈0，实际 ${bot.entity.position.y}`)
})

test('Physics: forward 在地面上加速到接近走路速度', () => {
  const bot = fakeBot(0)
  bot.entity.onGround = true
  const physics = Physics(null, flatWorld())
  const control = { forward: true }
  for (let i = 0; i < 20; i++) {
    physics.simulatePlayer(new PlayerState(bot, control), flatWorld()).apply(bot)
  }
  const speed = Math.hypot(bot.entity.velocity.x, bot.entity.velocity.z) * 20
  assert.ok(speed > 3 && speed < 5.5, `地面速度应接近 4.3 格/秒，实际 ${speed.toFixed(2)}`)
})

test('Physics: apply 会把 pos / vel / onGround 写回实体', () => {
  const bot = fakeBot(0)
  const physics = Physics(null, flatWorld())
  const state = new PlayerState(bot, {})
  state.pos.set(3, 0, 4)
  state.vel.set(1, 0, 0)
  state.onGround = true
  physics.simulatePlayer(state, flatWorld()).apply(bot)
  assert.strictEqual(bot.entity.position.x, state.pos.x)
  assert.strictEqual(bot.entity.velocity.x, state.vel.x)
})
