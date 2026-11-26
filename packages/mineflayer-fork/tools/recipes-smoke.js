#!/usr/bin/env node
'use strict'
// 离线（不需要服务器）：验证 GTNH 矿辞 / 配方数据可用。
// 用法: node tools/recipes-smoke.js
const { loadRecipeBook, loadGtRecipes, loadModRecipes, WILDCARD } = require('gtnh-data')
const { toMineflayerRecipe } = require('../lib/gtnh/recipes')

const book = loadRecipeBook()
const s = book.summary()
console.log(`矿辞 ${s.oreNames} 条 / 合成配方 ${s.crafting} 条 / 熔炉配方 ${s.smelting} 条`)

let failed = 0
function check (name, cond) {
  console.log(`${cond ? '✓' : '✗'} ${name}`)
  if (!cond) failed++
}

check('矿辞条目 > 50000', s.oreNames > 50000)
check('合成配方 > 10000', s.crafting > 10000)
check('熔炉配方 > 9000', s.smelting > 9000)

const plank = book.ore('plankWood')
console.log(`  plankWood 含 ${plank.length} 种物品，前 3: ${JSON.stringify(plank.slice(0, 3))}`)
check('plankWood 非空', plank.length > 0)
check('plankWood 含通配 metadata', plank.some(([, m]) => m === WILDCARD))

const ingot = book.ore('ingotIron')
check('ingotIron 非空', ingot.length > 0)

const ores = book.oresOf(5, 0)
console.log(`  物品 5:0(minecraft:planks) 属于矿辞: ${JSON.stringify(ores.slice(0, 4))}`)
check('反查 5:0 得到 plankWood', ores.includes('plankWood'))

const plankRecipes = book.craftingFor(5, 0)
console.log(`  产出 minecraft:planks(5:0) 的配方 ${plankRecipes.length} 条`)
check('planks 有配方', plankRecipes.length > 0)
if (plankRecipes.length) {
  const rec = toMineflayerRecipe(plankRecipes[0])
  console.log(`  第一条: 结果 ${JSON.stringify(rec.result)} 原料 ${JSON.stringify(rec.delta)} 需要工作台=${rec.requiresTable}`)
  check('配方转换出 delta', rec.delta.length > 0)
}

const smelt = book.smeltFor(15, 0)
console.log(`  熔炉 15:0(iron_ore) -> ${JSON.stringify(smelt)}`)
check('铁矿熔炼成铁锭', smelt && smelt.out[0] === 265)

const stone = book.smeltFor(4, 0)
check('圆石熔炼成石头', stone && stone.out[0] === 1)
check('未知物品无熔炉配方', book.smeltFor(99999, 0) === null)


// GT 机器/工具配方（NEI 里 GT 页面的来源）
const gt = loadGtRecipes()
const gs = gt.summary()
console.log(`GT 配方：${gs.maps} 个 RecipeMap / ${gs.recipes} 条配方`)
check('RecipeMap > 100 个', gs.maps > 100)
check('GT 配方 > 150000 条', gs.recipes > 150000)
check('研磨机配方 > 20000', gt.countFor('gt.recipe.macerator') > 20000)
check('用水的 GT 配方 > 1000', gt.forFluid('water').length > 1000)
const mac = gt.forMap('gt.recipe.macerator')[0]
console.log(`  研磨机样例: ${JSON.stringify(mac.in)} -> ${JSON.stringify(mac.out)} (${mac.dur}t, ${mac.eu}EU/t)`)

// 非 GT 的 mod 配方（Thaumcraft / Forestry / Railcraft / TConstruct / Botania / BloodMagic）
const modBook = loadModRecipes()
const ms = modBook.summary()
console.log(`mod 配方：${ms.total} 条（${Object.entries(ms.byMod).map(([k, v]) => k + ' ' + v).join(' / ')}）`)
check('mod 配方 > 5000 条', ms.total > 5000)
check('十五个 mod 都有配方', ms.mods.length === 15)
check('Botania 符文配方 47 条', modBook.byOutput(6079).length === 47)
check('TConstruct 熔炼 > 900', modBook.forKind('melting').length > 900)
check('Railcraft 焦炉 164 条', modBook.forKind('coke_oven').length === 164)
check('Blood Magic 祭坛 64 条', modBook.forKind('altar').length === 64)
check('矿辞 flowerWhite 有配方', modBook.byOre('flowerWhite').length > 0)
check('EnderIO SAG 磨粉 1663 条', modBook.forKind('sagmill').length === 1663)
check('Galacticraft 电路制造机 9 条', modBook.forKind('circuit_fabricator').length === 9)
check('Witchery 坩埚 38 条', modBook.forKind('kettle').length === 38)
check('Witchery 火盆 8 条', modBook.forKind('brazier').length === 8)
check('Witchery 酿造仪式 26 条', modBook.forKind('brew_ritual').length === 26)
check('TConstruct 浇筑台 1088 条', modBook.forKind('casting_table').length === 1088)
check('TConstruct 浇筑盆 16 条', modBook.forKind('casting_basin').length === 16)
check('TConstruct 工具组装 53 条', modBook.forKind('tool_build').length === 53)
check('Avaritia 极值合成 135 条', modBook.forKind('extreme_crafting').length === 135)
check('HarvestCraft 切菜板 51 条', modBook.forKind('cutting_board').length === 51)
check('HarvestCraft 烹饪锅 63 条', modBook.forKind('cooking_pot').length === 63)
check('WitchingGadgets 地狱高炉 51 条', modBook.forKind('infernal_blast_furnace').length === 51)
check('Et Futurum 锻造台 9 条', modBook.forKind('smithing_table').length === 9)

// TConstruct 静态数据（材料 / 熔炼 / 燃料）
const { loadTConstruct } = require('gtnh-data')
const tc = loadTConstruct()
const many = tc.material('manyullyn')
console.log('TConstruct：材料 ' + tc.summary().materials + ' 种，熔炼 ' + tc.summary().melting + ' 条，燃料 ' + tc.summary().fuels + ' 种')
console.log('  Manyullyn: 耐久 ' + many.durability + ' / 挖掘速度 ' + tc.toolSpeed(many) + ' / 攻击 ' + many.attack + ' / 采集等级 ' + many.harvestLevel)
const alu = tc.meltingFor(3034, 4019)
console.log('  铝矿熔炼: ' + alu.temp + 'K → ' + alu.fluid + ' x' + alu.amount + '（熔岩 ' + tc.fuel('lava').power + 'K 可熔）')
check('TConstruct 材料 >= 150 种', tc.summary().materials >= 150)
check('TConstruct 熔炼温度可查', alu.temp === 400)
check('TConstruct 熔岩燃料 power 1300', tc.fuel('lava').power === 1300)
check('Manyullyn 耐久 900', many.durability === 900)
check('AE2 压印器 12 条', modBook.forKind('inscriber').length === 12)
const sag = modBook.forKind('sagmill').find((r) => r.out.some((o) => o.name === 'gregtech:gt.metaitem.01'))
console.log(`  SAG 样例: ${JSON.stringify(sag.ins[0].map((a) => a.name))} -> ${JSON.stringify(sag.out.map((o) => o.id + ':' + o.meta))} (${sag.extra.energy} RF, 概率 ${JSON.stringify(sag.extra.chances)})`)
const insc = modBook.forKind('inscriber')[0]
console.log(`  压印器样例: ${JSON.stringify(insc.ins.map((c) => c.map((a) => a.name)))} -> ${JSON.stringify(insc.out.map((o) => o.id + ':' + o.meta))} (${insc.extra.process})`)
const rune = modBook.byOutput(6079)[0]
console.log(`  符文样例: ${JSON.stringify(rune.ins.map((c) => c.map((a) => a.ore || a.name)))} -> ${JSON.stringify(rune.out)} (mana ${rune.extra.mana})`)

console.log(failed ? `✗ 矿辞/配方冒烟失败 ${failed} 项` : '✓ 矿辞/配方冒烟通过')
process.exit(failed ? 1 : 0)
