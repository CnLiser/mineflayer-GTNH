const test = require('node:test')
const assert = require('node:assert')
const path = require('path')

const { ModRecipes, loadModRecipes, MOD_RECIPES_FILE } = require('../index')

const book = loadModRecipes()

test('mod-recipes：总条数与各 mod 数量', () => {
  assert.strictEqual(book.total, 8206)
  const s = book.summary()
  assert.strictEqual(s.byMod.thaumcraft, 2180)
  assert.strictEqual(s.byMod.forestry, 1280)
  assert.ok(s.byMod.railcraft > 300)
  assert.ok(s.byMod.tconstruct > 2000)
  assert.ok(s.byMod.botania > 300)
  assert.ok(s.byMod.bloodmagic > 150)
  assert.strictEqual(s.byMod.ae2, 12)
  assert.strictEqual(s.byMod.enderio, 1689)
  assert.strictEqual(s.byMod.ic2, 3)
  assert.strictEqual(s.byMod.galacticraft, 14)
  assert.strictEqual(s.byMod.witchery, 85)
  assert.deepStrictEqual(book.mods(), ['ae2', 'bloodmagic', 'botania', 'enderio', 'forestry', 'galacticraft', 'ic2', 'railcraft', 'tconstruct', 'thaumcraft', 'witchery'])
})

test('mod-recipes：每条配方的形状合法（out 是数组、ins 是备选数组的数组）', () => {
  for (const r of book.recipes) {
    assert.ok(typeof r.mod === 'string' && typeof r.kind === 'string')
    assert.ok(Array.isArray(r.out) && Array.isArray(r.ins))
    for (const cell of r.ins) {
      assert.ok(Array.isArray(cell) && cell.length > 0, 'cell 必须是非空备选数组')
      for (const alt of cell) assert.ok(typeof alt.id === 'number' || typeof alt.ore === 'string')
    }
  }
})

test('mod-recipes：按产物查（铁锭/符文/熟肉干）', () => {
  const iron = book.byOutput(265)
  assert.ok(iron.length > 0)
  // Botania 的符文（id 6079）有 47 条
  assert.strictEqual(book.byOutput(6079).length, 47)
  // TConstruct 肉干
  const jerky = book.byOutput(4529)
  assert.ok(jerky.length >= 1)
  assert.strictEqual(jerky[0].kind, 'drying_rack')
  assert.strictEqual(jerky[0].time, 24000)
  // 指定 meta
  assert.ok(book.byOutput(6079, 0).length > 0)
})

test('mod-recipes：按原料查（铁锭作为输入）', () => {
  const asInput = book.byInput(265)
  assert.ok(asInput.length > 20, 'expect many, got ' + asInput.length)
  const exact = book.byInput(265, 0)
  assert.ok(exact.length >= 1)
})

test('mod-recipes：矿辞参与（Botania 花瓣用 flowerWhite）', () => {
  const petals = book.byKind('petal')
  assert.strictEqual(petals.length, 45)
  const flowers = book.byOre('flowerWhite')
  assert.ok(flowers.length > 0, 'flowerWhite 应被花瓣配方使用')
  assert.ok(flowers.some((r) => r.mod === 'botania'))
})

test('mod-recipes：TConstruct 熔炼与合金', () => {
  const melting = book.forKind('melting')
  assert.ok(melting.length > 900)
  const one = melting.find((r) => r.fluidOut.length > 0)
  assert.ok(one && one.fluidOut[0].amount > 0)
  const alloys = book.forKind('alloy')
  assert.strictEqual(alloys.length, 8)
  assert.ok(alloys.every((r) => r.fluidIn.length >= 2 && r.fluidOut.length === 1))
})

test('mod-recipes：Railcraft 焦炉/高炉/滚压机', () => {
  const coke = book.forKind('coke_oven')[0]
  assert.strictEqual(coke.ins[0][0].name, 'minecraft:coal')
  assert.ok(coke.fluidOut[0].fluid.length > 0)
  const rolling = book.forKind('rolling_shaped')[0]
  assert.ok(rolling.out[0].id > 0)
  assert.ok(rolling.ins.length >= 4)
})

test('mod-recipes：Blood Magic 试剂/祭坛/绑定', () => {
  const alchemy = book.forKind('alchemy')[0]
  assert.ok(alchemy.ins.length >= 1)
  assert.ok(typeof alchemy.extra.orbLevel === 'number')
  assert.ok(alchemy.extra.lp > 0)
  const altar = book.forKind('altar')
  assert.ok(altar.length === 64)
  assert.ok(altar.some((r) => r.extra.requiredItem && r.extra.requiredItem.id > 0))
  assert.strictEqual(book.forKind('binding').length, 19)
})

test('mod-recipes：EnderIO SAG 磨粉 / 合金炉 / 切刀 / 发酵桶', () => {
  const sag = book.forKind('sagmill')
  assert.strictEqual(sag.length, 1663)
  const quartz = sag.find((r) => r.ins[0] && r.ins[0][0] && r.ins[0][0].name === 'appliedenergistics2:tile.OreQuartz')
  assert.ok(quartz && quartz.out.length === 2)
  assert.ok(quartz.extra.energy > 0)
  assert.strictEqual(book.forKind('alloysmelter').length, 11)
  assert.strictEqual(book.forKind('sliceandsplice').length, 7)
  assert.strictEqual(book.forKind('vat').length, 8)
})

test('mod-recipes：AE2 压印器', () => {
  const insc = book.forKind('inscriber')
  assert.strictEqual(insc.length, 12)
  const press = insc.find((r) => r.extra.process === 'Press')
  assert.ok(press && press.out[0].name.startsWith('appliedenergistics2:'))
  assert.ok(press.extra.top || press.extra.bottom)
})

test('mod-recipes：IC2 机器表在 GTNH 里大多为空', () => {
  const kinds = book.kinds('ic2')
  assert.deepStrictEqual(kinds, ['machine_matterAmplifier', 'machine_metalformerCutting'])
  assert.strictEqual(book.forKind('machine_matterAmplifier').length, 2)
})

test('mod-recipes：Thaumcraft 研究字段仍在', () => {
  const infusion = book.forKind('infusion')
  assert.strictEqual(infusion.length, 652)
  assert.ok(infusion.some((r) => typeof r.extra.research === 'string'))
  assert.ok(infusion.every((r) => Array.isArray(r.out)))
})

test('mod-recipes：fromJSON 可独立构造（不读盘）', () => {
  const mini = ModRecipes.fromJSON({
    recipes: [{ mod: 'x', kind: 'k', out: [{ id: 1, name: 'a', meta: 0, count: 1 }], ins: [[{ id: 2, name: 'b', meta: 0, count: 1 }]], fluidIn: [], fluidOut: [], time: null, extra: {} }],
    countBy: { 'x:k': 1 }
  })
  assert.strictEqual(mini.total, 1)
  assert.strictEqual(mini.byOutput(1).length, 1)
  assert.strictEqual(mini.byInput(2).length, 1)
  assert.strictEqual(mini.byInput(2, 0).length, 1)
  assert.strictEqual(mini.summary().byMod.x, 1)
})

test('mod-recipes：文件存在且体积合理', () => {
  const fs = require('fs')
  assert.ok(fs.existsSync(MOD_RECIPES_FILE))
  const kb = fs.statSync(MOD_RECIPES_FILE).size / 1024
  assert.ok(kb > 500 && kb < 20000, 'size=' + kb)
  const again = loadModRecipes(path.join(path.dirname(MOD_RECIPES_FILE), 'mod-recipes.json'))
  assert.strictEqual(again.total, book.total)
})

test('mod-recipes：Galacticraft 电路制造机与压缩机', () => {
  assert.deepStrictEqual(book.kinds('galacticraft').sort(), ['circuit_fabricator', 'compressor', 'compressor_adventure'])
  assert.strictEqual(book.forKind('circuit_fabricator').length, 9)
  assert.strictEqual(book.forKind('compressor').length, 2)
  assert.strictEqual(book.forKind('compressor_adventure').length, 3)
  const circuit = book.forKind('circuit_fabricator')[0]
  assert.ok(circuit.out[0].name.startsWith('GalacticraftCore:'))
  assert.ok(circuit.ins.length >= 4, '晶体管配方应该有多格材料')
  assert.ok(circuit.ins.every((cell) => cell.length >= 1))
})

test('mod-recipes：Witchery 蒸馏/坩埚/纺车/火盆/酿造仪式', () => {
  assert.deepStrictEqual(book.kinds('witchery').sort(), ['brazier', 'brew_ritual', 'distillery', 'kettle', 'spinning'])
  assert.strictEqual(book.forKind('brazier').length, 8)
  assert.strictEqual(book.forKind('brew_ritual').length, 26)
  assert.strictEqual(book.forKind('distillery').length, 9)
  assert.strictEqual(book.forKind('kettle').length, 38)
  assert.strictEqual(book.forKind('spinning').length, 4)
  const kettle = book.forKind('kettle').find((r) => r.out[0] && r.out[0].meta === 57)
  assert.ok(kettle, '应该有一条产出 witchery:ingredient:57 的坩埚配方')
  assert.strictEqual(kettle.out[0].count, 3)
  assert.strictEqual(kettle.extra.inBook, true)
  assert.ok(kettle.ins.length >= 4)
  const brazier = book.forKind('brazier')[0]
  assert.strictEqual(brazier.out.length, 0)
  assert.ok(brazier.extra.effect.startsWith('witchery.brazier.'))
  assert.ok(brazier.extra.burnTicks > 0)
  const brew = book.forKind('brew_ritual')[0]
  assert.ok(brew.out[0] && brew.out[0].count >= 1)
  const spin = book.forKind('spinning')[0]
  assert.ok(spin.ins[0].length >= 1, JSON.stringify(spin.ins[0]))
  assert.ok(spin.out[0] && spin.out[0].id > 0)
})

test('mod-recipes：Thaumic Tinkerer 的配方已在 Thaumcraft 列表里', () => {
  const tc = book.forMod('thaumcraft')
  const hits = tc.filter((r) => (r.out || []).some((o) => o && /^ThaumicTinkerer:/.test(o.name || '')))
  assert.ok(hits.length > 50, 'hits=' + hits.length)
})

test('mod-recipes：TConstruct 浇筑（台 1088 / 盆 16，带金属流体）', () => {
  const book = loadModRecipes()
  assert.strictEqual(book.byKind('casting_table').length, 1088)
  assert.strictEqual(book.byKind('casting_basin').length, 16)
  const r = book.byOutput(4478, 1)[0]
  assert.ok(r.extra.fluid.fluid.startsWith('molten.'))
  assert.strictEqual(r.extra.fluid.amount > 0, true)
  assert.strictEqual(r.fluidIn[0].amount > 0, true)
  const withCast = book.byKind('casting_basin').filter(x => x.ins.length > 0)
  assert.ok(withCast.length > 0)
})

test('mod-recipes：TConstruct 工具组装（53 条，部件→工具）', () => {
  const book = loadModRecipes()
  const tb = book.byKind('tool_build')
  assert.strictEqual(tb.length, 53)
  const pick = tb.find((r) => r.out[0].id === 4482)
  assert.strictEqual(pick.extra.head[0], 'TConstruct:pickaxeHead')
  assert.strictEqual(pick.extra.handle ? pick.extra.handle[0] : null, 'TConstruct:toolRod')
  assert.ok(pick.ins.length >= 2)
  assert.ok(pick.ins.every((cell) => cell.every((st) => st.id > 0)))
})
