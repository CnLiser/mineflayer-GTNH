'use strict'

/**
 * 任务脚本：把「任务书要求什么」变成「现在该做什么」，然后去做。
 *
 *   bot.questSteps('Shadow Metal')   // 执行计划：动作列表 + 卡住的原因
 *   bot.runQuest('Shadow Metal')     // 按计划真的去挖/合成/烧
 *
 * 计划是自底向上的：(1) 先减掉背包里已有的；(2) 能给配方的往下拆；
 * (3) 拆不动的看能不能直接挖；都不行的进 blocked。
 *
 * 只做三件事：挖（mine）、原版合成（craft）、熔炉（smelt）。GT 机器和 mod 机器
 * 需要 GUI 操作，不在这一层——它们会出现在 blocked 里，reason 写清要什么。
 */

const { recipeFor, idOf, stripColor } = require('./quests')
const { resolveBlock } = require('./mining')

const MAX_DEPTH = 6
const MAX_STEPS = 200

function attachQuestRun (bot) {
  bot.questSteps = (id, opts) => planQuest(bot, id, opts)
  bot.runQuest = (id, opts) => runQuest(bot, id, opts)
}

/** crafting 类任务：产物就是目标（背包判断不出来合成过没有） */
function craftingTargets (quest) {
  const out = []
  for (const t of quest.tasks || []) {
    if (t.type !== 'crafting') continue
    for (const it of t.items || []) out.push({ id: it.id, meta: it.meta || 0, need: it.count, have: 0 })
  }
  return out
}

/** 物品名（不带 minecraft: 前缀） */
function shortName (name) {
  return String(name || '').replace(/^minecraft:/, '')
}

/** 这个物品能不能直接挖到；能就返回方块名 */
function blockForItem (bot, item) {
  const name = shortName(item.id)
  const blocks = (bot.registry && bot.registry.blocksByName) || {}
  const candidates = [name, name + '_ore']
  for (const c of candidates) {
    if (blocks[c]) return c
  }
  // GT 的矿全在 gregtech:gt.blockores（meta 区分种类）——只有名字本身就是「某矿」才回落到它，
  // 否则木棍这类物品也会被当成矿，计划里出现「去挖 gregtech:gt.blockores」
  if (/_ore$/.test(name) && blocks['gregtech:gt.blockores']) return 'gregtech:gt.blockores'
  // coal → coal_ore、diamond → diamond_ore 这类；反查一次
  for (const c of Object.keys(blocks)) {
    const s = shortName(c)
    if (s === name + '_ore') return c
  }
  return null
}

/**
 * 缺料 → 执行计划。
 * 返回 `{ quest, steps, blocked, ready }`：
 *   steps   [{ kind:'mine'|'craft'|'smelt', item, count, block?, inputs? }]
 *   blocked [{ item, count, reason }]
 */
function planQuest (bot, id, opts) {
  const o = { depth: MAX_DEPTH, ...(opts || {}) }
  const book = bot.quests()
  const quest = book.get(id) || (book.byName(id) || [])[0] || null
  if (!quest) throw new Error(`没有这条任务：${id}`)

  const inv = bot.inventory ? bot.inventory.items() : []
  const chk = book.check(quest.id, inv)
  // crafting 类任务（合成过 N 次）从背包判断不出来，missing 是空的——
  // 把它的产物当成目标，规划「把这些做出来」。
  const missing = chk.missing.length
    ? chk.missing
    : (chk.unknown || []).includes('crafting')
        ? craftingTargets(quest)
        : []
  const steps = []
  const blocked = []
  const seen = new Map()

  // 第一遍：累加需求，边算边记配方（同一个物品被多条路线要，数量要加起来）
  const demand = new Map() // key -> { item, count, expanded, block, recipe }
  const walk = (item, count, depth, stack) => {
    if (count <= 0) return
    const key = `${shortName(item.id)}#${item.meta || 0}`
    // 配方里套自己（GT 给「泥土 = 砂砾 + 泥土」加了配方）——丢掉配方，改成挖
    const trail = stack || new Set()
    if (trail.has(key)) {
      const loop = demand.get(key)
      if (loop) {
        loop.recipe = null
        const b = blockForItem(bot, item)
        if (b) loop.block = b
      }
      return
    }
    const d = demand.get(key) || { item: { id: item.id, meta: item.meta || 0 }, count: 0, expanded: 0 }
    d.count += count
    demand.set(key, d)
    if (depth > o.depth) {
      blocked.push({ item: item.id, meta: item.meta || 0, count, reason: '拆得太深了' })
      return
    }
    const delta = d.count - d.expanded
    if (delta <= 0) return
    d.expanded = d.count

    // 取舍顺序：工作台合成/熔炉优先（木板、木棍这类物品本身是方块，直接挖也能得到，
    // 但有配方时按配方做更靠谱）；没有再挖（泥土、圆石、矿）；都不行的看有没有
    // 机器配方（GT 机器 / mod 机器），有就报「需要什么机器」。
    const r = recipeFor(bot, item)
    const canDig = blockForItem(bot, item)
    const simple = r && (r.kind === 'craft' || r.kind === 'smelt')
    if (simple) {
      // 配方里含自己（GT 给泥土加了「砂砾 + 泥土 → 泥土」），能挖就直接挖
      const selfLoop = r.inputs.some((i) => shortName(i.id) === shortName(item.id))
      if (selfLoop && canDig) {
        d.block = canDig
        return
      }
      d.recipe = r
      // 配方一次产几个没记，按 1 产出放大（安全方向：多备料）
      const next = new Set(trail).add(key)
      // 一次合成产 outputCount 个，要 delta 个就做 ceil(delta/outputCount) 次
      const times = Math.ceil(delta / (r.outputCount || 1))
      for (const i of r.inputs) {
        const need = scale(i, times)
        walk(need, need.count, depth + 1, next)
      }
      return
    }
    if (canDig) {
      d.block = canDig
      return
    }
    if (r) {
      blocked.push({ item: item.id, meta: item.meta || 0, count: d.count, reason: `需要 ${r.kind}（这一层不执行）` })
      return
    }
    blocked.push({ item: item.id, meta: item.meta || 0, count: d.count, reason: '既挖不到，也没有配方' })
  }

  const empty = new Set()
  for (const m of missing) walk(m, m.need - m.have, 0, empty)

  // 第二遍：后序输出（先把原料备齐，再做这一步）
  const done = new Set()
  const add = (step) => {
    if (steps.length >= MAX_STEPS) return
    const k = `${step.kind}|${shortName(step.item)}|${step.meta || 0}`
    if (steps.some((x) => `${x.kind}|${shortName(x.item)}|${x.meta || 0}` === k)) return
    steps.push(step)
  }
  const emit = (key) => {
    if (done.has(key)) return
    done.add(key)
    const d = demand.get(key)
    if (!d) return
    if (d.recipe) for (const i of d.recipe.inputs) emit(`${shortName(i.id)}#${i.meta || 0}`)
    if (d.block) add({ kind: 'mine', item: d.item.id, meta: d.item.meta, count: d.count, block: d.block })
    else if (d.recipe) add({ kind: d.recipe.kind, item: d.item.id, meta: d.item.meta, count: d.count, inputs: d.recipe.inputs })
  }
  for (const key of demand.keys()) emit(key)

  return {
    quest: { id: quest.id, name: stripColor(quest.name), line: quest.line },
    steps,
    blocked,
    ready: steps.length === 0 && blocked.length === 0
  }
}

function scale (input, times) {
  return { id: input.id, meta: input.meta || 0, count: (input.count || 0) * Math.max(1, times) }
}

/**
 * 按计划执行；返回每步结果。
 *
 * 一轮可能做不完（挖着挖着世界变了、掉落物没捡到、合成缺料），所以按轮重算：
 * 每轮重新 planQuest（背包变了，缺料就少了），直到 ready 或连续两轮没有进展。
 */
async function runQuest (bot, id, opts) {
  const o = { only: ['mine', 'craft', 'smelt'], rounds: 6, ...(opts || {}) }
  const all = []
  let plan = planQuest(bot, id, o)
  for (let round = 1; round <= o.rounds; round++) {
    if (plan.ready || !plan.steps.length) break
    let progress = 0
    for (const step of plan.steps) {
      if (!o.only.includes(step.kind)) {
        all.push({ round, ...step, ok: false, reason: `本层不执行 ${step.kind}` })
        continue
      }
      try {
        const r = await runStep(bot, step, o)
        all.push({ round, ...step, ...r })
        if (r.ok) progress++
        if (!r.ok && o.stopOnFail) return { plan, log: all, missing: bot.questMissing(id) }
      } catch (e) {
        all.push({ round, ...step, ok: false, reason: e.message })
        if (o.stopOnFail) return { plan, log: all, missing: bot.questMissing(id) }
      }
    }
    plan = planQuest(bot, id, o)
    if (progress === 0) break
  }
  return { plan, log: all, missing: bot.questMissing(id), ready: plan.ready }
}

async function runStep (bot, step, o) {
  if (step.kind === 'mine') {
    const n = await mine(bot, step, o)
    return n > 0 ? { ok: true, mined: n } : { ok: false, reason: '一块也没挖到' }
  }
  if (step.kind === 'craft') return craft(bot, step, o)
  if (step.kind === 'smelt') return smelt(bot, step, o)
  return { ok: false, reason: `不知道怎么做 ${step.kind}` }
}

async function mine (bot, step, o) {
  if (typeof bot.mineNearby !== 'function') return 0
  // 用「背包净增」判断挖到没有：mineNearby 的返回值只记它自己挖掉的那几块，
  // 脚边已有的掉落物、之前挖过的不算在内。
  const before = countOf(bot, step.item, step.meta)
  const need = Math.max(1, step.count - before)
  await bot.mineNearby(step.block || step.item, { count: need, radius: o.radius || 24 })
  const after = countOf(bot, step.item, step.meta)
  return after - before
}

/** 背包里某种物品有多少 */
function countOf (bot, id, meta) {
  const want = shortName(id)
  let n = 0
  for (const it of bot.inventory ? bot.inventory.items() : []) {
    if (shortName(it.name || it.id) === want && (it.metadata || 0) === (meta || 0)) n += it.count
  }
  return n
}

async function craft (bot, step, o) {
  const nid = idOf(bot, step.item)
  const recipes = bot.recipesAll ? bot.recipesAll(nid, step.meta || null, true) : []
  const recipe = recipes[0] || null
  if (!recipe) return { ok: false, reason: 'registry 里找不到这个配方' }
  // bot.craft 的第二个参数是「合成几次」，不是「要几个产物」——2x2 配方一次产 4 个木板，
  // 要 7 个木板只该做 2 次，传 7 次会报 missing ingredient
  const per = (recipe.result && recipe.result.count) || 1
  const times = Math.max(1, Math.ceil(step.count / per))
  let tableBlock = null
  if (recipe.requiresTable !== false) {
    const table = bot.registry.blocksByName['crafting_table']
    tableBlock = table ? bot.findBlock({ matching: table.id, maxDistance: 16 }) : null
    if (!tableBlock) return { ok: false, reason: '16 格内没有工作台' }
  }
  await bot.craft(recipe, times, tableBlock)
  return { ok: true, crafted: step.count }
}

async function smelt (bot, step, o) {
  if (typeof bot.openFurnace !== 'function') return { ok: false, reason: '这个 fork 没有 openFurnace' }
  const furnace = bot.registry.blocksByName['furnace']
  const b = furnace ? bot.findBlock({ matching: furnace.id, maxDistance: 16 }) : null
  if (!b) return { ok: false, reason: '16 格内没有熔炉' }
  return { ok: false, reason: '熔炉还没实现（下一步）' }
}

module.exports = { attachQuestRun, planQuest, runQuest, blockForItem, countOf, stripColor }
