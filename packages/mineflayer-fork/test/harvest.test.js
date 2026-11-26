const { test } = require('node:test')
const assert = require('node:assert')
const { toolNeeded, toolKindOf, findTools, equipToolFor, toolRank, sameItem } = require('../lib/gtnh/harvest')

const fakeBot = (items) => ({
  inventory: { items: () => items },
  heldItem: null,
  equip: async () => {}
})

test('机器方块要扳手，矿石要镐，火把这类不要工具', () => {
  assert.equal(toolNeeded({ name: 'gregtech:gt.blockmachines', metadata: 1 }).tool, 'wrench')
  assert.equal(toolNeeded({ name: 'minecraft:iron_ore', metadata: 0 }).tool, 'pickaxe')
  assert.equal(toolNeeded({ name: 'gregtech:gt.blockores', metadata: 0 }).tool, 'pickaxe')
  assert.equal(toolNeeded({ name: 'minecraft:torch' }), null)
})

test('被 GT 禁掉的原版镐不参与挑选，只有木镐和匠魂镐能用', () => {
  const banned = fakeBot([
    { name: 'minecraft:stone_pickaxe' },
    { name: 'minecraft:diamond_pickaxe' },
    { name: 'minecraft:iron_pickaxe' },
    { name: 'minecraft:golden_pickaxe' }
  ])
  assert.deepEqual(findTools(banned, 'pickaxe'), [])

  const usable = fakeBot([
    { name: 'minecraft:wooden_pickaxe' },
    { name: 'TConstruct:pickaxe' },
    { name: 'TConstruct:hammer' }
  ])
  const names = findTools(usable, 'pickaxe').map((i) => i.name)
  assert.equal(names.length, 3)
  assert.ok(names.includes('minecraft:wooden_pickaxe'))
  assert.ok(names.includes('TConstruct:pickaxe'))
})

test('pickaxe 不会被当成 axe', () => {
  const bot = fakeBot([{ name: 'minecraft:diamond_pickaxe' }, { name: 'minecraft:iron_axe' }])
  assert.deepEqual(findTools(bot, 'axe').map((i) => i.name), ['minecraft:iron_axe'])
})

test('没有扳手时挖机器返回失败和原因', async () => {
  const bot = fakeBot([{ name: 'minecraft:diamond_pickaxe' }])
  const r = await equipToolFor(bot, { name: 'gregtech:gt.blockmachines', metadata: 1 })
  assert.equal(r.ok, false)
  assert.match(r.reason, /wrench/)
})

test('背包里只有被禁的镐时，失败原因里点名', async () => {
  const bot = fakeBot([{ name: 'minecraft:diamond_pickaxe' }])
  const r = await equipToolFor(bot, { name: 'minecraft:stone', metadata: 0 })
  assert.equal(r.ok, false)
  assert.match(r.reason, /diamond_pickaxe/)
  assert.match(r.reason, /被 GT 禁了/)
})

test('不需要工具时直接放行', async () => {
  const bot = fakeBot([])
  const r = await equipToolFor(bot, { name: 'minecraft:torch' })
  assert.deepEqual(r, { ok: true, tool: null, need: null })
})

test('GT 工具靠 damage 认，不靠名字（全都叫 gt.metatool.01）', () => {
  const w = { name: 'gregtech:gt.metatool.01', metadata: 16 }
  const c = { name: 'gregtech:gt.metatool.01', metadata: 26 }
  const h = { name: 'gregtech:gt.metatool.01', metadata: 12 }
  assert.equal(toolKindOf(w), 'wrench')
  assert.equal(toolKindOf(c), 'cutter')
  assert.equal(toolKindOf(h), 'hammer')
  assert.equal(toolKindOf({ name: 'gregtech:gt.metatool.01', metadata: 999 }), null)
})

test('GT 的锤可以当镐用（挖石/挖矿）', () => {
  const bot = fakeBot([{ name: 'gregtech:gt.metatool.01', metadata: 12 }])
  assert.equal(findTools(bot, 'pickaxe').length, 1)
  const bot2 = fakeBot([{ name: 'gregtech:gt.metatool.01', metadata: 16 }])
  assert.equal(findTools(bot2, 'pickaxe').length, 0)
})

test('同名不同 damage 的 GT 工具不是同一件', () => {
  const wrench = { name: 'gregtech:gt.metatool.01', metadata: 16 }
  const hammer = { name: 'gregtech:gt.metatool.01', metadata: 12 }
  assert.equal(sameItem(wrench, wrench), true)
  assert.equal(sameItem(wrench, hammer), false)
})
