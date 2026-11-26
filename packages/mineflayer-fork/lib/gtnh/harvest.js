// GTNH-PATCH: 挖方块要用的工具。
//
// 1.7.10 的方块自己声明 getHarvestTool / getHarvestLevel，GT 又把它们用到了非原版工具上：
//   - 矿石（gt.blockores，按 meta 分材料）要镐，且等级随材料升高（铜=1、铁=2、钻石=3…）
//   - 机器方块（gt.blockmachines）要扳手，等级 = 机器等级
//   - 线缆 / 导线要剪线钳
// 数据来自服务端导出的 data/harvest.jsonl.gz（gtnh-data/src/harvest.js），
// 这里只负责「这个方块要什么工具」和「背包里哪件能顶」。
const { harvestToolFor, gtToolKind } = require('gtnh-data')

// GT 把扳手、剪线钳、锤全塞进 gregtech:gt.metatool.01 + damage，注册名一样，
// 只能靠 damage 查表（gtnh-data 的 gt-tools.json）。这张表优先于下面的名字正则。
// 同一类里还允许的「替代工具」：GT 的锤既能砸东西也能当镐挖石/矿。
const TOOL_ALIASES = {
  pickaxe: ['pickaxe', 'hammer', 'multitool']
}

// 工具种类 → 物品名匹配。顺序有意义：pickaxe 必须排在 axe 前面（"pickaxe" 里也有 "axe"）。
const TOOL_PATTERNS = {
  pickaxe: /pickaxe|pick_head|_pick$|drill/i,
  wrench: /wrench|screwdriver|screwdriver|monkeywrench|pliers/i,
  cutter: /wire_?cutter|wirecutter|snippers|cutter/i,
  shears: /shears/i,
  axe: /(^|[_\s])axe$|chainsaw/i,
  shovel: /shovel|spade|excavator/i,
  crowbar: /crowbar/i,
  scoop: /scoop/i,
  sword: /sword|katana|saber/i
}

// 材质排序：同一类工具里挑最好的那把
const MATERIAL_RANK = [
  [/diamond|钻石/i, 6],
  [/tungstensteel|tungsten_steel|钨钢/i, 5],
  [/steel|钢/i, 4],
  [/obsidian|黑曜石/i, 3],
  [/iron|铁/i, 2],
  [/flint|燧石|stone|stone_head/i, 1],
  [/wood|wooden|木/i, 0]
]

function toolRank (itemName) {
  for (const [re, rank] of MATERIAL_RANK) if (re.test(itemName)) return rank
  return 0
}

// 这个方块要什么工具（可能来自数据表，也可能来自 GT 的命名惯例）。
// 返回 null 表示「表里没有、也不像 GT 方块」，由调用方决定要不要徒手挖。
function toolNeeded (block) {
  if (!block) return null
  const name = block.name || ''
  const meta = block.metadata ?? block.meta ?? 0
  let need = harvestToolFor(name, meta)
  if (!need) {
    // GT 的矿石方块没声明 getHarvestTool（它覆盖的是 canHarvestBlock），按命名兜底
    if (/blockores|:.*_ore$|_ore\b/i.test(name)) need = { tool: 'pickaxe', level: 0 }
    else if (/blockmachines|blockcable|blockwire|_cable\b|:.*_wire$/i.test(name)) need = { tool: 'wrench', level: 0 }
  }
  return need
}

// 一个物品属于哪类工具：先查 GT 的 damage 表，再按名字正则。
function toolKindOf (item) {
  if (!item) return null
  const gt = gtToolKind(item.name || '', item.metadata ?? 0)
  if (gt) return gt
  const name = item.name || ''
  for (const [kind, re] of Object.entries(TOOL_PATTERNS)) if (re.test(name)) return kind
  return null
}

// 背包里匹配某类工具的物品，按材质从好到差。
// GT 工具的名字全都一样，材质排序只能退回背包顺序（物品本身带 NBT 材质，1.7 不解）。
function findTools (bot, tool) {
  if (!TOOL_PATTERNS[tool]) return []
  const kinds = TOOL_ALIASES[tool] || [tool]
  return bot.inventory.items()
    .filter((it) => kinds.includes(toolKindOf(it)))
    .sort((a, b) => toolRank(b.name) - toolRank(a.name))
}

// 两个物品是不是同一件（GT 工具同名不同 damage，必须连 metadata 一起比）
function sameItem (a, b) {
  return !!a && !!b && a.name === b.name && ((a.metadata ?? 0) | 0) === ((b.metadata ?? 0) | 0)
}

// 需要工具但背包里没有：返回 { ok:false, reason, need }
// 不需要工具（或表里没有）：返回 { ok:true, tool:null }
async function equipToolFor (bot, block, opts = {}) {
  const need = toolNeeded(block)
  if (!need) return { ok: true, tool: null, need: null }
  // 没有背包的 bot（离线测试的假对象）就当工具齐全，别拦着挖掘
  if (!bot.inventory || typeof bot.inventory.items !== 'function') return { ok: true, tool: null, need }
  const candidates = findTools(bot, need.tool)
  if (!candidates.length) {
    return { ok: false, reason: `没有${need.tool}（方块 ${block.name} 需要）`, need }
  }
  const best = candidates[0]
  if (sameItem(bot.heldItem, best)) return { ok: true, tool: best, need }
  // 装备是异步的，服务端不确认时会挂住，套一层超时
  let timer
  const done = await Promise.race([
    bot.equip(best, 'hand').then(() => true, () => false),
    new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), opts.equipTimeoutMs || 5000) })
  ]).finally(() => clearTimeout(timer))
  if (done !== true) return { ok: false, reason: `装备 ${best.name} 失败`, need }
  return { ok: true, tool: best, need }
}

function attachHarvest (bot) {
  bot.toolNeeded = (block) => toolNeeded(block)
  bot.findTools = (tool) => findTools(bot, tool)
  bot.equipToolFor = (block, opts) => equipToolFor(bot, block, opts)
}

module.exports = { toolNeeded, toolKindOf, findTools, equipToolFor, attachHarvest, TOOL_PATTERNS, TOOL_ALIASES, toolRank, sameItem }
