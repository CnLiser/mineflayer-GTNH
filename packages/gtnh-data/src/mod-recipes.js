const fs = require('fs')
const path = require('path')

const RECIPES_DIR = path.resolve(__dirname, '../data/recipes')
const MOD_RECIPES_FILE = path.join(RECIPES_DIR, 'mod-recipes.json')

/**
 * 非 GT 的 mod 配方（NEI 里那些各自 mod 的页面），由 Java agent 从服务端内存导出。
 *
 * 每条配方的形状（已归一化，见 tools/build-mod-recipes.js）：
 *   {
 *     mod: 'botania', kind: 'rune_altar',
 *     out: [{ id, name, meta, count }],          // 一个配方可能产出多个
 *     ins: [ [备选...], [备选...] ],              // 每种材料一格；备选 = {id,name,meta,count} 或 {ore:'ingotIron'}
 *     fluidIn: [{ fluid, amount }], fluidOut: [...],
 *     time: null | number,
 *     extra: { ... }                              // mana / tier / lp / temperature / research 之类
 *   }
 */
class ModRecipes {
  constructor (payload) {
    this.recipes = payload.recipes || []
    this.countBy = payload.countBy || {}
    this.total = this.recipes.length
    this._byInput = null
    this._byOre = null
  }

  static fromJSON (obj) {
    return new ModRecipes(obj)
  }

  /** 产出某物品的配方（meta 省略时匹配任意 meta）。 */
  byOutput (id, meta) {
    const want = meta == null ? null : meta
    const out = []
    for (const r of this.recipes) {
      for (const o of r.out) {
        if (o.id !== id) continue
        if (want != null && o.meta !== want && o.meta !== 32767) continue
        out.push(r)
        break
      }
    }
    return out
  }

  _buildInputIndex () {
    const byInput = new Map()
    const byOre = new Map()
    const push = (map, key, r) => {
      const arr = map.get(key)
      if (arr) arr.push(r)
      else map.set(key, [r])
    }
    for (const r of this.recipes) {
      for (const cell of r.ins) {
        for (const alt of cell) {
          if (alt.ore) push(byOre, alt.ore, r)
          else if (typeof alt.id === 'number') push(byInput, alt.id + ':' + (alt.meta || 0), r)
        }
      }
    }
    this._byInput = byInput
    this._byOre = byOre
  }

  /** 消耗某物品作为原料的配方（meta 省略时不区分 meta）。 */
  byInput (id, meta) {
    if (!this._byInput) this._buildInputIndex()
    if (meta != null) return (this._byInput.get(id + ':' + meta) || []).slice()
    const out = []
    for (const [key, arr] of this._byInput) {
      if (key.startsWith(id + ':')) out.push(...arr)
    }
    return out
  }

  /** 某个矿辞名参与的所有配方。 */
  byOre (oreName) {
    if (!this._byOre) this._buildInputIndex()
    return (this._byOre.get(oreName) || []).slice()
  }

  forMod (mod) { return this.recipes.filter((r) => r.mod === mod) }
  forKind (kind) { return this.recipes.filter((r) => r.kind === kind) }
  byKind (kind) { return this.forKind(kind) }
  mods () { return [...new Set(this.recipes.map((r) => r.mod))].sort() }
  kinds (mod) {
    const list = mod ? this.recipes.filter((r) => r.mod === mod) : this.recipes
    return [...new Set(list.map((r) => r.kind))].sort()
  }

  summary () {
    const byMod = {}
    for (const r of this.recipes) byMod[r.mod] = (byMod[r.mod] || 0) + 1
    return { total: this.total, byMod, byKind: this.countBy, mods: this.mods() }
  }
}

let singleton = null

function loadModRecipes (file = MOD_RECIPES_FILE) {
  if (singleton && file === MOD_RECIPES_FILE) return singleton
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'))
  const book = new ModRecipes(payload)
  if (file === MOD_RECIPES_FILE) singleton = book
  return book
}

module.exports = { ModRecipes, loadModRecipes, MOD_RECIPES_FILE }
