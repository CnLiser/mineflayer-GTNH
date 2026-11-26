'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { GtRecipes, loadGtRecipes, WILDCARD } = require('../src/gt-recipes')

const fixture = [
  { map: 'gt.recipe.macerator', eu: 4, dur: 16, in: [{ id: 15, meta: 0, count: 1 }], out: [{ id: 11000, meta: 6, count: 2 }], fin: [], fout: [] },
  { map: 'gt.recipe.macerator', eu: 4, dur: 20, in: [{ id: 4, meta: 0, count: 1 }], out: [{ id: 12, meta: 0, count: 1 }], fin: [], fout: [] },
  { map: 'gt.recipe.assembler', eu: 120, dur: 3200, in: [{ id: 1, meta: WILDCARD, count: 2 }], out: [null, { id: 3003, meta: 1, count: 1 }], fin: [{ fluid: 'water', amount: 1000 }], fout: [] }
]

test('统计与 map 列表', () => {
  const g = GtRecipes.fromJSON(fixture)
  assert.deepStrictEqual(g.summary(), { maps: 2, recipes: 3 })
  assert.deepStrictEqual(g.mapNames(), ['gt.recipe.assembler', 'gt.recipe.macerator'])
  assert.strictEqual(g.countFor('gt.recipe.macerator'), 2)
  assert.strictEqual(g.countFor('nope'), 0)
  assert.strictEqual(g.forMap('gt.recipe.macerator').length, 2)
})

test('按产出查（跳过空位）', () => {
  const g = GtRecipes.fromJSON(fixture)
  assert.strictEqual(g.forOutput(11000, 6).length, 1)
  assert.strictEqual(g.forOutput(11000, 7).length, 0)
  assert.strictEqual(g.forOutput(3003, 1).length, 1)
  assert.strictEqual(g.forOutput(99999, 0).length, 0)
})

test('按原料查，支持通配 metadata', () => {
  const g = GtRecipes.fromJSON(fixture)
  assert.strictEqual(g.forInput(4, 0).length, 1)
  assert.strictEqual(g.forInput(1, 5).length, 1)
  assert.strictEqual(g.forInput(3, 0).length, 0)
})

test('按流体查', () => {
  const g = GtRecipes.fromJSON(fixture)
  assert.strictEqual(g.forFluid('water').length, 1)
  assert.strictEqual(g.forFluid('lava').length, 0)
})

test('仓库自带的 GT 配方数据可加载', () => {
  const g = loadGtRecipes()
  const s = g.summary()
  assert.ok(s.maps > 100)
  assert.ok(s.recipes > 150000)
  assert.ok(g.countFor('gt.recipe.macerator') > 20000)
  assert.ok(g.forFluid('water').length > 1000)
})
