const { test } = require('node:test')
const assert = require('node:assert')

const { cablePlan, CABLE, TOOL_ITEM, powerNeighbours } = require('../lib/gtnh/power')

test('cablePlan：同一行两点之间要铺的导线格与两端的面', () => {
  // 机器 (0,64,0) —— 太阳能 (2,64,0)，中间只有 (1,64,0)
  const plan = cablePlan({ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 })
  assert.deepStrictEqual(plan.cells, [{ x: 1, y: 64, z: 0 }])
  assert.strictEqual(plan.genFace, 4)      // 太阳能朝 -x（对着导线）
  assert.strictEqual(plan.machineFace, 5)  // 机器朝 +x
})

test('cablePlan：相邻时不需要导线，但两面仍然要对上', () => {
  const plan = cablePlan({ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 })
  assert.deepStrictEqual(plan.cells, [])
  assert.strictEqual(plan.genFace, 4)
  assert.strictEqual(plan.machineFace, 5)
})

test('cablePlan：不在同一行的两点给不出计划', () => {
  assert.strictEqual(cablePlan({ x: 0, y: 64, z: 0 }, { x: 1, y: 65, z: 3 }), null)
})

test('CABLE / TOOL_ITEM 的 id 与 damage 是实机抄下来的', () => {
  assert.deepStrictEqual(CABLE.tin1xBare, { id: 3003, damage: 1240 })
  assert.deepStrictEqual(CABLE.tin1xInsulated, { id: 3003, damage: 1246 })
  assert.deepStrictEqual(TOOL_ITEM.wrench, { id: 7649, damage: 16 })
  assert.deepStrictEqual(TOOL_ITEM.cutter, { id: 7649, damage: 26 })
})

test('powerNeighbours：六面邻居', () => {
  const bot = { blockAt: () => ({ name: 'gregtech:gt.blockmachines', metadata: 8 }) }
  const n = powerNeighbours(bot, { x: 0, y: 64, z: 0 })
  assert.strictEqual(n.length, 6)
  assert.ok(n.some((e) => e.offset[0] === 1 && e.offset[1] === 0 && e.offset[2] === 0))
  assert.ok(n.some((e) => e.offset[0] === 0 && e.offset[1] === -1 && e.offset[2] === 0))
})
