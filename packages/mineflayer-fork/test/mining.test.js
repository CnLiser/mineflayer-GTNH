const { test } = require('node:test')
const assert = require('node:assert')
const { resolveBlock, blockIdsFor, collectDrops, mineBlock } = require('../lib/gtnh/mining')

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

test('collectDrops 认 1.7.10 的 Item（大写）实体名', async () => {
  // 实测出来的坑：服务端把掉落物实体叫 `Item`，上游 mcdata 叫 `item`，
  // 严格相等会让 bot 站在三个掉落物中间却一个也捡不到。
  const visited = []
  const bot = {
    entity: { position: { distanceTo: () => 0 } },
    entities: {
      1: { name: 'Item', position: { x: 1, y: 1, z: 1, distanceTo: () => 1 } },
      2: { name: 'zeppelin', position: { x: 90, y: 1, z: 90, distanceTo: () => 120 } }
    },
    goto: async (pos) => { visited.push(pos) }
  }
  const picked = await collectDrops(bot, { collectMs: 900, collectRadius: 5 })
  assert.ok(visited.length >= 1)
  assert.ok(picked >= 1)
})

test('挖不动（服务端不退 blockUpdate）时 mineBlock 返回 false，不会挂住', async () => {
  const block = { name: 'minecraft:coal_ore', position: { x: 0, y: 0, z: 0, distanceTo: () => 1, offset: () => ({ distanceTo: () => 1 }) }, boundingBox: 'block' }
  const bot = {
    entity: { position: { distanceTo: () => 1 } },
    blockAt: () => block,
    dig: () => new Promise(() => {}),   // 永不返回
    canDigBlock: () => true
  }
  const started = Date.now()
  const ok = await mineBlock(bot, block, { digTimeoutMs: 300 })
  assert.equal(ok, false)
  assert.ok(Date.now() - started < 2000)
})

test('走不过去但还在 5 格内，仍然尝试挖', async () => {
  const block = { name: 'minecraft:coal_ore', position: { x: 4, y: 0, z: 0, offset: () => ({ distanceTo: () => 4 }) }, boundingBox: 'block' }
  let dug = false
  const bot = {
    entity: { position: { distanceTo: () => 4 } },
    blockAt: () => block,
    dig: async () => { dug = true },
    goto: async () => false
  }
  assert.equal(await mineBlock(bot, block, { digTimeoutMs: 500 }), true)
  assert.equal(dug, true)
})
