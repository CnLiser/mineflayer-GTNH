// 把 Java agent 导出的 TConstruct 数据（熔炼温度 / 熔炉燃料 / 工具材料）整理成一个紧凑的 JSON。
//
// 原始：data/raw/gtnh-2.9.0-server/tconstruct-data.jsonl  (DumpMods27)
//   {"kind":"melting_temp","in":{id,name,meta,count},"temp":400,"fluidOut":[{"fluid":"aluminum.molten","amount":144}]}
//   {"kind":"fuel","fluid":"lava","power":1300,"duration":80}
//   {"kind":"material","id":0,"name":"Wood","localized":"material.wood",...}
//   {"kind":"bow_material","id":..,"drawSpeed":18,"flightSpeedMax":3,"durability":..}
//   {"kind":"arrow_material","id":..,"mass":0.69,"breakChance":0.5,"accuracy":..}
//
// 产物：data/tconstruct/tconstruct.json
const fs = require('fs')
const path = require('path')

const ROOT = 'G:/java/minecraft/mineflayer-GTNH/packages/gtnh-data'
const RAW = path.join(ROOT, 'data/raw/gtnh-2.9.0-server/tconstruct-data.jsonl')
const OUT_DIR = path.join(ROOT, 'data/tconstruct')
const OUT = path.join(OUT_DIR, 'tconstruct.json')

const lines = fs.readFileSync(RAW, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))

const materials = {}
const materialNames = {}
const bowMaterials = {}
const arrowMaterials = {}
const fuels = {}
const melting = {}

for (const r of lines) {
  if (r.kind === 'material') {
    materials[r.id] = {
      id: r.id,
      name: r.name,
      localized: r.localized,
      displayName: r.displayName,
      harvestLevel: r.harvestLevel,
      durability: r.durability,
      // TiC 内部把速度存成 ×100 的整数（900 = 9.0），attack 则是它自己的小整数攻击值
      miningSpeed: r.miningSpeed,
      attack: r.attack,
      handleModifier: r.handleModifier,
      reinforced: r.reinforced,
      stonebound: r.stonebound,
      tipStyle: r.tipStyle || '',
      color: r.color,
      ability: r.ability || ''
    }
    const key = String(r.name || '').toLowerCase()
    if (key && materialNames[key] === undefined) materialNames[key] = r.id
  } else if (r.kind === 'bow_material') {
    bowMaterials[r.id] = { id: r.id, drawSpeed: r.drawSpeed, flightSpeedMax: r.flightSpeedMax, durability: r.durability }
  } else if (r.kind === 'arrow_material') {
    arrowMaterials[r.id] = { id: r.id, mass: r.mass, breakChance: r.breakChance, accuracy: r.accuracy }
  } else if (r.kind === 'fuel') {
    fuels[r.fluid] = { fluid: r.fluid, power: r.power, duration: r.duration }
  } else if (r.kind === 'melting_temp') {
    const item = r.in || {}
    const out = (r.fluidOut || [])[0]
    if (!out) continue
    const key = `${item.id}:${item.meta || 0}`
    melting[key] = {
      id: item.id,
      name: item.name,
      meta: item.meta || 0,
      temp: r.temp,
      fluid: out.fluid,
      amount: out.amount
    }
  }
}

const doc = {
  generatedAt: new Date().toISOString(),
  counts: {
    materials: Object.keys(materials).length,
    bowMaterials: Object.keys(bowMaterials).length,
    arrowMaterials: Object.keys(arrowMaterials).length,
    fuels: Object.keys(fuels).length,
    melting: Object.keys(melting).length
  },
  materials,
  materialNames,
  bowMaterials,
  arrowMaterials,
  fuels,
  melting
}

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(doc))
console.log(JSON.stringify({ counts: doc.counts, sizeKB: Math.round(fs.statSync(OUT).size / 1024), out: OUT }, null, 2))
