'use strict'
// GTNH 的矿辞（OreDictionary）与配方（合成台 / 熔炉）查询。
// 数据由 packages/gtnh-data/tools/jmx（Java agent）从真实服务端导出，
// 用 tools/build-recipes.js 转成 data/recipes/*.json。
const fs = require('fs')
const path = require('path')

/** OreDictionary.WILDCARD_VALUE：表示「任何 metadata」 */
const WILDCARD = 32767
const DATA_DIR = path.join(__dirname, '..', 'data', 'recipes')

const sameMeta = (a, b) => a === b || a === WILDCARD || b === WILDCARD

class RecipeBook {
  constructor ({ oredict = {}, crafting = [], smelting = {} } = {}) {
    this.oredict = oredict
    this.crafting = crafting
    this.smelting = smelting
    this._byOutput = null
    this._oreNamesByItem = null
  }

  static fromJSON (json) {
    return new RecipeBook(json)
  }

  static fromDir (dir = DATA_DIR) {
    const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
    return new RecipeBook({
      oredict: read('oredict.json'),
      crafting: read('crafting.json'),
      smelting: read('smelting.json')
    })
  }

  get oreNameCount () { return Object.keys(this.oredict).length }
  get craftingCount () { return this.crafting.length }
  get smeltingCount () { return Object.keys(this.smelting).length }

  oreNames () { return Object.keys(this.oredict) }

  hasOre (name) { return Object.prototype.hasOwnProperty.call(this.oredict, name) }

  /** 矿辞名 -> [[blockId, metadata], ...]；未知名字返回 [] */
  ore (name) {
    return this.oredict[name] || []
  }

  /** 某个物品属于哪些矿辞（反查，惰性建索引） */
  oresOf (blockId, metadata) {
    if (!this._oreNamesByItem) {
      const idx = new Map()
      for (const [name, items] of Object.entries(this.oredict)) {
        for (const [id, meta] of items) {
          const k = `${id}:${meta}`
          let list = idx.get(k)
          if (!list) idx.set(k, (list = []))
          list.push(name)
        }
      }
      this._oreNamesByItem = idx
    }
    const exact = this._oreNamesByItem.get(`${blockId}:${metadata}`)
    if (exact) return exact
    return this._oreNamesByItem.get(`${blockId}:${WILDCARD}`) || []
  }

  /** 该物品能不能当某个矿辞的原料（metadata 支持通配） */
  matchesOre (name, blockId, metadata) {
    return this.ore(name).some(([id, meta]) => id === blockId && sameMeta(meta, metadata))
  }

  /** 产出某物品的所有合成台配方（输出 metadata 支持通配） */
  craftingFor (blockId, metadata) {
    if (!this._byOutput) {
      const idx = new Map()
      for (const recipe of this.crafting) {
        const k = recipe.out[0] // 按 id 建索引，meta 在查询时再过滤
        let list = idx.get(k)
        if (!list) idx.set(k, (list = []))
        list.push(recipe)
      }
      this._byOutput = idx
    }
    const list = this._byOutput.get(blockId) || []
    return list.filter((r) => sameMeta(r.out[1], metadata))
  }

  /** 熔炉：原料 -> { out: [id, meta], count }; 支持通配 metadata */
  smeltFor (blockId, metadata) {
    const exact = this.smelting[`${blockId}:${metadata}`]
    if (exact) return { out: exact[0], count: exact[1] }
    for (const [k, v] of Object.entries(this.smelting)) {
      const [id, meta] = k.split(':').map(Number)
      if (id === blockId && meta === WILDCARD) return { out: v[0], count: v[1] }
    }
    return null
  }

  /** 配方原料是否接受该物品；原料为空位（null）永远不接受 */
  ingredientAccepts (ingredient, blockId, metadata) {
    if (!ingredient) return false
    return ingredient[0] === blockId && sameMeta(ingredient[1], metadata)
  }

  summary () {
    return { oreNames: this.oreNameCount, crafting: this.craftingCount, smelting: this.smeltingCount }
  }
}

let cached = null
/** 读仓库里自带的 GTNH 2.9.0 服数据（单例） */
function loadRecipeBook (dir = DATA_DIR) {
  if (!cached) cached = RecipeBook.fromDir(dir)
  return cached
}

module.exports = { RecipeBook, loadRecipeBook, WILDCARD, DATA_DIR }
