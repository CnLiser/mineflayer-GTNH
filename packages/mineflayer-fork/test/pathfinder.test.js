const { test } = require('node:test')
const assert = require('node:assert')
const { findPath, digAhead, canStand } = require('../lib/gtnh/pathfinder')
const { Vec3 } = require('vec3')

// 假世界：y<0 一律是地面；地图里的 '#' 表示 y=1~2 两格高的墙（挡路的障碍）
function world (rows) {
  return {
    solidAt: (x, y, z) => {
      if (y < 0) return true
      if (y !== 1 && y !== 2) return false
      if (z < 0 || z >= rows.length) return false
      if (x < 0 || x >= rows[z].length) return false
      return rows[z][x] === '#'
    }
  }
}

test('canStand：脚下实心、身体两格空', () => {
  const w = world(['...'])
  assert.equal(canStand(w.solidAt, 0, 0, 0), true)
  assert.equal(canStand(w.solidAt, 0, 1, 0), false) // 脚下是空气，站不住
})

test('空地上直线走', () => {
  const w = world(['.....'])
  const path = findPath(w, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 })
  assert.ok(path)
  assert.deepEqual(path[path.length - 1], { x: 3, y: 0, z: 0 })
  assert.equal(path.length, 4)
})

test('绕开一堵墙', () => {
  const w = world(['.....', '..#..', '.....'])
  const path = findPath(w, { x: 0, y: 0, z: 1 }, { x: 4, y: 0, z: 1 })
  assert.ok(path)
  assert.ok(path.some((p) => p.z !== 1), '应该绕到别的行')
  assert.equal(path[path.length - 1].x, 4)
})

test('一格高的台阶能上去', () => {
  // z>=2 的地方地面抬高 1 格
  const w = { solidAt: (x, y, z) => (y < 0 ? true : y === 0 || (z >= 2 && y === 1)) }
  const path = findPath(w, { x: 0, y: 1, z: 1 }, { x: 0, y: 2, z: 3 })
  assert.ok(path)
  assert.equal(path[path.length - 1].y, 2)
  assert.equal(path[path.length - 1].z, 3)
})

test('从高处能跳下去（有限下落）', () => {
  // z<=0 是台子（表面在 y=1），z>0 是平地（表面在 y=0）
  const w = { solidAt: (x, y, z) => (y < 0 ? true : z <= 0 ? y === 1 : y === 0) }
  const path = findPath(w, { x: 0, y: 2, z: 0 }, { x: 0, y: 1, z: 3 })
  assert.ok(path)
  assert.equal(path[path.length - 1].y, 1)
  assert.ok(path.some((p) => p.y === 1), '要掉下来')
})

test('目标被围死时返回 null', () => {
  const wall = { solidAt: (x, y, z) => (y < 0 ? true : y === 1 || y === 2 ? (x === 1 || x === -1 || z === 1 || z === -1) : false) }
  const path = findPath(wall, { x: 0, y: 0, z: 0 }, { x: 0, y: 3, z: 0 })
  assert.equal(path, null)
})

// 假 bot：只实现 digAhead 需要的那几样
function digBot (free) {
  const dug = []
  return {
    dug,
    entity: { position: new Vec3(0.5, 1, 0.5) },
    blockAt: (p) => free(p) ? null : { name: 'minecraft:stone', boundingBox: 'block', position: p },
    dig: async (b) => { dug.push(b.position.toString()) }
  }
}

test('digAhead 会挖掉正前方 2 格外的墙', async () => {
  const bot = digBot((p) => p.z < 2)
  const ok = await digAhead(bot, new Vec3(0.5, 1, 5))
  assert.equal(ok, true)
  assert.deepEqual(bot.dug, ['(0, 1, 2)', '(0, 2, 2)'])
})

test('digAhead 碰到基岩就不挖', async () => {
  const bot = digBot((p) => p.z < 2)
  bot.blockAt = (p) => p.z < 2 ? null : { name: 'minecraft:bedrock', boundingBox: 'block', position: p }
  const ok = await digAhead(bot, new Vec3(0.5, 1, 5))
  assert.equal(ok, false)
  assert.equal(bot.dug.length, 0)
})

test('dig: 两格高的墙能被规划成挖穿，不带 dig 就是没路', () => {
  const solidAt = (x, y, z) => y === 0 || (z === 2 && (y === 1 || y === 2))
  const start = { x: 0, y: 1, z: 0 }; const goal = { x: 0, y: 1, z: 4 }
  assert.equal(findPath({ solidAt }, start, goal), null)
  const path = findPath({ solidAt }, start, goal, { dig: true })
  assert.ok(path)
  assert.ok(path.some((p) => p.z === 2))
})

test('dig: 挖不动的方块（基岩）不算路', () => {
  const solidAt = (x, y, z) => y === 0 || (z === 2 && (y === 1 || y === 2))
  const diggable = (x, y, z) => !(z === 2)
  assert.equal(findPath({ solidAt }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 4 }, { dig: true, diggable }), null)
})

test('bridge: 跨过 6 格深的沟要搭桥，否则无路', () => {
  // y=0 是地面，z=2 处挖空到 y=-6 以下
  const solidAt = (x, y, z) => (z === 2 ? y <= -6 : y === 0)
  const start = { x: 0, y: 1, z: 0 }; const goal = { x: 0, y: 1, z: 4 }
  assert.equal(findPath({ solidAt }, start, goal), null)
  const path = findPath({ solidAt }, start, goal, { bridge: true })
  assert.ok(path)
  assert.ok(path.some((p) => p.z === 2 && p.y === 1))
})
