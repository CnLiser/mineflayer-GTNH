#!/usr/bin/env node
'use strict'

/*
 * 离线查配方——不需要服务端，只用仓库里的数据文件。
 *
 *   node examples/recipes.js
 *   node examples/recipes.js 7640 32577      # 查某个物品（id + metadata）
 *
 * 三个数据源：
 *   GT 机器配方     175689 条  gt-recipes.jsonl.gz   （按输出/输入/流体查）
 *   其它 mod 配方    8906 条   mod-recipes.json      （17 个 mod；含没有物品 id 的物种配方）
 *   原版 + 矿辞      10233 条  crafting.json / smelting.json / oredict.json
 */

const { loadGtRecipes, loadModRecipes, loadRecipeBook } = require('gtnh-data')

const gt = loadGtRecipes()
const mods = loadModRecipes()
const vanilla = loadRecipeBook()

console.log('数据规模')
console.log('  GT 机器配方：', gt.summary())
const ms = mods.summary()
console.log(`  其它 mod 配方：${ms.total} 条 / ${ms.mods.length} 个 mod`)
console.log('  原版合成/熔炉：', vanilla.crafting.length, '/', Object.keys(vanilla.smelting).length)

const [id, meta] = process.argv.slice(2).map(Number)
if (!Number.isFinite(id)) {
  console.log('\n用法：node examples/recipes.js <itemId> [metadata]')
  console.log('例：node examples/recipes.js 7640 32577   # 一个 GT 物品')
  console.log('\nGT 配方图（136 个）：')
  for (const name of gt.mapNames().slice(0, 12)) console.log('  ', name, gt.countFor(name))
  process.exit(0)
}

const fmtStack = (s) => `${s.name ?? `#${s.id}`}${s.meta ? `:${s.meta}` : ''} x${s.count}`

console.log(`\n== 物品 ${id}:${meta ?? 0} 的配方 ==`)
const gtOut = gt.forOutput(id, meta ?? 0)
console.log(`\nGT 机器（${gtOut.length} 条）`)
for (const r of gtOut.slice(0, 5)) {
  console.log(`  [${r.map}] ${r.eu} EU/t × ${r.dur}t`)
  console.log('    入：', r.in.map(fmtStack).join(', ') || '（无）')
  console.log('    出：', r.out.map(fmtStack).join(', '))
}

const modOut = mods.byOutput(id, meta ?? 0)
console.log(`\n其它 mod（${modOut.length} 条）`)
for (const r of modOut.slice(0, 5)) {
  console.log(`  [${r.mod}:${r.kind}] 出：${r.out.map(fmtStack).join(', ')}`)
  console.log('    入：', r.ins.map((cell) => cell.map(fmtStack).join(' | ')).join(' ; '))
}

const vanillaOut = vanilla.craftingFor(id, meta ?? 0)
console.log(`\n原版工作台（${vanillaOut.length} 条）`)
for (const r of vanillaOut.slice(0, 5)) {
  console.log('  入：', r.ingredients.map((cell) => cell.map(fmtStack).join('|')).join(' '))
}

console.log('\n提示：物种配方（没有物品 id）用 mods.forSpecies(\'Arid\')，例如')
console.log('  ', JSON.stringify(mods.forSpecies('Arid')[0]).slice(0, 160), '…')
