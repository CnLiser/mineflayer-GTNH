'use strict'
// GTNH 的矿辞 / 配方数据（来自服务端 agent 导出）挂到 bot 上。
// 数据本身在 gtnh-data 包里（data/recipes/*.json），这里只做格式转换与便捷 API。
const { loadRecipeBook, loadGtRecipes, loadModRecipes, WILDCARD } = require('gtnh-data')

const EMPTY = Object.freeze({ id: -1, count: 0, metadata: null })

/** GTNH 配方 -> mineflayer 认识的形状（inShape/result/delta/requiresTable） */
function toMineflayerRecipe (rec) {
  const width = rec.w
  const height = rec.h
  const size = 3
  const inShape = []
  for (let y = 0; y < size; y++) {
    const row = []
    for (let x = 0; x < size; x++) {
      const cell = y < height && x < width ? rec.in[y * width + x] : null
      row.push(cell ? { id: cell[0], metadata: cell[1], count: 1 } : EMPTY)
    }
    inShape.push(row)
  }
  const counted = new Map()
  for (const cell of rec.in) {
    if (!cell) continue
    const key = `${cell[0]}:${cell[1]}`
    const entry = counted.get(key)
    if (entry) entry.count++
    else counted.set(key, { id: cell[0], metadata: cell[1], count: 1 })
  }
  return {
    result: { id: rec.out[0], metadata: rec.out[1], count: rec.count },
    inShape,
    delta: [...counted.values()],
    requiresTable: width > 2 || height > 2,
    gtnh: true
  }
}

function attachRecipes (bot) {
  const book = loadRecipeBook()
  bot.gtnhRecipes = book
  /** 矿辞名 -> 物品列表（metadata 可能是 32767 = 通配） */
  bot.oreItems = (name) => book.ore(name).map(([id, metadata]) => ({ id, metadata, count: 1 }))
  /** 物品属于哪些矿辞 */
  bot.oresOf = (id, metadata) => book.oresOf(id, metadata)
  /** 产出该物品的合成台配方（mineflayer 形状） */
  bot.gtnhRecipesFor = (id, metadata) => book.craftingFor(id, metadata).map(toMineflayerRecipe)
  /** 熔炉产物 */
  bot.gtnhSmeltingFor = (id, metadata) => book.smeltFor(id, metadata)
  bot.gtnhSmeltSource = (id, metadata) => book.smeltFrom(id, metadata)
  bot.gtnhSmeltSources = (id, metadata) => book.smeltFromAll(id, metadata)
  // GT 机器/工具配方（RecipeMap，~175k 条）：第一次访问才解析，约 0.5 秒
  let gt = null
  const gtBook = () => (gt || (gt = loadGtRecipes()))
  bot.gtRecipeMaps = () => gtBook().mapNames()
  bot.gtRecipesForOutput = (id, metadata) => gtBook().forOutput(id, metadata)
  bot.gtRecipesForInput = (id, metadata) => gtBook().forInput(id, metadata)
  bot.gtRecipesForFluid = (name) => gtBook().forFluid(name)
  // 非 GT 的 mod 配方（Thaumcraft/Forestry/Railcraft/TConstruct/Botania/BloodMagic），第一次访问才解析
  let mods = null
  const modBook = () => (mods || (mods = loadModRecipes()))
  bot.modRecipeBook = () => modBook()
  /** 产出该物品的各 mod 配方 */
  bot.modRecipesFor = (id, metadata) => modBook().byOutput(id, metadata)
  /** 消耗该物品的各 mod 配方 */
  bot.modRecipesUsing = (id, metadata) => modBook().byInput(id, metadata)
  /** 某个矿辞名参与的配方 */
  bot.modRecipesByOre = (ore) => modBook().byOre(ore)
  /** 某个物种（蜜蜂/花突变）参与的配方：产物或亲本命中都算 */
  bot.modRecipesForSpecies = (name) => modBook().forSpecies(name)
  /** 数据里出现过的物种名（产物侧） */
  bot.modRecipeSpecies = () => modBook().species()
  bot.modRecipeKinds = (mod) => modBook().kinds(mod)
  bot.modRecipeMods = () => modBook().mods()
  bot.modRecipeSummary = () => modBook().summary()
}

module.exports = { attachRecipes, toMineflayerRecipe, WILDCARD }
