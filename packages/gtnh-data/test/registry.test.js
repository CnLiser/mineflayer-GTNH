'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { ModRegistry, Lang } = require('../index')

const sample = {
  host: '127.0.0.1',
  port: 54615,
  mods: 296,
  blocks: {
    0: 'minecraft:air',
    1: 'minecraft:stone',
    7: 'minecraft:bedrock',
    12: 'minecraft:sand',
    4096: 'gregtech:gt.blockmachines',
    11298: 'ProjRed|Exploration:projectred.exploration.lily'
  },
  items: { 1: 'minecraft:stone', 30205: 'gregtech:gt.metaitem.01' }
}

test('ModRegistry：按 id 查名字、按名字查 id', () => {
  const reg = ModRegistry.fromObject(sample)
  assert.strictEqual(reg.blockName(7), 'minecraft:bedrock')
  assert.strictEqual(reg.blockName(999), undefined)
  assert.strictEqual(reg.blockId('minecraft:sand'), 12)
  assert.strictEqual(reg.itemName(30205), 'gregtech:gt.metaitem.01')
  assert.strictEqual(reg.hasBlock(11298), true)
  assert.deepStrictEqual(reg.summary(), { blocks: 6, items: 2, blockIdRange: [0, 11298], mods: 296 })
})

test('ModRegistry：名字带 :meta 后缀时能拆开', () => {
  const reg = ModRegistry.fromObject(sample)
  assert.deepStrictEqual(reg.parseBlockName('minecraft:stone:1'), { id: 1, metadata: 1 })
  assert.deepStrictEqual(reg.parseBlockName('minecraft:stone'), { id: 1, metadata: 0 })
  assert.strictEqual(reg.parseBlockName('nope:nothing'), null)
})

test('ModRegistry：同名多 id 时保留最小的', () => {
  const reg = ModRegistry.fromObject({ blocks: { 5: 'a:b', 3: 'a:b' } })
  assert.strictEqual(reg.blockId('a:b'), 3)
  assert.strictEqual(reg.blockName(5), 'a:b')
})

test('Lang：方块/物品的显示名（中文优先）', () => {
  const lang = new Lang({
    en: { 'tile.stone.name': 'Stone', 'item.stone.name': 'Stone', 'tile.gt.blockmachines.name': 'Machine Block' },
    zh: { 'tile.stone.name': '石头', 'tile.gt.blockmachines.name': '机器方块' }
  })
  assert.strictEqual(lang.blockName('minecraft:stone'), '石头')
  assert.strictEqual(lang.blockName('gregtech:gt.blockmachines'), '机器方块')
  // 没有中文时回落英文
  assert.strictEqual(lang.key('item.stone.name'), 'Stone')
  assert.strictEqual(lang.itemName('minecraft:stone'), 'Stone')
  // 查不到就返回注册名本身
  assert.strictEqual(lang.blockName('foo:bar'), 'foo:bar')
  assert.deepStrictEqual(lang.size, { en: 3, zh: 2 })
})
