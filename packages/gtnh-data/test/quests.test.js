'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { loadQuests } = require('../src/quests')

const quests = loadQuests()

test('任务书：3814 条任务 / 46 条任务线', () => {
  assert.strictEqual(quests.total, 3814)
  assert.strictEqual(quests.lineList().length, 46)
})

test('任务线：按名字与 id 都能查', () => {
  const line = quests.lineByName('Mass Processing')
  assert.ok(line, '应该有 Mass Processing 这条线')
  assert.ok(quests.line(line.id))
  const list = quests.questsOfLine(line.id)
  assert.ok(list.length > 10, `这条线应该有任务，实际 ${list.length}`)
  assert.ok(list.every((q) => q.line === line.id))
})

test('任务：Shadow Metal 的要求与前置', () => {
  const hits = quests.byName('Shadow Metal')
  assert.strictEqual(hits.length, 1)
  const q = hits[0]
  assert.strictEqual(q.name, 'Shadow Metal')
  assert.ok(q.desc.includes('Shadow Metal'))
  assert.strictEqual(q.tasks.length, 2)
  const types = q.tasks.map((t) => t.type).sort()
  assert.deepStrictEqual(types, ['optional_retrieval', 'retrieval'])
  const main = q.tasks.find((t) => t.type === 'retrieval')
  assert.strictEqual(main.items[0].id, 'gregtech:gt.metaitem.01')
  assert.strictEqual(main.items[0].meta, 11368)
  assert.strictEqual(main.items[0].count, 9)
  assert.strictEqual(q.prereq.length, 2)
})

test('按物品反查：哪些任务要交它', () => {
  const list = quests.forItem('gregtech:gt.metaitem.01', 11368)
  assert.ok(list.length > 0)
  assert.ok(list.some((q) => q.name === 'Shadow Metal'))
})

test('前置链：从根到任务，自己排最后', () => {
  const q = quests.byName('Shadow Metal')[0]
  const chain = quests.chain(q.id)
  assert.ok(chain.length >= 1)
  assert.strictEqual(chain[chain.length - 1].id, q.id)
  // 链上每个的前置都在它前面
  const seen = new Set()
  for (const c of chain) {
    for (const p of c.prereq) {
      if (chain.some((x) => x.id === p)) assert.ok(seen.has(p), `${p} 应该出现在 ${c.name} 之前`)
    }
    seen.add(c.id)
  }
})

test('背包能交：材料齐了才算 ready', () => {
  const q = quests.byName('Shadow Metal')[0]
  const inv = [
    { id: 'TaintedMagic:BlockShadowOre', meta: 0, count: 6 },
    { id: 'gregtech:gt.metaitem.01', meta: 11368, count: 9 }
  ]
  const r = quests.check(q.id, inv)
  assert.strictEqual(r.ready, true, JSON.stringify(r.missing))
  assert.deepStrictEqual(r.missing, [])

  const ready = quests.readyWith(inv)
  assert.ok(ready.some((x) => x.id === q.id))
})

test('背包能交：缺料时报缺多少', () => {
  const q = quests.byName('Shadow Metal')[0]
  const inv = [{ id: 'gregtech:gt.metaitem.01', meta: 11368, count: 4 }]
  const missing = quests.missingFor(q.id, inv)
  const ore = missing.find((m) => m.id === 'TaintedMagic:BlockShadowOre')
  const ingot = missing.find((m) => m.id === 'gregtech:gt.metaitem.01')
  assert.strictEqual(ore.need, 6)
  assert.strictEqual(ore.have, 0)
  assert.strictEqual(ingot.need, 9)
  assert.strictEqual(ingot.have, 4)
  assert.strictEqual(quests.check(q.id, inv).ready, false)
})

test('不能从背包判断的任务类型记为 unknown', () => {
  const checkbox = Object.values(quests.quests).find((q) => q.tasks.some((t) => t.type === 'checkbox'))
  assert.ok(checkbox)
  const r = quests.check(checkbox.id, [])
  assert.ok(r.unknown.includes('checkbox'))
})

test('概览：任务类型分布', () => {
  const s = quests.summary()
  assert.strictEqual(s.total, 3814)
  assert.strictEqual(s.byTask.retrieval, 3743)
  assert.ok(s.byTask.crafting > 0)
})

test('Count=0 的任务按「要一个」算，空背包不该有能交的任务', () => {
  const q = quests.byName('Speedy Berries')[0]
  assert.strictEqual(q.tasks[0].items[0].count, 1)
  assert.deepStrictEqual(quests.readyWith([]), [])
})
