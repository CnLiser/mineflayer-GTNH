const test = require('node:test')
const assert = require('node:assert')

const { attachRecipes } = require('../lib/gtnh/recipes')

function makeBot () { return {} }

test('mod 配方：挂载后在 bot 上可查询', () => {
  const bot = makeBot()
  attachRecipes(bot)
  const summary = bot.modRecipeSummary()
  assert.ok(summary.total > 5000)
  assert.deepStrictEqual(bot.modRecipeMods(), ['ae2', 'avaritia', 'bloodmagic', 'botania', 'enderio', 'etfuturum', 'forestry', 'galacticraft', 'harvestcraft', 'ic2', 'railcraft', 'tconstruct', 'thaumcraft', 'witchery', 'witchinggadgets'])
  assert.ok(bot.modRecipeKinds('botania').includes('rune_altar'))
})

test('mod 配方：按产物查（Botania 符文 / TConstruct 肉干）', () => {
  const bot = makeBot()
  attachRecipes(bot)
  const runes = bot.modRecipesFor(6079)
  assert.strictEqual(runes.length, 47)
  assert.ok(runes.every((r) => r.kind === 'rune_altar'))
  // 每条都带 mana 消耗
  assert.ok(runes.every((r) => typeof r.extra.mana === 'number'))

  const jerky = bot.modRecipesFor(4529)
  assert.ok(jerky.length >= 1)
  const one = jerky[0]
  assert.strictEqual(one.mod, 'tconstruct')
  assert.strictEqual(one.kind, 'drying_rack')
  assert.strictEqual(one.time, 24000)
  assert.strictEqual(one.ins[0][0].name, 'minecraft:beef')
})

test('mod 配方：按原料 / 矿辞查', () => {
  const bot = makeBot()
  attachRecipes(bot)
  const usingIron = bot.modRecipesUsing(265)
  assert.ok(usingIron.length > 20)
  const flowers = bot.modRecipesByOre('flowerWhite')
  assert.ok(flowers.length > 0)
})

test('mod 配方：第一次访问才解析（懒加载）', () => {
  const bot = makeBot()
  attachRecipes(bot)
  assert.strictEqual(bot.modRecipeSummary().total, bot.modRecipeBook().total)
  // 两次访问返回同一实例（单例）
  assert.strictEqual(bot.modRecipeBook(), bot.modRecipeBook())
})

test('mod 配方：新一批 mod（Avaritia / HarvestCraft / WitchingGadgets / Et Futurum）', () => {
  const bot = makeBot()
  attachRecipes(bot)
  const book = bot.modRecipeBook()
  assert.deepStrictEqual(bot.modRecipeKinds('avaritia'), ['extreme_crafting'])
  assert.strictEqual(book.forKind('extreme_crafting').length, 135)
  assert.ok(book.forKind('extreme_crafting').some((r) => r.ins.length === 81))
  assert.strictEqual(book.forKind('cutting_board').length, 51)
  assert.strictEqual(book.forKind('cooking_pot').length, 63)
  const trap = book.forKind('animal_trap')[0]
  assert.ok(trap.extra.weights.some((w) => w > 0))
  assert.strictEqual(book.forKind('infernal_blast_furnace').length, 51)
  assert.strictEqual(book.forKind('spinning_wheel').length, 5)
  assert.strictEqual(book.forKind('smithing_table').length, 9)
})

test('mod 配方：不污染 mineflayer 自己的 recipesFor 语义', () => {
  const bot = makeBot()
  attachRecipes(bot)
  assert.strictEqual(typeof bot.gtnhRecipesFor, 'function')
  assert.strictEqual(typeof bot.modRecipesFor, 'function')
  // mod 配方和原版合成配方是两套数据
  const vanilla = bot.gtnhRecipesFor(5, 0) // 木板
  assert.ok(Array.isArray(vanilla))
})
