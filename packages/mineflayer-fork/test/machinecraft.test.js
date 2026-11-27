const { test } = require('node:test')
const assert = require('node:assert')
const { machineCraft, parsePanel, mapForMachine, MACHINE_SLOTS } = require('../lib/gtnh/machinecraft')

test('parsePanel 认 GT 的机器面板名', () => {
  assert.deepStrictEqual(parsePanel('basicmachine.alloysmelter.tier.02'), { name: 'alloysmelter', tier: 2, tierName: 'MV' })
  assert.deepStrictEqual(parsePanel('basicmachine.macerator.tier.01'), { name: 'macerator', tier: 1, tierName: 'LV' })
  assert.strictEqual(parsePanel('some.other.panel'), null)
  assert.strictEqual(parsePanel(null), null)
})

test('mapForMachine 别名表兜住不一样的配方表名', () => {
  assert.strictEqual(mapForMachine('alloysmelter'), 'gt.recipe.alloysmelter')
  assert.strictEqual(mapForMachine('formingpress'), 'gt.recipe.forming')
  assert.strictEqual(mapForMachine('unknownmachine'), 'gt.recipe.unknownmachine')
})

test('槽位常量与 GT BasicMachine 一致', () => {
  // MTEBasicMachine：0 存储 / 1..2 充放电 / 3 特殊槽 / getInputSlot()=5 / 输出 5+n
  assert.deepStrictEqual(MACHINE_SLOTS, { power: 1, input: 2, special: 3, out: 4, inputs: [2] })
})

test('dryRun 只规划，不开机器', async () => {
  let opened = 0
  const block = { name: 'gregtech:gt.blockmachines', position: { x: 0, y: 0, z: 0 } }
  const bot = {
    entity: { position: { offset: (dx, dy, dz) => ({ x: dx, y: dy, z: dz }) } },
    blockAt: () => block,
    gtRecipesForOutput: () => [
      { map: 'gt.recipe.alloysmelter', eu: 60, dur: 200, in: [{ id: 'copper', name: 'copper', count: 3 }, { name: 'tin', count: 1 }], out: [{ name: 'bronze', count: 4 }] }
    ],
    openBlock: async () => { opened++; return {} },
    modularPanels: () => ['basicmachine.alloysmelter.tier.02'],
    panelState: () => ({}),
    closeWindow: async () => {}
  }
  const r = await machineCraft(bot, { item: 'bronze', dryRun: true, radius: 1 })
  assert.strictEqual(r.ok, true)
  assert.strictEqual(r.dryRun, true)
  assert.strictEqual(r.machine, 'alloysmelter')
  assert.strictEqual(r.tier, 'MV')
  assert.strictEqual(r.map, 'gt.recipe.alloysmelter')
  assert.strictEqual(r.recipe.in.length, 2)
  assert.strictEqual(opened, 1)
})

test('电压不够会报清楚', async () => {
  const block = { name: 'gregtech:gt.blockmachines' }
  const bot = {
    entity: { position: { offset: (dx, dy, dz) => ({ x: dx, y: dy, z: dz }) } },
    blockAt: () => block,
    gtRecipesForOutput: () => [{ map: 'gt.recipe.alloysmelter', eu: 8000, dur: 100, in: [], out: [] }],
    openBlock: async () => ({}),
    modularPanels: () => ['basicmachine.alloysmelter.tier.01'],  // LV，跑不动 8000 EU/t
    panelState: () => ({}),
    closeWindow: async () => {}
  }
  const r = await machineCraft(bot, { item: 'x', dryRun: true, radius: 1 })
  assert.strictEqual(r.ok, false)
  assert.match(r.tried[0].reason, /需要 .*机器只有 LV/)
})

test('配方表里没有产物时直接说清', async () => {
  const bot = { gtRecipesForOutput: () => [] }
  const r = await machineCraft(bot, { item: 'bronze' })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /配方表里没有 bronze/)
})

test('附近没有机器', async () => {
  const bot = {
    entity: { position: { offset: (dx, dy, dz) => ({ x: dx, y: dy, z: dz }) } },
    blockAt: () => null,
    gtRecipesForOutput: () => [{ map: 'gt.recipe.alloysmelter', in: [] }]
  }
  const r = await machineCraft(bot, { item: 'bronze', radius: 1 })
  assert.strictEqual(r.ok, false)
  assert.match(r.reason, /附近没有 GT 机器/)
})

test('机器周围有没有电：有电线算有电，全空气就没有', () => {
    const { powerSourcesNear } = require('../lib/gtnh/machinecraft')
    const mk = (name) => ({ blockAt: () => ({ name }) })
    const block = { position: { offset: (dx, dy, dz) => ({ dx, dy, dz }) } }
    assert.deepStrictEqual(powerSourcesNear(mk('minecraft:air'), block), [])
    const withCable = { blockAt: (p) => p.dx === 1 && p.dy === 0 && p.dz === 0 ? { name: 'gregtech:gt.blockmachines' } : { name: 'minecraft:air' } }
    // 方块名不含 cable 关键字时不算供电
    assert.deepStrictEqual(powerSourcesNear(withCable, block), [])
    const withWire = { blockAt: (p) => p.dx === 0 && p.dy === 1 && p.dz === 0 ? { name: 'gregtech:gt.blockcable' } : { name: 'minecraft:air' } }
    assert.deepStrictEqual(powerSourcesNear(withWire, block), ['gregtech:gt.blockcable'])
})
