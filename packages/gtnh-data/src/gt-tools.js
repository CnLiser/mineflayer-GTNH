// GT 自带工具的类型表。
//
// GT 把扳手、剪线钳、锤这些全塞进同一个物品：gregtech:gt.metatool.01 + damage。
// 注册名一模一样，按名字找工具会全部落空，只能靠 damage 区分，而 damage 的含义
// 只写在 lang 里（gt.metatool.01.<damage>.name）。数据由 tools/build-gt-tools.js
// 从 gregtech jar 生成到 data/gt-tools.json。
const fs = require('fs')
const path = require('path')

const GT_TOOLS_FILE = path.join(__dirname, '..', 'data', 'gt-tools.json')

let cache = null

function loadGtTools () {
  if (cache) return cache
  let raw = { items: {}, count: 0 }
  if (fs.existsSync(GT_TOOLS_FILE)) raw = JSON.parse(fs.readFileSync(GT_TOOLS_FILE, 'utf8'))
  const byItem = new Map()
  for (const [item, metas] of Object.entries(raw.items || {})) {
    const m = new Map()
    for (const [dmg, info] of Object.entries(metas)) m.set(Number(dmg), info)
    byItem.set(item, m)
  }
  cache = { byItem, count: raw.count || 0, generatedAt: raw.generatedAt }
  return cache
}

// 一个物品是不是 GT 的多用途工具，是的话返回它的种类（wrench / cutter / hammer …）。
// damage 精确匹配，查不到返回 null。
function gtToolKind (itemName, meta = 0) {
  const { byItem } = loadGtTools()
  const metas = byItem.get(itemName)
  if (!metas) return null
  const info = metas.get(Number(meta))
  return info ? info.kind : null
}

function gtToolName (itemName, meta = 0, lang = 'en') {
  const { byItem } = loadGtTools()
  const metas = byItem.get(itemName)
  if (!metas) return null
  const info = metas.get(Number(meta))
  if (!info) return null
  return lang === 'zh' ? info.zh || info.name : info.name
}

// 名字里含某类工具的物品模型（给 UI / 日志用）：{ dmg, kind, name }[]
function gtToolsOfKind (kind) {
  const { byItem } = loadGtTools()
  const out = []
  for (const [item, metas] of byItem) {
    for (const [dmg, info] of metas) if (info.kind === kind) out.push({ item, dmg, name: info.name })
  }
  return out
}

module.exports = { GT_TOOLS_FILE, loadGtTools, gtToolKind, gtToolName, gtToolsOfKind }
