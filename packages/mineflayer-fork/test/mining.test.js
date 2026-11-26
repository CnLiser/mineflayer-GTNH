const { test } = require('node:test')
const assert = require('node:assert')
const { resolveBlock, blockIdsFor, collectDrops } = require('../lib/gtnh/mining')

const registry = {
  blocks: { 16: { id: 16, name: 'coal_ore' } },
  blocksByName: {
    coal_ore: { id: 16, name: 'coal_ore' },
    stone: { id: 1, name: 'stone' }
  }
}

test('resolveBlock 收带前缀和不带前缀的名字，也收 id', () => {
  assert.equal(resolveBlock({ registry }, 'coal_ore').id, 16)
  assert.equal(resolveBlock({ registry }, 'minecraft:coal_ore').id, 16)
  assert.equal(resolveBlock({ registry }, 16).name, 'coal_ore')
  assert.equal(resolveBlock({ registry }, 'no_such_block'), null)
})

test('blockIdsFor 把名字数组变成 id 列表，未知名字跳过', () => {
  assert.deepEqual(blockIdsFor({ registry }, ['minecraft:coal_ore', 'stone', 'nope']), [16, 1])
  assert.deepEqual(blockIdsFor({ registry }, 'nope'), [])
})

test('collectDrops 会朝掉落物走过去，捡完返回', async () => {
  const visited = []
  const bot = {
    entity: { position: { distanceTo: () => 0 } },
    entities: {
      1: { name: 'item', position: { x: 1, y: 1, z: 1, distanceTo: () => 2 } },
      2: { name: 'zombie', position: { x: 5, y: 1, z: 5, distanceTo: () => 9 } }
    },
    goto: async (pos) => { visited.push(pos); }
  }
  // 第一次循环走到掉落物，第二次掉落物仍在（模拟假 bot 没回收实体）
  const picked = await collectDrops(bot, { collectMs: 1200, collectRadius: 5 })
  assert.ok(visited.length >= 1)
  assert.ok(picked >= 1)
})
