'use strict'

// tools/quest-demo.js 的纯函数部分：从任务计划反推场地里要摆什么方块。
const test = require('node:test')
const assert = require('node:assert')
const { blocksToPlace } = require('../tools/quest-demo')

test('挖 11 个 dirt 就摆 13 个（多两个当容错）', () => {
  const plan = { steps: [{ kind: 'mine', item: 'minecraft:dirt', meta: 0, count: 11, block: 'dirt' }] }
  assert.deepStrictEqual(blocksToPlace(plan), [{ block: 'dirt', count: 13 }])
})

test('合成的步骤不摆方块，只摆挖的', () => {
  const plan = {
    steps: [
      { kind: 'mine', item: 'log', meta: 0, count: 3, block: 'log' },
      { kind: 'craft', item: 'minecraft:stick', meta: 0, count: 2, inputs: [] },
    ],
  }
  assert.deepStrictEqual(blocksToPlace(plan), [{ block: 'log', count: 5 }])
})

test('实际的任务计划能反推出 dirt', () => {
  const { createOfflineBot } = require('./helpers/offline-bot')
  return createOfflineBot({ username: 'demoplan' }).then(({ bot }) => {
    const plan = bot.questSteps('Your First Night')
    const list = blocksToPlace(plan)
    assert.strictEqual(list.length, 1)
    assert.strictEqual(list[0].block, 'dirt')
    assert.ok(list[0].count >= 11)
    bot.end()
  })
})
