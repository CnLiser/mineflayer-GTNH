// 把 Java agent 导出的两份原始 JSONL 归一化成一个紧凑的 mod-recipes.json
//  1) data/raw/gtnh-2.9.0-server/mod-recipes.jsonl      —— thaumcraft + forestry（旧格式，in 是扁平 stack 列表）
//  2) data/raw/gtnh-2.9.0-server/mod-recipes-mods.jsonl —— railcraft/tconstruct/botania/bloodmagic（新格式，in 可能是嵌套）
//
// 归一化后的 cell（配方的一格/一种材料）统一成「备选数组」：
//   [{id,name,meta,count}, ...]  或  [{ore:"oreDictName"}, ...]  或  [ 上述混合 ]
// 顶层字段：{ mod, kind, out, ins: [[cell...], ...], fluidIn:[], fluidOut:[], time, extra }
const fs = require('fs')
const path = require('path')

const ROOT = 'G:/java/minecraft/mineflayer-GTNH/packages/gtnh-data'
const RAW = path.join(ROOT, 'data/raw/gtnh-2.9.0-server')
const OUT = path.join(ROOT, 'data/recipes/mod-recipes.json')

const read = (f) => {
  const p = path.join(RAW, f)
  if (!fs.existsSync(p)) return []
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
}


// 一些产物（TConstruct 的 ToolCore 工具）在服务端反射取 id 会触发客户端类加载，
// dump 里只能留 id=-1 + 注册名。这里用 FML 注册表把名字回填成 id。
const REGISTRY_FILES = [
  path.join(ROOT, '../protocol-fml/data/raw/local-fml-registry.json'),
  path.join(ROOT, '../protocol-fml/data/raw/fml-registry.json')
]
const nameToId = new Map()
for (const f of REGISTRY_FILES) {
  if (!fs.existsSync(f)) continue
  const reg = JSON.parse(fs.readFileSync(f, 'utf8'))
  for (const table of [reg.items, reg.blocks]) {
    if (!table) continue
    for (const [id, name] of Object.entries(table)) if (!nameToId.has(name)) nameToId.set(name, Number(id))
  }
}

function fixId (st) {
  if (!st || typeof st.id !== 'number') return st
  if (st.id > 0) return st
  const id = nameToId.get(st.name)
  return id ? Object.assign({}, st, { id }) : st
}

const isStack = (x) => x && typeof x === 'object' && typeof x.id === 'number'
const isOre = (x) => x && typeof x === 'object' && (typeof x.ore === 'string' || Array.isArray(x.ores))
// 遗传突变（蜜蜂/花）的产物是物种，不是物品：{species:'forestry.speciesX'}
const isSpecies = (x) => x && typeof x === 'object' && typeof x.species === 'string'

// 把任意形状的「一格」归一成备选数组
function asAlternatives (cell) {
  if (cell == null) return []
  if (Array.isArray(cell)) {
    const out = []
    for (const c of cell) out.push(...asAlternatives(c))
    return out
  }
  if (isStack(cell)) return [{ id: cell.id, name: cell.name, meta: cell.meta || 0, count: cell.count ?? 1 }]
  if (isOre(cell)) {
    const names = Array.isArray(cell.ores) ? cell.ores : [cell.ore]
    return names.map((n) => ({ ore: n }))
  }
  if (isSpecies(cell)) return [{ species: cell.species }]
  return []
}

function legacyExtra (r) {
  const extra = Object.assign({}, r.extra || {})
  for (const k of ['research', 'aspects', 'w', 'h', 'instability']) {
    if (r[k] !== undefined && extra[k] === undefined) extra[k] = r[k]
  }
  return extra
}

// 陷阱掉落写成 [{stack,weight}]；把它拆成 out 里的普通 stack + extra.weights
const isWeighted = (x) => x && typeof x === 'object' && x.stack && typeof x.weight === 'number'

function normalize (r, legacyFlat) {
  const extra = legacyExtra(r)
  let cells
  if (legacyFlat) {
    // 旧格式：in 是扁平 stack 列表，每项自己就是一格
    cells = (r.in || []).map((c) => asAlternatives(c))
  } else {
    cells = (r.ins || r.in || []).map((c) => asAlternatives(c))
  }
  // 带网格尺寸的配方（Avaritia 9x9）保留空格，位置就是布局；其余去掉完全空的格子
  const hasGrid = extra && typeof extra.w === 'number' && typeof extra.h === 'number'
  // 保位：网格布局按 w*h 对齐；平铺但有原槽位号（extra.keys）时也要对齐，否则空槽会错位
  const keepHoles = hasGrid || (extra && Array.isArray(extra.keys))
  if (!keepHoles) cells = cells.filter((c) => c.length > 0)
  cells = cells.map((c) => c.map(fixId))
  let outArr
  if (Array.isArray(r.out) && r.out.some(isWeighted)) {
    extra.weights = r.out.map((x) => x.weight)
    outArr = r.out.flatMap((x) => asAlternatives(x.stack)).map(fixId)
  } else {
    outArr = (Array.isArray(r.out) ? asAlternatives(r.out) : (isStack(r.out) ? asAlternatives(r.out) : [])).map(fixId)
  }
  return {
    mod: r.mod,
    kind: r.kind,
    out: outArr,
    ins: cells,
    fluidIn: (Array.isArray(r.fluidIn) ? r.fluidIn.filter(Boolean) : (r.fluidIn ? [r.fluidIn] : [])).concat(r.extra && r.extra.fluid ? [r.extra.fluid] : []),
    fluidOut: Array.isArray(r.fluidOut) ? r.fluidOut.filter(Boolean) : (r.fluidOut ? [r.fluidOut] : []),
    time: typeof r.time === 'number' ? r.time : null,
    extra
  }
}


// 多份 dump 会互相重复（例如 mods4 又带了蒸馏/坩埚/纺车）。只做**跨文件**去重：
// 同一文件内部即使完全一样也保留（那可能是 mod 真的注册了两次）。
const FRESH_FILES = ['mod-recipes-mods.jsonl', 'mod-recipes-mods2.jsonl', 'mod-recipes-mods3.jsonl', 'mod-recipes-mods4.jsonl', 'mod-recipes-mods5.jsonl', 'mod-recipes-mods6.jsonl', 'mod-recipes-batch2.jsonl', 'mod-recipes-batch3.jsonl']
const seenFresh = new Set()
const fresh = []
for (const f of FRESH_FILES) {
  const recs = read(f).map((r) => normalize(r, false))
  const localKeys = []
  for (const r of recs) {
    const key = JSON.stringify([r.mod, r.kind, r.out, r.ins, r.fluidIn, r.fluidOut, r.time, r.extra])
    if (seenFresh.has(key)) continue
    localKeys.push(key)
    fresh.push(r)
  }
  for (const k of localKeys) seenFresh.add(k)
}

// 老文件里 thaumcraft/forestry 的 out 可能是数组（附魔/变体），这里兼容保留
const fixedLegacy = read('mod-recipes.jsonl').map((r) => {
  const base = normalize(r, true)
  if (Array.isArray(r.out)) {
    base.out = asAlternatives(r.out)
  }
  return base
})

const all = fixedLegacy.concat(fresh)

// 索引：按产物（id:meta）反查，用于 bot.modRecipesFor()
const byOutput = {}
for (let i = 0; i < all.length; i++) {
  for (const o of all[i].out || []) {
    const key = o.id + ':' + (o.meta || 0)
    ;(byOutput[key] || (byOutput[key] = [])).push(i)
  }
}

const countBy = {}
for (const r of all) {
  const k = r.mod + ':' + r.kind
  countBy[k] = (countBy[k] || 0) + 1
}

const payload = { generatedAt: new Date().toISOString(), total: all.length, countBy, recipes: all, byOutput }
fs.writeFileSync(OUT, JSON.stringify(payload))
const size = (fs.statSync(OUT).size / 1024).toFixed(0)
console.log(JSON.stringify({ total: all.length, sizeKB: size, countBy }, null, 2))
