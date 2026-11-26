// GTNH-PATCH: GT 单方块机器（extruder 等）的电压校验、配方匹配与 GUI 投料/取件
// 依据：gregtech BasicMachine GUI 槽序 = [输入1, 形状1, 输入2, 形状2, 输出]
// 以及 GT 容器的窗口布局（机器槽在前，玩家快捷栏紧接其后，主背包在后）

const VOLTAGES = [8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608]
const TIER_NAMES = ['ULV', 'LV', 'MV', 'HV', 'EV', 'IV', 'LuV', 'ZPM', 'UV', 'UHV', 'UEV']

// 3003 方块机器：damage -> 电压等级（extruder 系列 281..285 = LV..IV）
const KNOWN_MACHINES = {
  281: { name: 'extruder', tier: 'LV', slots: { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 } },
  282: { name: 'extruder', tier: 'MV', slots: { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 } },
  283: { name: 'extruder', tier: 'HV', slots: { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 } },
  284: { name: 'extruder', tier: 'EV', slots: { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 } },
  285: { name: 'extruder', tier: 'IV', slots: { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 } }
}

const tierIndex = (name) => TIER_NAMES.indexOf(String(name).toUpperCase())
const tierVoltage = (name) => VOLTAGES[tierIndex(name)]

// 配方需要的最低电压等级（取能覆盖 eu/t 的最小档）
function recipeTier (euPerTick) {
  for (let i = 0; i < VOLTAGES.length; i++) if (euPerTick <= VOLTAGES[i]) return i
  return VOLTAGES.length - 1
}

// 机器能否跑这条配方：机器档位 >= 配方档位，且配方 eu/t 不超过机器最大 EU/t
function canRun (recipe, machineTier) {
  const mi = tierIndex(machineTier)
  if (mi < 0) return { ok: false, reason: `unknown tier ${machineTier}` }
  const eu = Number(recipe && recipe.eu) || 0
  const needed = recipeTier(eu)
  if (mi < needed) {
    return { ok: false, reason: `需要 ${TIER_NAMES[needed]}（${VOLTAGES[needed]} EU/t），机器只有 ${machineTier}（${VOLTAGES[mi]} EU/t）`, neededTier: TIER_NAMES[needed] }
  }
  return { ok: true, euPerTick: eu, tier: TIER_NAMES[mi], neededTier: TIER_NAMES[needed] }
}

function machineInfo (damage) { return KNOWN_MACHINES[damage] || null }

// 在 GT 配方数据里找 extruder 配方：按产物 id/meta，或按「输入物品 + 形状 meta」
function findExtruderRecipes (gtRecipes, { output, input, shape } = {}) {
  const all = gtRecipes.forMap('gt.recipe.extruder')
  return all.filter(r => {
    if (output) {
      const ok = (r.out || []).some(o => o && o.id === output.id && (output.meta == null || o.meta === output.meta))
      if (!ok) return false
    }
    if (input) {
      const ok = (r.in || []).some(i => i && i.id === input.id && (input.meta == null || i.meta === input.meta))
      if (!ok) return false
    }
    if (shape != null) {
      const ok = (r.in || []).some(i => i && i.id === 4526 && i.meta === shape)
      if (!ok) return false
    }
    return true
  })
}

// GT 容器窗口：机器槽在前，快捷栏紧接其后（与 TiC 的「主背包在前」不同）
function gtnWindowSlots (window) {
  const inv = window.inventoryStart ?? 0
  return {
    hotbar: (invSlot) => inv + (invSlot - 36),
    main: (invSlot) => inv + invSlot,
    forInv: (invSlot) => (invSlot >= 36 ? inv + (invSlot - 36) : inv + invSlot)
  }
}

function readMachineSlots (window, info) {
  const s = (info && info.slots) || { in1: 0, shape1: 1, in2: 2, shape2: 3, out: 4 }
  const pick = (i) => window.slots[i] || null
  return { input1: pick(s.in1), shape1: pick(s.shape1), input2: pick(s.in2), shape2: pick(s.shape2), output: pick(s.out) }
}

module.exports = { VOLTAGES, TIER_NAMES, KNOWN_MACHINES, tierIndex, tierVoltage, recipeTier, canRun, machineInfo, findExtruderRecipes, gtnWindowSlots, readMachineSlots }
