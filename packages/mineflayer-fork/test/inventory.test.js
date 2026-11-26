'use strict'

// 背包线格式（46 槽 / 副手 / 光标 / 点击）。原 packages/mineflayer-gtnh/test/inventory.test.js，
// 归档后改成用离线 bot 驱动 fork 的真实插件链。

const test = require('node:test')
const assert = require('node:assert')

const { createOfflineBot, emptyInventoryItems, item } = require('./helpers/offline-bot')

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('window_items 按 46 槽填背包（items 字段），副手槽 45 可见', async () => {
  const { bot, client } = await createOfflineBot()
  const items = emptyInventoryItems()
  items[36] = item(264, 3) // 快捷栏第 0 格
  items[45] = item(346) // 副手
  client.emit('window_items', { windowId: 0, items })

  assert.equal(bot.inventory.slots.length, 46, '1.7.10 + backhand 是 46 槽')
  assert.equal(bot.inventory.slots[36].name, 'diamond')
  assert.equal(bot.inventory.slots[36].count, 3)
  assert.equal(bot.inventory.slots[45].name, 'fishing_rod', '副手槽不能丢')
  assert.deepEqual(bot.inventory.items().map((it) => it.slot).sort((a, b) => a - b), [36, 45])
})

test('heldItem 跟着 quickBarSlot 走', async () => {
  const { bot, client } = await createOfflineBot()
  const items = emptyInventoryItems()
  items[36] = item(264) // 快捷栏 0
  items[37] = item(276) // 快捷栏 1：钻石剑
  client.emit('window_items', { windowId: 0, items })

  assert.equal(bot.heldItem.name, 'diamond', '默认选中快捷栏第 0 格')
  bot.setQuickBarSlot(1)
  assert.equal(bot.quickBarSlot, 1)
  assert.equal(bot.heldItem.name, 'diamond_sword')
})

test('set_slot：windowId -1 是光标，0 是背包槽位', async () => {
  const { bot, client } = await createOfflineBot()

  client.emit('set_slot', { windowId: -1, slot: -1, item: item(1, 5) })
  assert.equal(bot.inventory.selectedItem?.name, 'stone', '光标物品走 selectedItem')
  assert.equal(bot.inventory.slots[45], null, '光标不能写进副手槽')

  client.emit('set_slot', { windowId: 0, slot: 20, item: item(4) })
  assert.equal(bot.inventory.slots[20].name, 'cobblestone')
  assert.equal(bot.inventory.selectedItem.name, 'stone', '背包槽更新不动光标')
})

test('clickWindow 写 window_click：windowId / slot / 按钮 / 模式 / 物品', async () => {
  const { bot, client } = await createOfflineBot()
  const items = emptyInventoryItems()
  items[20] = item(4, 7)
  client.emit('window_items', { windowId: 0, items })

  const done = bot.clickWindow(20, 1, 0)
  await tick()
  const packet = client.lastWrite('window_click')
  assert.ok(packet, '必须真的发包')
  assert.equal(packet.windowId, 0)
  assert.equal(packet.slot, 20)
  assert.equal(packet.mouseButton, 1)
  assert.equal(packet.mode, 0)
  assert.equal(typeof packet.item, 'object', '1.7.10 的 window_click 带完整物品')

  client.emit('transaction', { windowId: 0, action: packet.action, accepted: true })
  await done
  assert.ok(bot.inventory.slots[20], '服务端确认后背包模型还在')
})

test('按槽位发窗口点击时默认用 currentWindow', async () => {
  const { bot, client } = await createOfflineBot()
  client.emit('open_window', { windowId: 2, inventoryType: 0, windowTitle: '{"text":"Chest"}', slotCount: 63 })
  const items = emptyInventoryItems(63)
  items[0] = item(1, 2)
  client.emit('window_items', { windowId: 2, items })
  assert.equal(bot.currentWindow.id, 2)

  const done = bot.clickWindow(0, 0, 0)
  await tick()
  assert.equal(client.lastWrite('window_click').windowId, 2, '开着的窗口优先')
  client.emit('transaction', { windowId: 2, action: client.lastWrite('window_click').action, accepted: true })
  await done
})
