'use strict'

/*
 * 1.7.10 的玩家物理。不做精确复刻，只求「能走、能跳、不会掉进方块里」。
 *
 * 和原版的差别：
 *   - 原版有 0.6 的自动上台阶，这里没做（台阶就跳过去）；
 *   - 方块碰撞箱一律按整块算（minecraft-data 1.7 只有 block/empty 两种），
 *     所以栅栏/台阶/半砖这些会被当成整块，实际游玩会卡住；
 *   - 水里、梯子、冰面等特殊移动没做。
 *
 * 坐标系：position 是脚底中心，AABB = [x±0.3, y..y+1.8, z±0.3]。
 */

const { Vec3 } = require('vec3')

const WIDTH = 0.6
const HEIGHT = 1.8
const EYE_HEIGHT = 1.62
const HALF = WIDTH / 2

const GRAVITY = 0.08
const DRAG = 0.98
const TERMINAL_VELOCITY = 3.92
const JUMP_VELOCITY = 0.42

// 单位是 格/tick（20 tick/s）：4.317 m/s = 0.21585 格/tick
const SPEED = {
  walk: 4.317 / 20,
  sprint: 5.612 / 20,
  sneak: 1.295 / 20
}

const EPS = 1e-7
const MAX_STEP = 0.25

// 玩家 AABB 覆盖到的整数方块坐标
function blocksInAABB (pos, cb) {
  const minX = Math.floor(pos.x - HALF + EPS)
  const maxX = Math.floor(pos.x + HALF - EPS)
  const minY = Math.floor(pos.y + EPS)
  const maxY = Math.floor(pos.y + HEIGHT - EPS)
  const minZ = Math.floor(pos.z - HALF + EPS)
  const maxZ = Math.floor(pos.z + HALF - EPS)
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        if (cb(x, y, z)) return true
      }
    }
  }
  return false
}

function collides (pos, isSolid) {
  return blocksInAABB(pos, (x, y, z) => isSolid(x, y, z))
}

/*
 * 自动上台阶：原版 stepHeight = 0.6。
 * 抬 0.6 格 -> 横向移动 -> 再往下落回最近的可站立高度。
 */
function stepUp (state, axis, delta, isSolid) {
  const lifted = state.position.clone()
  lifted.y += 0.6
  if (collides(lifted, isSolid)) return false

  const moved = lifted.clone()
  if (axis === 'x') moved.x += delta
  if (axis === 'z') moved.z += delta
  if (collides(moved, isSolid)) return false

  // 往下落，直到快要碰撞（留 0.01 余量）
  while (moved.y - 0.05 > state.position.y && !collides(moved.clone().translate(0, -0.05, 0), isSolid)) {
    moved.y -= 0.05
  }
  state.position.set(moved.x, moved.y, moved.z)
  state.velocity.y = 0
  state.onGround = true
  return true
}

/*
 * 沿一个轴移动，遇到碰撞就停在接触面。
 * 返回是否撞到了东西。
 */
function moveAxis (state, axis, delta, isSolid) {
  if (!delta) return false
  let remaining = delta
  while (Math.abs(remaining) > 1e-10) {
    const step = Math.max(-MAX_STEP, Math.min(MAX_STEP, remaining))
    const next = state.position.clone()
    if (axis === 'x') next.x += step
    if (axis === 'y') next.y += step
    if (axis === 'z') next.z += step

    if (!collides(next, isSolid)) {
      state.position.set(next.x, next.y, next.z)
      remaining -= step
      continue
    }

    // 撞上了：在「当前位置」和「下一个位置」之间二分，贴到接触面
    let lo = 0
    let hi = step
    const probe = state.position.clone()
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2
      probe.set(state.position.x, state.position.y, state.position.z)
      probe[axis] += mid
      if (collides(probe, isSolid)) hi = mid
      else lo = mid
    }
    state.position[axis] += lo
    if (axis === 'y' && step < 0) state.onGround = true
    state.velocity[axis] = 0
    return true
  }
  return false
}

/*
 * 模拟一 tick（50ms）。state 会被原地修改：
 *   state.position  Vec3
 *   state.velocity  Vec3
 *   state.onGround  boolean
 * control: { forward, back, left, right, jump, sneak, sprint }
 */
function tick (state, control, isSolid, yaw) {
  // 出生点有时会嵌在方块里（服务器给的 y 不是整数），先往上顶出来，
  // 否则任何方向移动都会立刻撞墙，人物卡死。
  if (collides(state.position, isSolid)) {
    state.position.y += 0.1
    state.velocity.y = 0
    state.onGround = true
    return state
  }

  // 先用上一 tick 的落地状态算跳跃/加速度，再重新判定
  const wasOnGround = state.onGround
  state.onGround = false

  // ---- 水平目标速度（yaw 方向：0 = +z，顺时针为正）----
  let forward = 0
  let strafe = 0
  if (control.forward) forward += 1
  if (control.back) forward -= 1
  if (control.left) strafe -= 1
  if (control.right) strafe += 1

  const speed = control.sneak ? SPEED.sneak : (control.sprint ? SPEED.sprint : SPEED.walk)
  let targetX = 0
  let targetZ = 0
  if (forward || strafe) {
    const len = Math.hypot(forward, strafe)
    // MC 里 yaw=0 面向 +z，yaw 增加是向右转
    const sin = Math.sin(yaw)
    const cos = Math.cos(yaw)
    const nx = (forward * sin + strafe * cos) / len
    const nz = (forward * cos - strafe * sin) / len
    targetX = nx * speed
    targetZ = nz * speed
  }

  // 地面加速快，空中几乎不能转向
  const blend = wasOnGround ? 0.6 : 0.02
  state.velocity.x += (targetX - state.velocity.x) * blend
  state.velocity.z += (targetZ - state.velocity.z) * blend
  if (Math.abs(state.velocity.x) < 1e-4) state.velocity.x = 0
  if (Math.abs(state.velocity.z) < 1e-4) state.velocity.z = 0

  // ---- 竖直 ----
  if (control.jump && wasOnGround) {
    state.velocity.y = JUMP_VELOCITY
    state.onGround = false
  }

  // ---- 逐轴移动：先 Y，再 X/Z（水平撞墙时尝试上台阶）----
  moveAxis(state, 'y', state.velocity.y, isSolid)
  if (moveAxis(state, 'x', state.velocity.x, isSolid) && wasOnGround && state.velocity.x !== 0) {
    if (!stepUp(state, 'x', Math.sign(state.velocity.x) * Math.min(Math.abs(state.velocity.x), 0.3), isSolid)) {
      state.velocity.x = 0
    }
  }
  if (moveAxis(state, 'z', state.velocity.z, isSolid) && wasOnGround && state.velocity.z !== 0) {
    if (!stepUp(state, 'z', Math.sign(state.velocity.z) * Math.min(Math.abs(state.velocity.z), 0.3), isSolid)) {
      state.velocity.z = 0
    }
  }

  // 重力与阻力放在移动之后结算：原版就是「先动，再 motionY = (motionY - 0.08) * 0.98」，
  // 顺序反了跳跃高度会从 1.25 格掉到 1.0 格左右。
  state.velocity.y = (state.velocity.y - GRAVITY) * DRAG
  if (state.velocity.y < -TERMINAL_VELOCITY) state.velocity.y = -TERMINAL_VELOCITY

  // 落地判定（站在地面上时 velocity.y 已被清零）
  if (state.position.y < -64) {
    // 掉出世界：拉回出生点，避免越掉越远
    state.position.set(0, 80, 0)
    state.velocity.set(0, 0, 0)
  }
  return state
}

module.exports = {
  tick,
  collides,
  blocksInAABB,
  WIDTH,
  HEIGHT,
  EYE_HEIGHT,
  HALF,
  SPEED,
  GRAVITY,
  JUMP_VELOCITY
}
