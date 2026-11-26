// GTNH 方块的挖掘工具表。
//
// 1.7.10 的方块自己声明 getHarvestTool(meta) / getHarvestLevel(meta)，GT 又把这套用到了
// 机器（wrench）、线缆（cutter）、矿石（pickaxe + 材料等级）上。minecraft-data 只有
// 「方块/非方块」两种 boundingBox，拿不到这些信息，所以从服务端内存里导了一份。
//
// 数据：data/harvest.jsonl.gz，每行 { name, meta, tool, level }，只收录 tool 非空的。
// 生成：packages/gtnh-data/tools/jmx/src/DumpHarvest7.java（见 HANDOVER §5）。
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const HARVEST_FILE = path.join(__dirname, '..', 'data', 'harvest.jsonl.gz')
const FILE = HARVEST_FILE

let cache = null

function load () {
  if (cache) return cache
  const text = zlib.gunzipSync(fs.readFileSync(FILE)).toString('utf8')
  const byName = new Map()
  let count = 0
  for (const line of text.split('\n')) {
    if (!line || line[0] !== '{') continue
    const row = JSON.parse(line)
    count++
    let metas = byName.get(row.name)
    if (!metas) { metas = new Map(); byName.set(row.name, metas) }
    metas.set(row.meta, { tool: row.tool, level: row.level })
  }
  cache = { byName, count }
  return cache
}

// 一个方块需要什么工具。meta 精确查不到就回落到 0（多数方块 16 个 meta 一样）。
// 返回 null 表示「原版意义上的徒手可挖」，或表里没有这个方块。
function toolFor (name, meta = 0) {
  const { byName } = load()
  const metas = byName.get(name) || byName.get(String(name).replace(/^minecraft:/, ''))
  if (!metas) return null
  return metas.get(meta & 0xf) || metas.get(0) || null
}

function needs (name, meta = 0) {
  return toolFor(name, meta) !== null
}

function names () {
  return [...load().byName.keys()]
}

// 每种工具各有多少个方块（调试/文档用）
function toolCounts () {
  const out = {}
  for (const metas of load().byName.values()) {
    for (const { tool } of metas.values()) out[tool] = (out[tool] || 0) + 1
  }
  return out
}

module.exports = { toolFor, needs, names, toolCounts, count: () => load().count, HARVEST_FILE }
