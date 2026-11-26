'use strict'

// 容器窗口：1.7.10 的 open_window 只带数字 inventoryType，布局必须自己翻。
// 原 packages/mineflayer-gtnh/test/window.test.js，归档后改成用离线 bot 驱动 fork 插件。

const test = require('node:test')
const assert = require('node:assert')

const { createOfflineBot, emptyInventoryItems, item } = require('./helpers/offline-bot')

function openChest (client, windowId = 1, slotCount = 63) {
  client.emit('open_window', { windowId, inventoryType: 0, windowTitle: '{"text":"Chest"}', slotCount })
}

test('open_window 数字类型 0 → 箱子窗口，27 个容器格 + 36 个玩家格', async () => {
  const { bot, client } = await createOfflineBot()
  openChest(client)
  assert.equal(bot.currentWindow.id, 1)
  assert.equal(bot.currentWindow.type, 'minecraft:chest')
  assert.equal(bot.currentWindow.slots.length, 63)
  assert.equal(bot.currentWindow.inventoryStart, 27)
  assert.equal(bot.currentWindow.hotbarStart, 54)
})

test('数字类型 1 → 工作台（46 槽，结果格 0）', async () => {
  const { bot, client } = await createOfflineBot()
  client.emit('open_window', { windowId: 1, inventoryType: 1, windowTitle: '{"text":"Crafting"}', slotCount: 46 })
  assert.equal(bot.currentWindow.type, 'minecraft:crafting_table')
  assert.equal(bot.currentWindow.slots.length, 46)
  assert.equal(bot.currentWindow.inventoryStart, 10)
  assert.equal(bot.currentWindow.craftingResultSlot, 0)
})

test('数字类型 2 → 熔炉（3 + 36 槽）', async () => {
  const { bot, client } = await createOfflineBot()
  client.emit('open_window', { windowId: 1, inventoryType: 2, windowTitle: '{"text":"Furnace"}', slotCount: 39 })
  assert.equal(bot.currentWindow.type, 'minecraft:furnace')
  assert.equal(bot.currentWindow.slots.length, 39)
  assert.equal(bot.currentWindow.inventoryStart, 3)
})

test('window_items 只填当前窗口，不污染背包', async () => {
  const { bot, client } = await createOfflineBot()
  openChest(client)
  const items = emptyInventoryItems(63)
  items[0] = item(1, 5)
  items[27] = item(4, 2) // 玩家区第一格（容器窗口里的槽位 27）
  client.emit('window_items', { windowId: 1, items })

  assert.equal(bot.currentWindow.slots[0].name, 'stone')
  assert.equal(bot.currentWindow.slots[27].name, 'cobblestone')
  assert.equal(bot.inventory.slots[0], null, '窗口的 window_items 不能写进背包槽 0')
})

test('窗口物品带注册名与数量，windowOpen 在数据到位后才触发', async () => {
  const { bot, client } = await createOfflineBot()
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve))
  openChest(client)
  const items = emptyInventoryItems(63)
  items[0] = item(1, 64)
  client.emit('window_items', { windowId: 1, items })

  const window = await opened
  assert.equal(window, bot.currentWindow)
  assert.equal(window.slots[0].name, 'stone')
  assert.equal(window.slots[0].count, 64)
  assert.equal(window.slots[0].displayName, 'Stone')
})

test('服务器 close_window → currentWindow 清空并触发 windowClose', async () => {
  const { bot, client } = await createOfflineBot()
  const opened = new Promise((resolve) => bot.once('windowOpen', resolve))
  const closed = new Promise((resolve) => bot.once('windowClose', resolve))
  openChest(client)
  client.emit('window_items', { windowId: 1, items: emptyInventoryItems(63) })
  await opened

  client.emit('close_window', { windowId: 1 })
  const old = await closed
  assert.equal(old.id, 1)
  assert.equal(bot.currentWindow, null)
})
