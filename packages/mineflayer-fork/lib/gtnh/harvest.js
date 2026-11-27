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
// 同一类里还允许的「替代工具」：GT 的硬锤（HARDHAMMER）与匠魂的锤，GT 允许它们挖石/矿。
// **GT 没有自己的镐**（2026-11-27 用户确认：`IDMetaTool01` 里根本没有 PICKAXE）——镐只能用
// 匠魂的，材料可以是 GT 的（钴/玛玉灵/钨钢…，镐头属性决定挖掘速度）。
const TOOL_ALIASES = {
  pickaxe: ['pickaxe', 'hammer', 'multitool']
}

// GT 把原版镐禁了：只有木镐还能挖（2026-11-27 用户确认 + 实机对照：木镐 2.3s 挖掉石头，
// 钻石镐 20s 纹丝不动）。所以找镐时要把这几把原版镐排除掉，否则会挑到一把用不了的，
// 卡在「装备了工具却挖不动」上。石/铁/金/钻石全禁，只留 wooden_pickaxe。
// 能用的镐：匠魂的镐（TConstruct:pickaxe，GT 材料做镐头）、匠魂的锤、GT 的硬锤。
const BANNED_PICKAXES = new Set(['stone_pickaxe', 'iron_pickaxe', 'golden_pickaxe', 'diamond_pickaxe'])

// 注册名有时带 minecraft: 前缀、有时不带（GTNH 的方块名多数不带），统一去掉再比
function isBannedPickaxe (name) {
  return BANNED_PICKAXES.has(String(name || '').replace(/^minecraft:/, ''))
}

// 工具种类 → 物品名匹配。顺序有意义：pickaxe 必须排在 axe 前面（"pickaxe" 里也有 "axe"）。
const TOOL_PATTERNS = {
  pickaxe: /pickaxe|pick_head|_pick$|drill/i,
  hammer: /hammer/i,
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

/**
 * 匠魂工具的属性在 NBT 里（`InfiTool`）：MiningSpeed / HarvestLevel / Durability / TotalDurability。
 * 1.7.10 经 prismarine-nbt 解出来是 `{ type, value }` 套娃，这里两种形状都认。
 *
 * 挖掘速度直接决定「同一块矿挖多久」，所以挑工具时要按它排，不能只看名字里的材质。
 * 匠魂工具损坏后可以用主部件的材料锭在装配台（Tool Station / Tool Forge）修复——
 * `Durability` 接近 0 时 `findTools` 会把它排到后面。
 */
function tiCStats (item) {
  const root = item && item.nbt
  if (!root) return null
  const inf = unwrap(root).InfiTool
  if (!inf) return null
  const t = unwrap(inf)
  const num = (k) => {
    const v = t[k]
    return v == null ? null : Number(unwrap(v))
  }
  const speed = num('MiningSpeed')
  if (speed == null) return null
  return {
    miningSpeed: speed,
    harvestLevel: num('HarvestLevel'),
    durability: num('Durability'),
    totalDurability: num('TotalDurability')
  }
}

/** prismarine-nbt 的 `{type, value}` 拆一层；普通对象原样返回 */
function unwrap (v) {
  return v && typeof v === 'object' && 'value' in v && 'type' in v ? v.value : v
}

/** 工具的挖掘速度（越大越快）：匠魂读 NBT，其余按材质保守估 */
function toolSpeed (item) {
  const t = tiCStats(item)
  if (t && t.miningSpeed > 0) return t.miningSpeed
  const rank = toolRank((item && item.name) || '')
  return [1, 1.2, 2, 3, 4, 6, 8][rank] || 1
}

/** 工具还能不能用：匠魂工具耐久见底时别挑它 */
function isWornOut (item) {
  const t = tiCStats(item)
  if (!t || t.durability == null) return false
  return t.durability <= 1
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
  // 被 GT 禁掉的原版镐：当成「不是工具」，免得 findTools 挑中它们
  if (isBannedPickaxe(item.name)) return null
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
    .sort((a, b) => {
      // 快报废的排最后（匠魂工具耐久见底要先去装配台修）
      const worn = (isWornOut(a) ? 1 : 0) - (isWornOut(b) ? 1 : 0)
      if (worn) return worn
      if (!isBannedPickaxe(b.name) && !isBannedPickaxe(a.name)) {
        const bySpeed = toolSpeed(b) - toolSpeed(a)
        if (bySpeed) return bySpeed
      }
      return toolRank(b.name) - toolRank(a.name)
    })
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
    // GT 禁的是「镐」这一类工具（石/铁/金/钻石镐），别的工具类不管：泥土沙子（铲）
    // 空手就能挖，木板泥土也不拦。需要镐的方块（石头、各种矿）才必须找到木镐或匠魂镐。
    // 镐（矿/石头）、扳手（机器）、剪线钳（线缆）这三类必须找到工具；
    // 其余（铲/斧/剪刀等，且等级 0）空手也能挖，不拦。
    const strict = need.tool === 'pickaxe' || need.tool === 'wrench' || need.tool === 'cutter'
    if (!strict && (need.level | 0) <= 0) {
      return { ok: true, tool: null, need }
    }
    const banned = bot.inventory.items().filter((it) => isBannedPickaxe(it.name))
    const extra = banned.length ? `；背包里的 ${banned.map((b) => b.name).join(' / ')} 被 GT 禁了，只能用木镐或匠魂的镐（GT 没有镐）` : ''
    return { ok: false, reason: `没有${need.tool}（方块 ${block.name} 需要）${extra}`, need }
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
  bot.toolKindOf = (item) => toolKindOf(item)
  bot.bannedPickaxes = () => bot.inventory.items().filter((it) => isBannedPickaxe(it.name))
  bot.findTools = (tool) => findTools(bot, tool)
  bot.equipToolFor = (block, opts) => equipToolFor(bot, block, opts)
}

module.exports = {
  tiCStats,
  toolSpeed,
  isWornOut, toolNeeded, toolKindOf, findTools, equipToolFor, attachHarvest, TOOL_PATTERNS, TOOL_ALIASES, BANNED_PICKAXES, isBannedPickaxe, toolRank, sameItem }
