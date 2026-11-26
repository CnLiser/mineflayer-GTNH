'use strict'

/*
 * GTNH-PATCH: prismarine-physics 的 1.7.10 替身。
 *
 * prismarine-physics 没有 1.7.10 的数据（一 inject 就抛
 * "No liquid gravity settings"），而它的接口 mineflayer 只用两处：
 *
 *   const physics = Physics(registry, world)
 *   physics.simulatePlayer(new PlayerState(bot, control), world).apply(bot)
 *
 * 所以这里把 physics-tick.js（和 packages/mineflayer-gtnh/src/physics.js 是同一份）
 * 包成同样的形状。state.pos / state.vel 直接就是 bot.entity 上的 Vec3，原地改即可。
 */

const { Vec3 } = require('vec3')
const { tick } = require('./physics-tick')
const { blockShapes } = require('./blockshape')

class PlayerState {
  constructor (bot, control) {
    this.bot = bot
    this.control = control
    this.pos = bot.entity.position
    this.vel = bot.entity.velocity
    this.onGround = bot.entity.onGround
    this.yaw = bot.entity.yaw
    this.pitch = bot.entity.pitch
    this.sprinting = !!control.sprint
    this.sneaking = !!control.sneak
    this.effects = {}
    this.jumpBoost = 0
  }

  /* 物理已经原地改过 pos/vel/onGround，这里只把派生状态写回实体 */
  apply (bot) {
    bot.entity.position.set(this.pos.x, this.pos.y, this.pos.z)
    bot.entity.velocity.set(this.vel.x, this.vel.y, this.vel.z)
    bot.entity.onGround = this.onGround
  }
}

/*
 * GTNH-PATCH: 返回碰撞盒数组而不是布尔，半砖/台阶/栅栏才有正确高度
 * （1.7.10 的 minecraft-data 只有 boundingBox='block'，见 blockshape.js）。
 * 未加载的区块当空气：宁可掉下去也不要卡住。
 */
function shapesOfBlock (block) {
  if (!block) return null
  if (block.boundingBox !== 'block' && !(Array.isArray(block.shapes) && block.shapes.length > 0)) {
    return null
  }
  return blockShapes(block)
}

function Physics (registry, world) {
  return {
    // mineflayer 用来算每 tick 允许转多少角度，1.7/1.8 的手感
    yawSpeed: 3.0,
    pitchSpeed: 3.0,
    simulatePlayer (state, worldOrGetter) {
      // 注意必须绑 this：直接取出方法引用调用会让 GTNHWorld.getBlock 里的 this 丢失，
      // 每 tick 抛 "Cannot read properties of undefined (reading 'store')"，物理就整个不生效。
      const getBlock = (x, y, z) => {
        const w = (worldOrGetter && worldOrGetter.getBlock) ? worldOrGetter : world
        return w.getBlock(new Vec3(x, y, z))
      }
      const shapeAt = (x, y, z) => shapesOfBlock(getBlock(x, y, z))
      // 让 tick 直接改 state 上的 Vec3；onGround / 跳跃标记要回写给 PlayerState，
      // 否则实体永远处于「空中」，水平加速度一直是 0.02，走路慢得像在水里。
      const st = { position: state.pos, velocity: state.vel, onGround: state.onGround, jumped: false }
      tick(st, state.control, shapeAt, state.yaw)
      state.onGround = st.onGround
      // mineflayer 调 .apply(bot)；这里必须真的写回实体（OnGround / pos / vel），
      // 否则 bot.entity.onGround 永远 false，地面加速度 0.6 变 0.02，走路慢得像水里。
      return { apply: (b) => { if (typeof state.apply === 'function') state.apply(b || state.bot) } }
    }
  }
}

module.exports = { Physics, PlayerState }
