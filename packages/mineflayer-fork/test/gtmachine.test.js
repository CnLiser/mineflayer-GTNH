const test = require('node:test')
const assert = require('node:assert')
const { VOLTAGES, TIER_NAMES, recipeTier, canRun, machineInfo, findExtruderRecipes, gtnWindowSlots, readMachineSlots } = require('../lib/gtnh/gtmachine')

test('电压表与档位', () => {
  assert.deepStrictEqual(VOLTAGES.slice(0, 5), [8, 32, 128, 512, 2048])
  assert.strictEqual(TIER_NAMES[1], 'LV')
  assert.strictEqual(recipeTier(8), 0)
  assert.strictEqual(recipeTier(30), 1)
  assert.strictEqual(recipeTier(32), 1)
  assert.strictEqual(recipeTier(33), 2)
})

test('canRun：机器档位必须 >= 配方档位', () => {
  const r = { eu: 30 }
  assert.strictEqual(canRun(r, 'LV').ok, true)
  assert.strictEqual(canRun(r, 'MV').ok, true)
  const bad = canRun(r, 'ULV')
  assert.strictEqual(bad.ok, false)
  assert.match(bad.reason, /LV/)
  assert.strictEqual(canRun({ eu: 128 }, 'LV').ok, false)
  assert.strictEqual(canRun({ eu: 128 }, 'MV').ok, true)
  assert.strictEqual(canRun({ eu: 2048 }, 'EV').ok, true)
})

test('机器 meta 映射', () => {
  assert.strictEqual(machineInfo(281).tier, 'LV')
  assert.strictEqual(machineInfo(285).tier, 'IV')
  assert.strictEqual(machineInfo(281).slots.out, 4)
  assert.strictEqual(machineInfo(999), null)
})

test('findExtruderRecipes 按产物/输入/形状过滤', () => {
  const fake = { forMap: () => ([
    { eu: 30, dur: 256, in: [{ id: 7639, meta: 11019 }, { id: 4526, meta: 2 }], out: [{ id: 7991, meta: 1500 }] },
    { eu: 30, dur: 256, in: [{ id: 7639, meta: 11019 }, { id: 4526, meta: 4 }], out: [{ id: 7992, meta: 1500 }] },
    { eu: 480, dur: 100, in: [{ id: 1, meta: 0 }, { id: 4526, meta: 2 }], out: [{ id: 9, meta: 0 }] }
  ]) }
  assert.strictEqual(findExtruderRecipes(fake, { output: { id: 7991 } }).length, 1)
  assert.strictEqual(findExtruderRecipes(fake, { shape: 2 }).length, 2)
  assert.strictEqual(findExtruderRecipes(fake, { input: { id: 1, meta: 0 }, shape: 2 }).length, 1)
  assert.strictEqual(findExtruderRecipes(fake, {}).length, 3)
})

test('GT 窗口槽映射（快捷栏在机器槽之后）', () => {
  const w = { inventoryStart: 5 }
  const s = gtnWindowSlots(w)
  assert.strictEqual(s.forInv(36), 5)
  assert.strictEqual(s.forInv(38), 7)
  assert.strictEqual(s.forInv(9), 14)
  const fake = { slots: ['a', 'b', 'c', 'd', 'e'] }
  const r = readMachineSlots(fake, machineInfo(281))
  assert.deepStrictEqual(r, { input1: 'a', shape1: 'b', input2: 'c', shape2: 'd', output: 'e' })
})
