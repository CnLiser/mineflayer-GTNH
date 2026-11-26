'use strict'

/*
 * 背包状态机的离线测试：不连服，直接把服务器会发的包喂给 Bot。
 *
 * 覆盖 GTNH 的三个差异点：
 *   - 窗口 0 是 46 个槽位（Backhand 副手槽）；
 *   - window_items 的字段名是 items；
 *   - 物品 id 4 字节、非空物品带尾字节 gtnhFlag（由 protocol-fml 解码，这里只验证状态机）。
 */

const test = require('node:test')
const assert = require('node:assert')
const { Bot } = require('../src')

function makeBot () {
  const bot = new Bot({ username: 'tester' })
  bot.writes = []
  bot.client = { write: (name, params) => bot.writes.push({ name, params }) }
  return bot
}

const book = { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 }

test('window_items: 46 个槽位，读取 items 字段', () => {
  const bot = makeBot()
  const items = new Array(46).fill({ blockId: -1 })
  items[36] = book
  bot._onWindowItems({ windowId: 0, items })
  assert.strictEqual(bot.inventory.slots.length, 46)
  assert.deepStrictEqual(bot.inventory.slots[36], book)
  assert.strictEqual(bot.inventory.slots[0], null)
  assert.deepStrictEqual(bot.items().map((i) => i.slot), [36])
})

test('set_slot: windowId=-1 是光标，windowId=0 是槽位', () => {
  const bot = makeBot()
  bot._onSetSlot({ windowId: -1, slot: -1, item: book })
  assert.deepStrictEqual(bot.inventory.cursor, book)

  bot._onSetSlot({ windowId: 0, slot: 37, item: book })
  assert.deepStrictEqual(bot.inventory.slots[37], book)

  // 空槽：blockId = -1 归一化成 null
  bot._onSetSlot({ windowId: 0, slot: 37, item: { blockId: -1 } })
  assert.strictEqual(bot.inventory.slots[37], null)
})

test('pickUp/placeAt: 写 window_click 并乐观更新本地状态', () => {
  const bot = makeBot()
  bot._onWindowItems({ windowId: 0, items: new Array(46).fill({ blockId: -1 }).map((x, i) => (i === 36 ? book : x)) })

  bot.pickUp(36)
  assert.strictEqual(bot.writes.length, 1)
  assert.strictEqual(bot.writes[0].name, 'window_click')
  assert.deepStrictEqual(bot.writes[0].params, {
    windowId: 0, slot: 36, mouseButton: 0, action: 1, mode: 0, item: book
  })
  assert.deepStrictEqual(bot.inventory.cursor, book)
  assert.strictEqual(bot.inventory.slots[36], null)

  bot.placeAt(37)
  assert.strictEqual(bot.writes[1].params.action, 2)
  assert.deepStrictEqual(bot.writes[1].params.item, book)
  assert.deepStrictEqual(bot.inventory.slots[37], book)
  assert.strictEqual(bot.inventory.cursor, null)
})

test('heldItem: 快捷栏 36-44 跟随 selectedSlot', () => {
  const bot = makeBot()
  const items = new Array(46).fill({ blockId: -1 })
  items[38] = { blockId: 264, itemCount: 1, itemDamage: 7, gtnhFlag: 1 }
  bot._onWindowItems({ windowId: 0, items })
  bot.client.write = () => {}
  bot.setQuickBarSlot(2)
  assert.strictEqual(bot.inventory.selectedSlot, 2)
  assert.strictEqual(bot.heldItem.blockId, 264)
})

test('transaction: 记录服务器是否接受点击', () => {
  const bot = makeBot()
  const seen = []
  bot.on('transaction', (p) => seen.push(p))
  bot._onTransaction({ windowId: 0, action: 7, accepted: true })
  assert.deepStrictEqual(bot.inventory.lastAcceptedAction, { action: 7, accepted: true })
  assert.strictEqual(seen.length, 1)
})
