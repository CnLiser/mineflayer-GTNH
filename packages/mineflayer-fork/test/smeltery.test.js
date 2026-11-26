const assert = require('node:assert')
const test = require('node:test')
const { readSmeltery, smelteryAmount, readCastingBlock, readTank, CURSOR } = require('../lib/gtnh/smeltery')

// 造一个只带 blockEntities 的假 bot（值是 prismarine-nbt 风格的 { type, value } 树）
function fakeBot (map) {
  return { blockEntities: new Map(Object.entries(map)) }
}
const nbt = (v) => ({ type: 'dummy', value: v })

const controller = {
  '40,81,41': nbt({
    ValidStructure: nbt(1),
    Layers: nbt(2),
    MaxLiquid: nbt(2880),
    Direction: nbt(4),
    Liquids: nbt([{ Amount: nbt(1296), FluidName: nbt('iron.molten') }])
  })
}

test('readSmeltery 解出结构/层数/液体', () => {
  const s = readSmeltery(fakeBot(controller), { x: 40, y: 81, z: 41 })
  assert.strictEqual(s.valid, true)
  assert.strictEqual(s.layers, 2)
  assert.strictEqual(s.maxLiquid, 2880)
  assert.strictEqual(s.direction, 4)
  assert.deepStrictEqual(s.liquids, [{ fluid: 'iron.molten', amount: 1296 }])
})

test('smelteryAmount 支持按流体过滤，未加载返回 0', () => {
  const bot = fakeBot(controller)
  assert.strictEqual(smelteryAmount(bot, { x: 40, y: 81, z: 41 }), 1296)
  assert.strictEqual(smelteryAmount(bot, { x: 40, y: 81, z: 41 }, 'iron.molten'), 1296)
  assert.strictEqual(smelteryAmount(bot, { x: 40, y: 81, z: 41 }, 'gold.molten'), 0)
  assert.strictEqual(smelteryAmount(bot, { x: 1, y: 2, z: 3 }), 0)
})

test('readCastingBlock / readTank', () => {
  const bot = fakeBot({
    '41,80,39': nbt({ hasLiquid: nbt(1), Capacity: nbt(144), maxCastingDelay: nbt(50), Items: nbt([{ id: nbt(4526), Damage: nbt(2), Count: nbt(1), Slot: nbt(0) }]) }),
    '42,81,41': nbt({ amount: nbt(3685), fluidName: nbt('lava') })
  })
  const t = readCastingBlock(bot, { x: 41, y: 80, z: 39 })
  assert.strictEqual(t.hasLiquid, true)
  assert.strictEqual(t.capacity, 144)
  assert.strictEqual(t.maxDelay, 50)
  assert.strictEqual(t.items[0].id, 4526)
  assert.deepStrictEqual(readTank(bot, { x: 42, y: 81, z: 41 }), { fluid: 'lava', amount: 3685 })
})

test('cursor 表：命中面所在轴取 0/16，另两轴 8', () => {
  for (const [face, c] of Object.entries(CURSOR)) {
    const vals = [c.x, c.y, c.z]
    const onFace = vals.filter((v) => v === 0 || v === 16)
    assert.strictEqual(onFace.length, 1, `face ${face} 应该只有一个轴上在面上`)
    assert.strictEqual(vals.filter((v) => v === 8).length, 2, `face ${face} 应有两个 8`)
  }
})
