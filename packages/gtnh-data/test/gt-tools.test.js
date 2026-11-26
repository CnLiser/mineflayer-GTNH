const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const { gtToolKind, gtToolName, gtToolsOfKind, loadGtTools, GT_TOOLS_FILE } = require('../src/gt-tools')

test('数据文件存在且覆盖 GT 的 27 个多用途工具', () => {
  assert.ok(fs.existsSync(GT_TOOLS_FILE))
  const data = loadGtTools()
  assert.equal(data.count, 27)
  assert.equal(data.byItem.get('gregtech:gt.metatool.01').size, 27)
})

test('按 damage 认工具类型：16 扳手、26 剪线钳、12 锤', () => {
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 16), 'wrench')
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 26), 'cutter')
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 12), 'hammer')
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 10), 'saw')
})

test('表外 damage 和表外物品返回 null', () => {
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 0), null)
  assert.equal(gtToolKind('gregtech:gt.metatool.01', 999), null)
  assert.equal(gtToolKind('minecraft:diamond_pickaxe', 0), null)
})

test('名字有中英两套', () => {
  assert.equal(gtToolName('gregtech:gt.metatool.01', 16), 'Wrench')
  assert.equal(gtToolName('gregtech:gt.metatool.01', 16, 'zh'), '扳手')
  assert.equal(gtToolName('gregtech:gt.metatool.01', 26), 'Wire Cutter')
  assert.equal(gtToolName('nope', 0), null)
})

test('按种类反查：扳手只有一把，多功能工具是一组', () => {
  assert.deepEqual(gtToolsOfKind('wrench').map((t) => t.dmg), [16])
  assert.ok(gtToolsOfKind('multitool').length >= 6)
})
