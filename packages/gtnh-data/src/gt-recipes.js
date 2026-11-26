'use strict'
// GT 机器/工具配方（RecipeMap）查询。
// 数据来自服务端 agent 遍历 RecipeMap.ALL_RECIPE_MAPS -> getAllRecipes()（见 tools/jmx/src/DumpGt.java）。
// GTNH 里 NEI 显示的 GT 机器配方，本质上就是这些 RecipeMap 的渲染结果。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const DATA_FILE = path.join(__dirname, '..', 'data', 'gt', 'gt-recipes.jsonl.gz')
const WILDCARD = 32767

const sameMeta = (a, b) => a === b || a === WILDCARD || b === WILDCARD

class GtRecipes {
  constructor ({ recipes = [], maps = new Map() } = {}) {
    this.recipes = recipes
    this.maps = maps
    this._byOutput = null
  }

  /** 读仓库自带的 gz 数据（约 175k 条，首次调用 1 秒左右） */
  static fromFile (file = DATA_FILE) {
    const text = zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')
    const recipes = []
    const maps = new Map()
    for (const line of text.split('\n')) {
      if (!line) continue
      const rec = JSON.parse(line)
      recipes.push(rec)
      maps.set(rec.map, (maps.get(rec.map) || 0) + 1)
    }
    return new GtRecipes({ recipes, maps })
  }

  static fromJSON (recipes) {
    const maps = new Map()
    for (const rec of recipes) maps.set(rec.map, (maps.get(rec.map) || 0) + 1)
    return new GtRecipes({ recipes, maps })
  }

  get count () { return this.recipes.length }
  mapNames () { return [...this.maps.keys()].sort() }
  countFor (map) { return this.maps.get(map) || 0 }

  /** 某台机器（unlocalized name，如 gt.recipe.macerator）的全部配方 */
  forMap (map) { return this.recipes.filter((r) => r.map === map) }

  /** 产出某物品的配方（GT 配方可以一次产出多个物品，任一命中就算） */
  forOutput (blockId, metadata) {
    if (!this._byOutput) {
      const idx = new Map()
      for (const rec of this.recipes) {
        for (const out of rec.out) {
          if (!out) continue
          let list = idx.get(out.id)
          if (!list) idx.set(out.id, (list = []))
          list.push(rec)
        }
      }
      this._byOutput = idx
    }
    const list = this._byOutput.get(blockId) || []
    return list.filter((r) => r.out.some((o) => o && o.id === blockId && sameMeta(o.meta, metadata)))
  }

  /** 以某物品为原料的配方 */
  forInput (blockId, metadata) {
    return this.recipes.filter((r) => r.in.some((i) => i && i.id === blockId && sameMeta(i.meta, metadata)))
  }

  /** 用某流体的配方 */
  forFluid (fluidName) {
    return this.recipes.filter((r) => r.fin.some((f) => f && f.fluid === fluidName))
  }

  summary () { return { maps: this.maps.size, recipes: this.count } }
}

let cached = null
/** 单例（数据可能几十 MB，别重复解析） */
function loadGtRecipes (file) {
  if (!cached) cached = GtRecipes.fromFile(file)
  return cached
}

module.exports = { GtRecipes, loadGtRecipes, DATA_FILE, WILDCARD }
