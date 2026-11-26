'use strict'

// TConstruct 的静态数据挂到 bot 上：
//   bot.tconstruct            —— TConstructData 实例
//   bot.tconstructMaterial()  —— 按名字/id 查材料（耐久、挖掘速度、攻击、手柄倍率…）
//   bot.tconstructMaterials() —— 全部材料
//   bot.tconstructMelting()   —— 物品 → 熔炼流体与温度
//   bot.tconstructFuel()      —— 某种流体作为熔炉燃料的 power/duration
const { loadTConstruct } = require('gtnh-data')

function attachTconstruct (bot) {
  const data = loadTConstruct()
  bot.tconstruct = data

  bot.tconstructMaterial = (idOrName) => data.material(idOrName)
  bot.tconstructMaterials = () => data.materials()

  bot.tconstructMelting = (id, meta = 0) => data.meltingFor(id, meta)
  // 便利方法：按 ItemStack 一样形状的对象查（bot.items() 返回的条目就长这样）
  bot.tconstructMeltingFor = (item) => {
    if (!item) return null
    return data.meltingFor(item.id, item.meta === undefined ? item.damage : item.meta)
  }

  bot.tconstructFuel = (fluid) => data.fuel(fluid)
  bot.tconstructFuels = () => data.fuels()
  bot.tconstructToolSpeed = (idOrName) => data.toolSpeed(idOrName)
  bot.tconstructBowMaterial = (idOrName) => data.bowMaterial(idOrName)

  // ---- TiC 工具：从 NBT 里读出材料，算真实挖掘耗时 ----
  // tool: bot.heldItem 那样的 ItemStack（需要带 nbt）
  bot.tconstructToolInfo = (tool) => {
    const infi = tool && tool.nbt && tool.nbt.value && tool.nbt.value.InfiTool
    if (!infi || !infi.value) return null
    const pick = (k) => {
      const v = infi.value[k]
      if (!v) return undefined
      const raw = v.value
      return Array.isArray(raw) ? raw[raw.length - 1] : raw
    }
    const head = pick('Head')
    const mat = head === undefined ? null : data.material(head)
    return {
      head,
      handle: pick('Handle'),
      harvestLevel: pick('HarvestLevel'),
      durability: pick('BaseDurability'),
      attack: pick('BaseAttack'),
      broken: pick('Broken') === 1,
      material: mat,
      speed: mat ? (mat.miningSpeed === undefined ? mat.miningspeed : mat.miningSpeed) / 100 : 1
    }
  }

  // 1.7.10 的手挖公式：t = hardness * (canHarvest ? 1.5 : 5) / speed
  // 原版 harvestTools 里是镐的物品 id，换算成「需要的最低镐等级」
  const PICK_TIER = { 270: 0, 285: 0, 271: 1, 257: 2, 258: 3 }
  bot.tconDigTime = (block, tool = bot.heldItem) => {
    const info = bot.tconstructToolInfo(tool)
    if (!info || info.broken) return null
    const hard = (block && block.hardness) || 0
    if (hard <= 0) return 0
    let need = 0
    if (block && block.harvestTools) {
      const tiers = Object.keys(block.harvestTools).map(Number).filter((id) => PICK_TIER[id] !== undefined).map((id) => PICK_TIER[id])
      if (tiers.length) need = Math.min(...tiers)
    }
    const canHarvest = (info.harvestLevel || 0) >= need
    return (hard * (canHarvest ? 1.5 : 5)) / info.speed
  }

  return data
}

module.exports = { attachTconstruct }
