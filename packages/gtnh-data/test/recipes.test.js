'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { RecipeBook, loadRecipeBook, WILDCARD } = require('../src/recipes')

const book = () => RecipeBook.fromJSON({
  oredict: {
    ingotIron: [[265, 0], [11000, 32000]],
    plankWood: [[5, WILDCARD], [932, 0]]
  },
  crafting: [
    { w: 1, h: 1, in: [[7989, 72]], out: [5, 0], count: 2 },
    { w: 3, h: 3, in: new Array(9).fill(null), out: [5, WILDCARD], count: 4 },
    { w: 2, h: 2, in: [[1, 0], null, null, [1, 0]], out: [2, 0], count: 1 }
  ],
  smelting: { '15:0': [[265, 0], 1], '4:0': [[1, 0], 1] }
})

test('矿辞查询', () => {
  const rb = book()
  assert.deepStrictEqual(rb.ore('ingotIron'), [[265, 0], [11000, 32000]])
  assert.deepStrictEqual(rb.ore('nope'), [])
  assert.strictEqual(rb.hasOre('plankWood'), true)
  assert.strictEqual(rb.oreNameCount, 2)
  assert.deepStrictEqual(rb.oreNames().sort(), ['ingotIron', 'plankWood'])
})

test('矿辞通配 metadata', () => {
  const rb = book()
  const items = rb.ore('plankWood')
  assert.ok(items.some(([, m]) => m === WILDCARD))
})

test('矿辞反查支持通配', () => {
  const rb = book()
  assert.deepStrictEqual(rb.oresOf(5, 0), ['plankWood'])
  assert.deepStrictEqual(rb.oresOf(932, 0), ['plankWood'])
  assert.deepStrictEqual(rb.oresOf(932, 3), [])
  assert.deepStrictEqual(rb.oresOf(12345, 0), [])
})

test('matchesOre', () => {
  const rb = book()
  assert.strictEqual(rb.matchesOre('plankWood', 5, 7), true)
  assert.strictEqual(rb.matchesOre('plankWood', 932, 0), true)
  assert.strictEqual(rb.matchesOre('plankWood', 932, 4), false)
  assert.strictEqual(rb.matchesOre('ingotIron', 265, 0), true)
})

test('配方查询：精确与通配输出 metadata', () => {
  const rb = book()
  assert.strictEqual(rb.craftingFor(5, 0).length, 2)
  assert.strictEqual(rb.craftingFor(5, 9).length, 1)
  assert.strictEqual(rb.craftingFor(2, 0).length, 1)
  assert.strictEqual(rb.craftingFor(99, 0).length, 0)
})

test('熔炉查询', () => {
  const rb = book()
  assert.deepStrictEqual(rb.smeltFor(15, 0), { out: [265, 0], count: 1 })
  assert.deepStrictEqual(rb.smeltFor(4, 0), { out: [1, 0], count: 1 })
  assert.strictEqual(rb.smeltFor(99, 0), null)
})

test('ingredientAccepts', () => {
  const rb = book()
  assert.strictEqual(rb.ingredientAccepts([5, WILDCARD], 5, 3), true)
  assert.strictEqual(rb.ingredientAccepts([5, 0], 5, 3), false)
  assert.strictEqual(rb.ingredientAccepts(null, 5, 0), false)
})

test('仓库自带 GTNH 数据可加载', () => {
  const rb = loadRecipeBook()
  assert.ok(rb.craftingCount > 10000)
  assert.ok(rb.oreNameCount > 50000)
  assert.ok(rb.smeltingCount > 9000)
  assert.deepStrictEqual(rb.smeltFor(15, 0), { out: [265, 0], count: 1 })
})
