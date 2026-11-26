'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { toMineflayerRecipe, WILDCARD } = require('../lib/gtnh/recipes')

test('配方转换成 mineflayer 形状（3x3 上取整 + 空位 -1）', () => {
  const rec = toMineflayerRecipe({
    w: 2,
    h: 2,
    in: [[1, 0], [1, 0], [1, 0], [1, 0]],
    out: [2, 0],
    count: 1
  })
  assert.deepStrictEqual(rec.result, { id: 2, metadata: 0, count: 1 })
  assert.strictEqual(rec.requiresTable, false)
  assert.strictEqual(rec.inShape.length, 3)
  assert.strictEqual(rec.inShape[0].length, 3)
  assert.deepStrictEqual(rec.inShape[0][0], { id: 1, metadata: 0, count: 1 })
  assert.strictEqual(rec.inShape[0][2].id, -1)
  assert.strictEqual(rec.inShape[2][0].id, -1)
  assert.deepStrictEqual(rec.delta, [{ id: 1, metadata: 0, count: 4 }])
})

test('3x3 配方 requiresTable，空位保持 -1', () => {
  const rec = toMineflayerRecipe({
    w: 3,
    h: 3,
    in: [null, [5, WILDCARD], null, null, [5, WILDCARD], null, null, null, null],
    out: [53, 0],
    count: 4
  })
  assert.strictEqual(rec.requiresTable, true)
  assert.strictEqual(rec.inShape[0][0].id, -1)
  assert.deepStrictEqual(rec.inShape[0][1], { id: 5, metadata: WILDCARD, count: 1 })
  assert.deepStrictEqual(rec.delta, [{ id: 5, metadata: WILDCARD, count: 2 }])
})

test('1x1 配方', () => {
  const rec = toMineflayerRecipe({ w: 1, h: 1, in: [[7989, 72]], out: [5, 0], count: 2 })
  assert.strictEqual(rec.requiresTable, false)
  assert.deepStrictEqual(rec.result, { id: 5, metadata: 0, count: 2 })
  assert.deepStrictEqual(rec.delta, [{ id: 7989, metadata: 72, count: 1 }])
})

test('attachRecipes 把查询 API 挂到 bot 上', () => {
  const { attachRecipes } = require('../lib/gtnh/recipes')
  const bot = {}
  attachRecipes(bot)
  assert.ok(bot.gtnhRecipes)
  const iron = bot.oreItems('ingotIron')
  assert.ok(iron.length > 0)
  assert.ok(bot.oresOf(5, 0).includes('plankWood'))
  assert.ok(bot.gtnhRecipesFor(5, 0).length > 0)
  assert.strictEqual(bot.gtnhSmeltingFor(15, 0).out[0], 265)
})

test('attachRecipes 暴露 GT RecipeMap 查询', () => {
  const { attachRecipes } = require('../lib/gtnh/recipes')
  const bot = {}
  attachRecipes(bot)
  const maps = bot.gtRecipeMaps()
  assert.ok(maps.includes('gt.recipe.macerator'))
  assert.ok(bot.gtRecipesForOutput(3003, 1).length >= 1)
  assert.ok(bot.gtRecipesForFluid('water').length > 100)
})
