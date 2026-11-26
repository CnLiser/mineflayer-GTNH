// GTNH 窗口构造与布局修正。
//
// GTNH-PATCH 的两个原因：
//
// 1. **1.7.10 的 open_window 只带数字 inventoryType**（0 箱子 / 1 工作台 / 2 熔炉 …）。
//    prismarine-windows 用类型名决定布局，喂给它数字就退回「通用容器」：
//    `createWindow(1, 1, 'Crafting', 46)` 会造出 82 个槽、inventoryStart=46，
//    点击全部错位。所以这里先把数字翻成它认识的名字。
//
// 2. **backhand 给玩家窗口加了副手槽**，1.7.10 的玩家窗口是 46 槽（原版 45）。
//    prismarine-windows 的 'minecraft:inventory' 是 45 槽、inventoryEnd=45，
//    服务端把物品塞进副手（45）时 `bot.inventory.items()` 看不见，
//    合成/拾取后会出现「服务端有、本地没有」的假丢包。

const PLAYER_INVENTORY_SLOTS = 46 // 1.7.10 + backhand：45 = 副手

// 1.7.10 的 inventoryType（NetworkRegistry 里的 id）
const TYPE_NAMES = {
  0: 'minecraft:chest',
  1: 'minecraft:crafting_table',
  2: 'minecraft:furnace',
  3: 'minecraft:dispenser',
  4: 'minecraft:enchanting_table',
  5: 'minecraft:brewing_stand',
  6: 'minecraft:villager',
  7: 'minecraft:beacon',
  8: 'minecraft:anvil',
  11: 'minecraft:horse'
}

// 容器窗口里「容器自己的槽数」= 总槽数 - 36（玩家格子固定 36 个，没有副手）
function windowTypeName (type, slotCount) {
  if (typeof type === 'string') return type
  const name = TYPE_NAMES[type]
  if (name === 'minecraft:chest') return name // 箱子按 storage 槽数传，见下
  return name || 'minecraft:chest'
}

function createGtnhWindow (windows, id, type, title, slotCount) {
  if (id !== 0) {
    const name = windowTypeName(type, slotCount)
    if (name === 'minecraft:chest') {
      // 箱子的 slotCount 含玩家 36 格，prismarine-windows 只吃 storage 槽数
      const storage = Math.max(9, slotCount - 36)
      return fixWindowLayout(windows.createWindow(id, name, title, storage), slotCount)
    }
    return fixWindowLayout(windows.createWindow(id, name, title, slotCount), slotCount)
  }
  return fixWindowLayout(windows.createWindow(id, 'minecraft:inventory', title), PLAYER_INVENTORY_SLOTS)
}

function fixWindowLayout (window, slotCount) {
  if (!window || !Array.isArray(window.slots)) return window
  const expected = slotCount || window.slots.length

  if (window.id === 0) {
    while (window.slots.length < PLAYER_INVENTORY_SLOTS) window.slots.push(null)
    window.inventoryStart = 9
    window.hotbarStart = 36
    window.inventoryEnd = 46
    window.craftingResultSlot = 0
    return window
  }

  // 容器窗口：容器格在前，36 个玩家格在后（容器窗口没有副手槽）
  if (expected > 36) {
    const containerSize = expected - 36
    window.inventoryStart = containerSize
    window.hotbarStart = containerSize + 27
    window.inventoryEnd = expected
    if (window.type === 'minecraft:crafting_table' || window.type === 1) {
      window.craftingResultSlot = 0
    }
  }
  return window
}

module.exports = { createGtnhWindow, fixWindowLayout, PLAYER_INVENTORY_SLOTS, TYPE_NAMES }
