// TConstruct 的静态数据：熔炼（物品 → 流体 + 温度）、熔炉燃料、工具材料/弓材料/箭材料。
//
// 数据由 Java agent（packages/gtnh-data/tools/jmx/src/DumpMods27.java）attach 到服务端导出，
// 再经 tools/build-tconstruct.js 归一化成 data/tconstruct/tconstruct.json。
const fs = require('fs')
const path = require('path')

const T_CONSTRUCT_FILE = path.resolve(__dirname, '../data/tconstruct/tconstruct.json')

class TConstructData {
  constructor (doc) {
    this.doc = doc
    this._materials = doc.materials || {}
    this._names = doc.materialNames || {}
    this._bows = doc.bowMaterials || {}
    this._arrows = doc.arrowMaterials || {}
    this._fuels = doc.fuels || {}
    this._melting = doc.melting || {}
  }

  // ---------- 工具材料 ----------
  materials () { return Object.values(this._materials) }

  material (idOrName) {
    if (idOrName == null) return null
    if (typeof idOrName === 'number') return this._materials[idOrName] || null
    const byName = this._names[String(idOrName).toLowerCase()]
    if (byName !== undefined) return this._materials[byName] || null
    const n = Number(idOrName) // 也允许直接传 id 的字符串形式
    return Number.isFinite(n) ? (this._materials[n] || null) : null
  }

  materialNames () { return Object.keys(this._names).sort() }

  // TiC 内部把挖掘速度存成 ×100 的整数（900 → 9.0），这里给出直观值
  toolSpeed (m) {
    const mat = typeof m === 'object' ? m : this.material(m)
    return mat ? mat.miningSpeed / 100 : null
  }

  // 弓/箭参数按材料 id 索引
  bowMaterial (idOrName) {
    const mat = typeof idOrName === 'object' ? idOrName : this.material(idOrName)
    return mat ? this._bows[mat.id] || null : null
  }

  arrowMaterial (idOrName) {
    const mat = typeof idOrName === 'object' ? idOrName : this.material(idOrName)
    return mat ? this._arrows[mat.id] || null : null
  }

  // ---------- 熔炼 ----------
  fuels () { return Object.values(this._fuels) }

  fuel (fluid) { return this._fuels[String(fluid)] || null }

  isFuel (fluid) { return Object.prototype.hasOwnProperty.call(this._fuels, String(fluid)) }

  meltingFor (id, meta = 0) {
    return this._melting[`${id}:${meta}`] || this._melting[`${id}:0`] || null
  }

  temperatureFor (id, meta = 0) {
    const m = this.meltingFor(id, meta)
    return m ? m.temp : null
  }

  // 用某种燃料能否熔化这个物品（燃料 power 必须 ≥ 物品温度）
  canMeltWith (fuelFluid, id, meta = 0) {
    const f = this.fuel(fuelFluid)
    const m = this.meltingFor(id, meta)
    return !!(f && m && f.power >= m.temp)
  }

  summary () {
    return {
      materials: Object.keys(this._materials).length,
      bowMaterials: Object.keys(this._bows).length,
      arrowMaterials: Object.keys(this._arrows).length,
      fuels: Object.keys(this._fuels).length,
      melting: Object.keys(this._melting).length
    }
  }
}

let cached = null
let cachedFile = null

function loadTConstruct (file = T_CONSTRUCT_FILE) {
  if (cached && cachedFile === file) return cached
  cached = new TConstructData(JSON.parse(fs.readFileSync(file, 'utf8')))
  cachedFile = file
  return cached
}

module.exports = { TConstructData, loadTConstruct, T_CONSTRUCT_FILE }
