'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { attachTconstruct } = require('../lib/gtnh/tconstruct')

function fakeBot () {
  return {}
}

test('fork：TConstruct 数据挂到 bot 上', () => {
  const bot = fakeBot()
  attachTconstruct(bot)
  assert.ok(bot.tconstruct)
  assert.strictEqual(bot.tconstructMaterials().length, 184)
  assert.strictEqual(bot.tconstructMaterial('manyullyn').durability, 900)
  assert.strictEqual(bot.tconstructToolSpeed('manyullyn'), 9)
})

test('fork：熔炼与燃料查询', () => {
  const bot = fakeBot()
  attachTconstruct(bot)
  const m = bot.tconstructMelting(3034, 4019)
  assert.strictEqual(m.temp, 400)
  assert.strictEqual(m.fluid, 'aluminum.molten')
  // 也接受 {id, damage} 形状（bot.items() 里的条目）
  assert.strictEqual(bot.tconstructMeltingFor({ id: 3034, meta: 4019 }).temp, 400)
  assert.strictEqual(bot.tconstructMeltingFor({ id: 3034, damage: 4019 }).temp, 400)
  assert.strictEqual(bot.tconstructMeltingFor(null), null)
  assert.strictEqual(bot.tconstructFuel('lava').power, 1300)
  assert.strictEqual(bot.tconstructFuels().length, 4)
})

test('fork：弓材料与不存在的材料', () => {
  const bot = fakeBot()
  attachTconstruct(bot)
  assert.ok(bot.tconstructBowMaterial('wood'))
  assert.strictEqual(bot.tconstructMaterial('nope'), null)
  assert.strictEqual(bot.tconstructMelting(999999, 0), null)
})

// TiC 工具：从 NBT 读材料 + 按材料算挖掘耗时
function toolStack (infi) {
  return { name: 'TConstruct:pickaxe', nbt: { type: 'compound', name: '', value: { InfiTool: { type: 'compound', value: infi } } } }
}
const int = (v) => ({ type: 'int', value: v })

test('fork：工具 NBT → 材料与挖掘速度', () => {
  const bot = fakeBot()
  attachTconstruct(bot)
  const pick = bot.tconstructToolInfo(toolStack({ Head: int(3), Handle: int(0), HarvestLevel: int(1), BaseDurability: int(113), BaseAttack: int(3) }))
  assert.strictEqual(pick.head, 3)
  assert.strictEqual(pick.material.name, 'Flint')
  assert.strictEqual(pick.speed, 4) // miningspeed 400 / 100
  assert.strictEqual(pick.durability, 113)
  assert.strictEqual(bot.tconstructToolInfo({ nbt: null }), null)
  assert.strictEqual(bot.tconstructToolInfo(null), null)
})

test('fork：tconDigTime 用材料速度代替原版挖速', () => {
  const bot = fakeBot()
  attachTconstruct(bot)
  const pick = toolStack({ Head: int(3), HarvestLevel: int(1) })
  // 石头 hardness 1.5、需要镐（harvestTools 里有），flint 等级 1 → 可采
  const stone = { name: 'minecraft:stone', hardness: 1.5, harvestTools: { 270: true, 271: true, 257: true, 258: true } }
  assert.strictEqual(bot.tconDigTime(stone, pick), (1.5 * 1.5) / 4)
  // 不可采 → 5 倍惩罚
  const diamondOre = { name: 'minecraft:diamond_ore', hardness: 3, harvestTools: { 257: true, 258: true } }
  assert.strictEqual(bot.tconDigTime(diamondOre, pick), (3 * 5) / 4)
  // 黑曜石锤等级 5，可以采钻石矿
  const hammer = toolStack({ Head: int(6), HarvestLevel: int(5) })
  assert.strictEqual(bot.tconDigTime({ name: 'minecraft:obsidian', hardness: 50, harvestTools: { 257: true, 258: true } }, hammer), (50 * 1.5) / 6.5)
  // 空手 / 坏工具 → null
  assert.strictEqual(bot.tconDigTime(stone, null), null)
  assert.strictEqual(bot.tconDigTime(stone, toolStack({ Head: int(3), Broken: { type: 'byte', value: 1 } })), null)
})
