// GTNH-PATCH: GT 单方块机器的「按配方做东西」——开机器 → 放料 → 开机 → 等产物 → 取件
//
// 这一层把 MUI2 的写能力（开关机器）和窗口槽位操作串起来，供 questrun 的
// `kind:'machine'` 步骤使用。
//
// 机器识别靠打开 GUI 后的 panel 名：GT 的 MUI2 面板名形如
// `basicmachine.alloysmelter.tier.02`，其中 `alloysmelter` 就是机器名，
// 对应的配方表是 `gt.recipe.alloysmelter`；`.tier.02` 是机器档位（0=ULV、1=LV…）。
//
// 槽位沿用 GT BasicMachine 的惯例（机器槽在窗口最前面，玩家背包紧跟其后）：
//   [0] 输入1  [1] 形状1  [2] 输入2  [3] 形状2  [4] 输出
// 合金炉这类只有输入/输出的机器用 0/2/4，压模机用 0..4。

const { Vec3 } = require('vec3')
const { gtnWindowSlots, canRun } = require('./gtmachine')

// MTEBasicMachine 的字节码定的布局：0 存储、1..2 充放电、3 特殊槽（模）、5 起输入、5+n 起输出
// GT 单方块机器的窗口槽（实机校准，2026-11-27）：
//   0、1 是输入（压模机：料进 0、模进 1；合金炉：两种料各占一个）
//   留出 2 给「第三种料」（组装机之类），产物则**全扫**（不同机器不一样，(39) 是 4）
const MACHINE_SLOTS = {
  power: 1,     // 0 存储槽、1 充放电槽（放电池/红石）
  input: 2,     // 输入槽从 2 开始
  special: 3,   // 特殊槽（压模机的模、电路板）
  out: 4,       // 输出槽从 4 开始
  inputs: [2]
}
const TIER_NAMES = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV', 'UIV']

// panel 名 → { name, tier }
function parsePanel (panel) {
  const m = /^basicmachine\.([a-z0-9_]+)\.tier\.(\d+)$/.exec(String(panel || ''))
  if (!m) return null
  return { name: m[1], tier: Number(m[2]), tierName: TIER_NAMES[Number(m[2])] }
}

// 机器名 → GT 配方表名（多数就是 gt.recipe.<name>，个别不一样）
const MAP_ALIAS = {
  macerator: 'gt.recipe.macerator',
  compressor: 'gt.recipe.compressor',
  extractor: 'gt.recipe.extractor',
  centrifuge: 'gt.recipe.centrifuge',
  orewasher: 'gt.recipe.orewasher',
  thermalcentrifuge: 'gt.recipe.thermalcentrifuge',
  forgedhammer: 'gt.recipe.hammer',
  recycler: 'gt.recipe.recycler',
  microwave: 'gt.recipe.microwave',
  extruder: 'gt.recipe.extruder',
  formingpress: 'gt.recipe.forming'
}

function mapForMachine (name) {
  if (!name) return null
  return MAP_ALIAS[name] || `gt.recipe.${name}`
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// GTNH-PATCH: 打开方块 GUI 有两个硬条件——**距离 ≤ 2 格**、**中间是空气**。
// 站着不动就点，只会在 3 格外或隔着方块时静默失败（服务端根本不动，客户端等到
// `windowOpen` 超时），现象很像「机器坏了」。这里先判断，再绕着机器找能站的格。
async function approachForGui (bot, block, opts = {}) {
  if (!block) return false
  if (!block.position) return true       // 拿不到坐标就别拦，交给 openBlock 自己报错
  const pos = block.position
  const reach = opts.reach == null ? 2 : opts.reach
  const eye = () => bot.entity.position.offset(0, 1.62, 0)
  // 假 bot / 缺能力（没有 goto、位置不是 Vec3）时直接放行，别把离线测试卡死
  if (typeof bot.goto !== 'function') return true
  const ok = () => {
    try {
      const center = pos.offset(0.5, 0.5, 0.5)
      if (eye().distanceTo(center) > reach + 0.6) return false
      return !!bot.canSeeBlock(block)
    } catch { return true }
  }
  if (ok()) return true
  const around = []
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    for (const dy of [0, -1, 1]) around.push(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz))
  }
  around.sort((a, b) => bot.entity.position.distanceTo(a.offset(0.5, 0, 0.5)) - bot.entity.position.distanceTo(b.offset(0.5, 0, 0.5)))
  for (const p of around) {
    const at = bot.blockAt(p)
    if (at && at.boundingBox === 'block') continue
    const feet = bot.blockAt(p.offset(0, -1, 0))
    if (!feet || feet.boundingBox === 'empty') continue
    try {
      await bot.goto(p.offset(0.5, 0, 0.5), { timeoutMs: opts.timeoutMs || 8000, dig: false })
    } catch { continue }
    if (ok()) return true
  }
  return false
}

// 探测机器接受哪些槽：把背包里的一叠东西挨个试放到 0..(玩家区起点-1)，
// 放进去 700ms 后还在就说明收（GT 的合金炉实测 2/3/4 收、0/1 拒）。
// 试完把东西取回来。
async function probeSlots (bot, sample) {
  const win = bot.currentWindow
  const start = win.inventoryStart == null ? win.slots.length - 36 : win.inventoryStart
  const accepted = []
  let src = findWindowSlotFor(win, sample)
  if (src < 0) return accepted
  for (let dest = 0; dest < start; dest++) {
    if (win.slots[dest]) continue
    await bot.clickWindow(src, 1, 0)      // 右键拿 1 个
    await sleep(120)
    await bot.clickWindow(dest, 1, 0)     // 右键放 1 个
    await sleep(650)
    const stayed = !!(win.slots[dest])
    if (stayed) {
      accepted.push(dest)
      await bot.clickWindow(dest, 0, 0)   // 取回（左键拿起）
      await sleep(120)
      await bot.clickWindow(src, 0, 0)    // 放回原叠（左键合并）
      await sleep(200)
    } else {
      // 被拒时物品可能还在光标上，点回源头
      await bot.clickWindow(src, 0, 0)
      await sleep(200)
    }
    src = findWindowSlotFor(win, sample)
    if (src < 0) break
  }
  return accepted
}

// 在窗口里找「玩家背包里这叠东西」对应的槽。
//
// 不按 inventoryStart/hotbarStart 推——GT 容器的玩家区是快捷栏在前、主背包在后，
// 而 fork 的 fixWindowLayout 是按原版顺序猜的，两者对不上（实测物品在 5/6 而不是 14）。
// 直接按内容找：从玩家区起点往后扫，第一个 name+meta+count 都对上的就是它。
function findWindowSlotFor (win, item) {
  const start = win.inventoryStart == null ? win.slots.length - 36 : win.inventoryStart
  // 只比 name+metadata：数量会被放料/探测改掉，按数量比会找不到（实测踩过）
  const eq = (s) => s && s.name === item.name && s.metadata === item.metadata
  for (let i = start; i < win.slots.length; i++) if (eq(win.slots[i])) return i
  for (let i = 0; i < win.slots.length; i++) if (eq(win.slots[i])) return i
  return -1
}

// 背包槽 → 窗口槽（仅在没有内容可对时兜底用）
//
// `item.slot` 用的是 mineflayer 的 46 槽编号（9–35 主背包、36–44 快捷栏）。
// GT 容器窗口的玩家区是 **快捷栏在前、主背包在后**（实测 41 槽的合金炉：
// 5–13 是快捷栏、14–40 是主背包），所以不能直接用 fork 猜的 hotbarStart，
// 只能按 inventoryStart 推：快捷栏 = start + (slot-36)，主背包 = start + 9 + (slot-9)。
function invToWindow (win, slot) {
  const start = win.inventoryStart == null ? win.slots.length - 36 : win.inventoryStart
  if (slot >= 36) return start + (slot - 36)
  if (slot >= 9) return start + 9 + (slot - 9)
  return -1
}

// 把一个窗口槽里的东西放进机器槽 n 个（剩下的放回原处）
async function putN (bot, dest, src, n) {
  const win = bot.currentWindow
  if (!win) return { ok: false, reason: '没有打开的窗口' }
  if (!win.slots[src]) return { ok: false, reason: `源槽 ${src} 是空的（dest ${dest}）` }
  const total = win.slots[src].count
  await bot.clickWindow(src, 0, 0)          // 左键拿起整叠
  if (total <= n) {
    await bot.clickWindow(dest, 0, 0)       // 全放
    return { ok: true }
  }
  for (let i = 0; i < n; i++) await bot.clickWindow(dest, 1, 0) // 右键一次一个
  await bot.clickWindow(src, 0, 0)          // 剩下的放回原处
  return { ok: true }
}

// 把机器槽里的东西倒回背包（放料前清位）
async function clearSlot (bot, dest) {
  const win = bot.currentWindow
  if (!win || !win.slots[dest]) return
  const empty = firstEmptyInv(win)
  if (empty < 0) return
  await bot.clickWindow(dest, 0, 0)
  await bot.clickWindow(empty, 0, 0)
  await sleep(150)
}

// 背包区第一个空槽（避开机器槽）
function firstEmptyInv (win) {
  const start = win.inventoryStart == null ? win.slots.length - 36 : win.inventoryStart
  for (let i = start; i < win.slots.length; i++) if (!win.slots[i]) return i
  return -1
}

/**
 * 按配方做 count 个 item。
 *
 * opts:
 *   item / meta      目标产物（注册名 + metadata）
 *   count            要几个（默认 1）
 *   at               Vec3，机器所在方块位置（省略则扫 opts.radius 内的机器）
 *   radius           扫描半径，默认 8
 *   machines         [{ pos, block }]，直接指定候选机器
 *   timeoutMs        等产物的上限，默认 60000
 *   dryRun           只规划不发包
 */
async function machineCraft (bot, opts) {
  const o = { count: 1, radius: 8, timeoutMs: 60000, ...(opts || {}) }
  const item = (typeof o.item === 'string' || typeof o.item === 'number') ? o.item : null
  if (item == null) return { ok: false, reason: '要说清做什么（item）' }
  if (typeof bot.gtRecipesForOutput !== 'function') return { ok: false, reason: '没有配方数据' }

  const recipes = bot.gtRecipesForOutput(item, o.meta == null ? null : o.meta) || []
  // 产物可能用数字 id 传进来，比对时统一成注册名
  const itemName = typeof item === 'string' ? item : (bot.registry.items[item] || {}).name
  // 必须连 meta 一起比：GT 的 metaitem.01 几千种物品同名，只比名字会把输入料当成产物
  const wantMeta = o.meta == null ? null : Number(o.meta)
  const sameOut = (slot) => slot && (slot.name === itemName || slot.name === item || String(slot.id) === String(item)) &&
    (wantMeta == null || slot.metadata === wantMeta)
  if (!recipes.length) return { ok: false, reason: `配方表里没有 ${item}${o.meta == null ? '' : ':' + o.meta}` }

  const machines = o.machines && o.machines.length
    ? o.machines.map((m) => ({ ...m, block: m.block || bot.blockAt(m.pos) })).filter((m) => m.block)
    : candidatesIn(bot, o.at, o.radius)

  if (!machines.length) return { ok: false, reason: '附近没有 GT 机器' }

  const tried = []
  for (const m of machines) {
    const block = m.block
    let win
    try {
      const near = await approachForGui(bot, block, { timeoutMs: o.approachMs || 8000 })
      if (!near) tried.push({ name: block.name, reason: '走不到机器 2 格内（GUI 要求 ≤2 格且中间是空气）' })
      win = await bot.openBlock(block)
    } catch (e) {
      tried.push({ name: block && block.name, reason: `打不开：${e.message}` })
      continue
    }
    try {
      // MUI2 的值是打开后一批 syncHandler 推过来的，立刻读会读到空表
      let panel = null
      for (let i = 0; i < 20 && !panel; i++) {
        panel = bot.modularPanels()[0]
        if (!panel) await sleep(o.dryRun ? 0 : 150)
      }
      if (!panel) { tried.push({ name: block.name, reason: '不是 MUI2 界面（没有面板）' }); continue }
      for (let i = 0; i < 20; i++) {
        const st = bot.panelState(panel) || {}
        if (Object.keys(st).some((k) => /powerSwitch/i.test(k))) break
        await sleep(o.dryRun ? 0 : 150)
      }
      const info = parsePanel(panel)
      if (!info) { tried.push({ name: block.name, panel, reason: '不认识的机器面板' }); continue }
      const map = mapForMachine(info.name)
      const mine = recipes.filter((r) => r.map === map)
      if (!mine.length) {
        tried.push({ name: info.name, panel, reason: `这台机器的配方表（${map}）里没有这个产物` })
        continue
      }
      mine.sort((a, b) => (a.in || []).length - (b.in || []).length)
      const recipe = mine[0]
      const need = (recipe.in || []).map((i) => ({ ...i, count: i.count || 1 }))
      const chk = canRun(recipe, info.tierName)
      const plan = { machine: info.name, panel, tier: info.tierName, map, recipe: { eu: recipe.eu, dur: recipe.dur, in: need, out: recipe.out } }
      if (!chk.ok) {
        tried.push({ name: info.name, panel, reason: chk.reason })
        if (o.dryRun) break            // 规划只需要第一台机器，不必把所有候选试一遍
        continue
      }
      if (o.dryRun) { await bot.closeWindow(win); return { ok: true, dryRun: true, ...plan } }

      // 放料：先查背包够不够，不够就别动窗口
      const missing = []
      // 同一个注册名可能对应不同 meta（GT 的 metaitem.01 是几千种物品共用一个名字），
      // 所以匹配必须同时看 meta。
      const matchInput = (it, input) => (it.name === input.name || it.name === input.id) &&
        (input.meta == null || it.metadata === input.meta)
      for (const input of need) {
        const have = bot.inventory.items().filter((it) => matchInput(it, input)).reduce((a, b) => a + b.count, 0)
        if (have < input.count) missing.push(`${input.name} x${input.count}（有 ${have}）`)
      }
      if (missing.length) { tried.push({ name: info.name, panel, reason: `背包缺料：${missing.join('、')}` }); continue }

      // GT 单方块机器的槽位是固定的（MTEBasicMachine 字节码）：
      //   0 存储、1..2 充放电、3 特殊槽（压模机的模）、5 起输入、5+mInputSlotCount 起输出。
      // 之前靠 probeSlots 猜，会把铁锭放进 0/1（充电槽），机器永远不动。
      // 模/电路这类走「特殊槽」(slot 3)，其余按顺序进输入槽（slot 5 起）
      const isSpecialItem = (it) => /metalPattern|mold|Shape|circuit/i.test(it.name || '')
      const slotOrder = []
      let nextInput = MACHINE_SLOTS.input
      for (const it of need) slotOrder.push(isSpecialItem(it) ? MACHINE_SLOTS.special : nextInput++)
      let si = 0
      let placedAll = true
      let putReason = ''
      for (const input of need) {
        const src = bot.inventory.items().find((it) => matchInput(it, input))
        const srcSlot = findWindowSlotFor(win, src)
        if (srcSlot < 0) { placedAll = false; putReason = `窗口里找不到 ${input.name}:${input.meta}`; break }
        const dest = slotOrder[si++] ?? MACHINE_SLOTS.inputs[0]
        const cur = win.slots[dest]
        if (cur && !matchInput(cur, input)) await clearSlot(bot, dest)
        const okPut = await putN(bot, dest, srcSlot, input.count)
        if (!okPut.ok) { placedAll = false; putReason = okPut.reason; break }
        await sleep(150)
      }
      if (!placedAll) { tried.push({ name: info.name, panel, reason: `放料失败：${putReason}` }); continue }

      // 开机（如果关着）
      const state = bot.panelState(panel) || {}
      const powerKey = Object.keys(state).find((k) => /powerSwitch/i.test(k))
      if (powerKey && !(state[powerKey] || {}).value) { bot.muiSet(panel, powerKey, true); await sleep(200) }

      // 等产物：配方 dur 是 tick（20 tick = 1 秒），至少留 3 秒余量
      const expect = Math.max(3000, ((recipe.dur || 20) / 20) * 1000 * Math.ceil(o.count / Math.max(1, (recipe.out || [{}])[0]?.count || 1)) + 3000)
      const limit = Math.min(o.timeoutMs, expect)
      const started = Date.now()
      let crafted = 0
      while (Date.now() - started < limit) {
        await sleep(500)
        const w = bot.currentWindow
        if (!w) break
        let hit = -1
        for (let i = 0; i < machineSlotCount(bot); i++) if (sameOut(w.slots[i])) { hit = i; break }
        if (hit >= 0) { crafted = w.slots[hit].count || 1; outIndex = hit; break }
      }
      if (!crafted) {
        const snap = bot.currentWindow ? bot.currentWindow.slots.slice(0, machineSlotCount(bot)).map((x) => (x ? `${x.name}:${x.metadata}x${x.count}` : '-')) : []
        await bot.closeWindow(bot.currentWindow)
        const pwr = powerSourcesNear(bot, block)
        const why = pwr.length ? '' : '，机器周围没有电线/电池，八成没电'
        tried.push({ name: info.name, panel, reason: `等了 ${Math.round((Date.now() - started) / 1000)}s 没出产物（机器槽：${snap.join(' ')}）${why}` })
        continue
      }

      // 取件
      await bot.clickWindow(outIndex >= 0 ? outIndex : MACHINE_SLOTS.out, 0, 0)
      const empty = firstEmptyInv(bot.currentWindow)
      if (empty > 0) await bot.clickWindow(empty, 0, 0)
      await bot.closeWindow(bot.currentWindow)
      return { ok: true, crafted, ...plan }
    } catch (e) {
      try { if (bot.currentWindow) await bot.closeWindow(bot.currentWindow) } catch (_) {}
      tried.push({ name: block && block.name, reason: e.message })
    }
  }
  return { ok: false, reason: '没有机器能跑这个配方', tried }
}

// 机器周围有没有供电的东西（电线/电池/发电机）。
// 实测：合金炉不接电也能「开机」（powerSwitch=true、powerfail=false），但进度永远不动，
// 超时报「没出产物」看不出原因，所以这里主动查一下。
function powerSourcesNear (bot, block) {
  if (!block || !block.position) return []
  const out = []
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dy && !dz) continue
        const b = bot.blockAt(block.position.offset(dx, dy, dz))
        if (b && /cable|wire|battery|generator|solar|turbine|dynamo|transformer|energy/i.test(b.name || '')) out.push(b.name)
      }
    }
  }
  return out
}

// 机器槽的数量 = 玩家区起点（inventoryStart），没有就按 36 槽背包兜底
function machineSlotCount (bot) {
  const win = bot.currentWindow
  if (!win) return 0
  return win.inventoryStart == null ? Math.max(0, win.slots.length - 36) : win.inventoryStart
}

function candidatesIn (bot, at, radius) {
  const out = []
  const base = at || bot.entity.position
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const b = bot.blockAt(base.offset(dx, dy, dz))
        if (!b) continue
        if (/blockmachines/.test(b.name || '')) out.push({ block: b })
      }
    }
  }
  return out
}

function attachMachineCraft (bot) {
  bot.machineCraft = (opts) => machineCraft(bot, opts)
}

module.exports = { machineCraft, attachMachineCraft, approachForGui, parsePanel, mapForMachine, probeSlots, powerSourcesNear, MACHINE_SLOTS }
