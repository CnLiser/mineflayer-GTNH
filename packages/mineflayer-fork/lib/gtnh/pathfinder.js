// GTNH-PATCH: 最简 A* 寻路（地面行走 + 1 格上台阶 + 有限下落）。
//
// 上游 mineflayer 的 pathfinder 是独立包（mineflayer-pathfinder），依赖 1.8+ 的
// 方块形状和 physics 实现，在 1.7.10 上跑不起来。这里只做「够用」的那一层：
// 在整数格点上搜一条能走的路，交给现有的 physics 去执行。
//
// 网格假设：站在整数格 (x, y, z) 的脚底位置，身体占 y 和 y+1 两格，
// 脚下 y-1 必须是实心。半砖/台阶按整块算（physics 的 stepUp 会处理 0.5 格）。
//
//   const path = findPath({ solidAt }, start, goal)   // [{x,y,z}, ...]
const MAX_NODES = 6000
const MAX_FALL = 4

function key (x, y, z) { return x + ',' + y + ',' + z }

function canStand (solidAt, x, y, z) {
  return solidAt(x, y - 1, z) && !solidAt(x, y, z) && !solidAt(x, y + 1, z)
}

// 从 (x,y,z) 往下掉，找到第一个能站住的高度；超出 MAX_FALL 或落进虚空就放弃
function fallTo (solidAt, x, y, z) {
  for (let d = 0; d <= MAX_FALL; d++) {
    const ny = y - d
    if (canStand(solidAt, x, ny, z)) return ny
    if (solidAt(x, ny, z)) return null // 脚底这格是实心，站不进去
  }
  return null
}

function findPath (world, start, goal, opts = {}) {
  const solidAt = world.solidAt
  const sx = Math.floor(start.x); const sy = Math.round(start.y); const sz = Math.floor(start.z)
  const gx = Math.floor(goal.x); const gy = Math.round(goal.y); const gz = Math.floor(goal.z)
  const maxNodes = opts.maxNodes || MAX_NODES
  const startKey = key(sx, sy, sz)

  const bad = (reason) => { if (opts.stats) { opts.stats.reason = reason; opts.stats.nodes = 0 } return null }
  if (!canStand(solidAt, sx, sy, sz)) return bad('起点站不住')
  if (!canStand(solidAt, gx, gy, gz)) return bad('目标站不住')

  const open = [{ x: sx, y: sy, z: sz, g: 0, f: 0, parent: null }]
  const best = new Map([[startKey, 0]])
  const closed = new Set()
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]]
  let nodes = 0

  while (open.length) {
    // 手写小顶堆太重，节点数少，直接线性取最小
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i
    const cur = open.splice(bi, 1)[0]
    if (cur.x === gx && cur.y === gy && cur.z === gz) {
      const path = []
      for (let n = cur; n; n = n.parent) path.push({ x: n.x, y: n.y, z: n.z })
      return path.reverse()
    }
    const curKey = key(cur.x, cur.y, cur.z)
    if (closed.has(curKey)) continue
    closed.add(curKey)
    if (++nodes > maxNodes) break

    for (const [dx, dz] of dirs) {
      const neighbors = []
      const nx = cur.x + dx; const nz = cur.z + dz
      // 平走
      if (canStand(solidAt, nx, cur.y, nz)) neighbors.push([nx, cur.y, nz, 1])
      // 上台阶：头顶要空，目标格能站
      if (!solidAt(cur.x, cur.y + 2, cur.z) && canStand(solidAt, nx, cur.y + 1, nz)) {
        neighbors.push([nx, cur.y + 1, nz, 1.5])
      }
      // 下落（走到边缘掉下去）
      const fy = fallTo(solidAt, nx, cur.y - 1, nz)
      if (fy !== null && fy < cur.y) neighbors.push([nx, fy, nz, 1 + (cur.y - fy) * 0.3])

      for (const [x, y, z, cost] of neighbors) {
        const k = key(x, y, z)
        if (closed.has(k)) continue
        const g = cur.g + cost
        if (best.has(k) && best.get(k) <= g) continue
        best.set(k, g)
        const h = Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz)
        open.push({ x, y, z, g, f: g + h, parent: cur })
      }
    }
  }
  if (opts.stats) { opts.stats.nodes = nodes; opts.stats.visited = closed.size }
  return null
}

// 把路径喂给 bot：每个节点先 lookAt，再按住 forward；1 格高的台阶额外按 jump。
// 这是一个「能用」的执行器，不做避障重规划；卡住就返回 false 由调用方决定。
async function followPath (bot, path, opts = {}) {
  const { Vec3 } = require('vec3')
  const tickMs = opts.tickMs || 50
  const reach = opts.reach || 0.35
  const timeoutMs = opts.timeoutMs || 30000
  const started = Date.now()

  for (let i = 1; i < path.length; i++) {
    const target = path[i]
    const goal = new Vec3(target.x + 0.5, target.y, target.z + 0.5)
    while (Date.now() - started < timeoutMs) {
      const p = bot.entity.position
      const dist = p.distanceTo(goal)
      if (dist <= reach) break
      // 1.7 的 physics 用 (sin(yaw), cos(yaw)) 当前向，所以 yaw=atan2(dx,dz) 才正对目标
      const dx = goal.x - p.x; const dz = goal.z - p.z
      if (Math.hypot(dx, dz) > 0.05) bot.entity.yaw = Math.atan2(dx, dz)
      bot.setControlState('forward', true)
      if (target.y > Math.round(p.y)) bot.setControlState('jump', true)
      else bot.setControlState('jump', false)
      await new Promise((r) => setTimeout(r, tickMs))
      if (bot.pathfinderAbort) return false
    }
    bot.setControlState('forward', false)
    bot.setControlState('jump', false)
    const p = bot.entity.position
    if (p.distanceTo(goal) > 2) return false
  }
  bot.setControlState('forward', false)
  bot.setControlState('jump', false)
  return true
}

// 挂到 bot 上：solidAt / findPathTo / goto
function attachPathfinder (bot) {
  const { Vec3 } = require('vec3')
  const { blockShapes } = require('./blockshape')
  // 没加载的区块当实心：宁可绕路，不要走进未知地形
  bot.solidAt = (x, y, z) => {
    const b = bot.blockAt(new Vec3(x, y, z))
    if (!b) return true
    return blockShapes(b).length > 0
  }
  bot.findPathTo = (goal, opts) => findPath({ solidAt: bot.solidAt }, bot.entity.position, goal, opts)
  bot.goto = async (goal, opts) => {
    const path = bot.findPathTo(goal, opts)
    if (!path) return false
    return followPath(bot, path, opts)
  }
}

module.exports = { findPath, followPath, canStand, fallTo, attachPathfinder }
