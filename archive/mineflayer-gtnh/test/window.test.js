'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { Bot } = require('../src/index')
const { ModRegistry } = require('gtnh-data')

function makeBot () {
  const bot = new Bot({ host: '127.0.0.1', port: 1, username: 'test' })
  bot.writes = []
  bot.client = { write: (name, params) => bot.writes.push({ name, params }) }
  return bot
}

test('open_window 建立当前窗口，槽位数与窗口类型都记下来', () => {
  const bot = makeBot()
  const opened = []
  bot.on('windowOpen', (w) => opened.push(w))
  bot._onOpenWindow({ windowId: 3, inventoryType: 0, windowTitle: 'container.chest', useProvidedTitle: true, slotCount: 27 })

  assert.equal(opened.length, 1)
  assert.equal(bot.currentWindow.id, 3)
  assert.equal(bot.currentWindow.type, 0)
  assert.equal(bot.currentWindow.title, 'container.chest')
  assert.equal(bot.currentWindow.slots.length, 27)
  assert.equal(bot.currentWindow.slots.filter(Boolean).length, 0)
})

test('window_items 填进当前窗口，不污染玩家背包', () => {
  const bot = makeBot()
  bot._onOpenWindow({ windowId: 2, inventoryType: 1, windowTitle: 'Crafting', useProvidedTitle: true, slotCount: 9 })
  const items = new Array(9).fill({ blockId: -1 })
  items[0] = { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 }
  bot._onWindowItems({ windowId: 2, items })

  assert.equal(bot.currentWindow.slots[0].blockId, 6241)
  assert.equal(bot.currentWindow.slots[1], null)
  assert.equal(bot.inventory.slots.filter(Boolean).length, 0)
})

test('窗口里的 set_slot 只改窗口，背包的 set_slot 只改背包', () => {
  const bot = makeBot()
  bot._onOpenWindow({ windowId: 2, inventoryType: 2, windowTitle: 'container.furnace', useProvidedTitle: true, slotCount: 3 })

  bot._onSetSlot({ windowId: 2, slot: 1, item: { blockId: 1, itemCount: 3, itemDamage: 0, gtnhFlag: 1 } })
  assert.equal(bot.currentWindow.slots[1].blockId, 1)
  assert.equal(bot.inventory.slots[1], null)

  bot._onSetSlot({ windowId: 0, slot: 36, item: { blockId: 264, itemCount: 1, itemDamage: 0, gtnhFlag: 1 } })
  assert.equal(bot.inventory.slots[36].blockId, 264)
  assert.equal(bot.currentWindow.slots[36], undefined)
})

test('光标物品（windowId = -1）单独存', () => {
  const bot = makeBot()
  bot._onSetSlot({ windowId: -1, slot: -1, item: { blockId: 7, itemCount: 64, itemDamage: 0, gtnhFlag: 1 } })
  assert.equal(bot.inventory.cursor.blockId, 7)
  bot._onSetSlot({ windowId: -1, slot: -1, item: { blockId: -1 } })
  assert.equal(bot.inventory.cursor, null)
})

test('clickSlot 默认发给当前窗口，没有窗口时是 0 号', () => {
  const bot = makeBot()
  bot.clickSlot(36, { button: 0, mode: 0, item: null })
  assert.equal(bot.writes.at(-1).params.windowId, 0)

  bot._onOpenWindow({ windowId: 4, inventoryType: 0, windowTitle: 'chest', useProvidedTitle: true, slotCount: 27 })
  bot.clickSlot(0, { button: 1, mode: 0, item: { blockId: 1, itemCount: 1, itemDamage: 0, gtnhFlag: 1 } })
  const last = bot.writes.at(-1)
  assert.equal(last.name, 'window_click')
  assert.equal(last.params.windowId, 4)
  assert.equal(last.params.mouseButton, 1)
  assert.equal(last.params.item.blockId, 1)
})

test('closeWindow 发 close_window 并清掉当前窗口；服务器主动关也清', () => {
  const bot = makeBot()
  bot._onOpenWindow({ windowId: 5, inventoryType: 0, windowTitle: 'chest', useProvidedTitle: true, slotCount: 27 })
  assert.equal(bot.closeWindow(), true)
  assert.deepEqual(bot.writes.at(-1), { name: 'close_window', params: { windowId: 5 } })
  assert.equal(bot.currentWindow, null)
  assert.equal(bot.closeWindow(), false)

  bot._onOpenWindow({ windowId: 6, inventoryType: 0, windowTitle: 'chest', useProvidedTitle: true, slotCount: 27 })
  bot._onServerCloseWindow({ windowId: 6 })
  assert.equal(bot.currentWindow, null)
})

test('windowItems() 列窗口 + 背包里的物品，并带上注册名', () => {
  const bot = makeBot()
  bot.registry = ModRegistry.fromObject({
    blocks: { 6241: 'questbook:ItemQuestBook' },
    items: { 6241: 'questbook:ItemQuestBook', 1: 'minecraft:stone' }
  })
  bot._onOpenWindow({ windowId: 7, inventoryType: 0, windowTitle: 'chest', useProvidedTitle: true, slotCount: 27 })
  bot._onWindowItems({ windowId: 7, items: [{ blockId: 1, itemCount: 5, itemDamage: 0, gtnhFlag: 1 }, { blockId: -1 }] })
  bot._onSetSlot({ windowId: 0, slot: 36, item: { blockId: 6241, itemCount: 1, itemDamage: 0, gtnhFlag: 1 } })

  const items = bot.windowItems()
  assert.equal(items.length, 2)
  const chestItem = items.find((i) => i.where === 'window')
  assert.equal(chestItem.name, 'minecraft:stone')
  assert.equal(chestItem.itemCount, 5)
  const invItem = items.find((i) => i.where === 'inventory')
  assert.equal(invItem.name, 'questbook:ItemQuestBook')
  assert.equal(invItem.slot, 36)
})

test('activateBlock 发 block_place，方向按面换算', () => {
  const bot = makeBot()
  bot.activateBlock({ x: 10, y: 64, z: -3 }, { x: 0, y: 1, z: 0 })
  const place = bot.writes.find((w) => w.name === 'block_place')
  assert.deepEqual(place.params.location, { x: 10, y: 64, z: -3 })
  assert.equal(place.params.direction, 1)
  assert.equal(place.params.cursorY, 16)
  assert.equal(place.params.heldItem.blockId, -1) // 空手
})

test('每个维度一份 ChunkStore，切维度不会互相覆盖', () => {
  const bot = makeBot()
  const overworld = bot.worldFor(0)
  const nether = bot.worldFor(-1)
  assert.notEqual(overworld, nether)
  assert.equal(bot.world, overworld) // 当前维度是 0

  bot.dimension = -1
  assert.equal(bot._ensureWorld(), nether)
  assert.equal(bot.world, nether)
  assert.equal(bot.worldFor(0), overworld) // 原世界还在
})
