'use strict'

// 1.7.10 + backhand 的窗口布局回归（布局错一位时合成产物会被“吞掉”）。
const { test } = require('node:test')
const assert = require('node:assert')
const registry = require('prismarine-registry')('1.7.10')
const windows = require('prismarine-windows')(registry)
const { createGtnhWindow, fixWindowLayout, PLAYER_INVENTORY_SLOTS } = require('../lib/gtnh/windows')

const title = 'x'

test('玩家窗口是 46 槽，副手算在物品区间里', () => {
  const inv = createGtnhWindow(windows, 0, 'minecraft:inventory', title)
  assert.strictEqual(inv.slots.length, PLAYER_INVENTORY_SLOTS)
  assert.strictEqual(inv.inventoryStart, 9)
  assert.strictEqual(inv.hotbarStart, 36)
  assert.strictEqual(inv.inventoryEnd, 46)
  assert.strictEqual(inv.craftingResultSlot, 0)
})

test('数字类型 1 翻成工作台：10 个容器格 + 36 玩家格', () => {
  const w = createGtnhWindow(windows, 1, 1, title, 46)
  assert.strictEqual(w.type, 'minecraft:crafting_table')
  assert.strictEqual(w.slots.length, 46)
  assert.strictEqual(w.inventoryStart, 10)
  assert.strictEqual(w.hotbarStart, 37)
  assert.strictEqual(w.craftingResultSlot, 0)
})

test('数字类型 2 翻成熔炉：3 + 36 槽', () => {
  const w = createGtnhWindow(windows, 1, 2, title, 39)
  assert.strictEqual(w.type, 'minecraft:furnace')
  assert.strictEqual(w.slots.length, 39)
  assert.strictEqual(w.inventoryStart, 3)
  assert.strictEqual(w.hotbarStart, 30)
})

test('箱子按「总槽数 - 36」当 storage', () => {
  const w = createGtnhWindow(windows, 1, 0, title, 63)
  assert.strictEqual(w.type, 'minecraft:chest')
  assert.strictEqual(w.slots.length, 63)
  assert.strictEqual(w.inventoryStart, 27)
  assert.strictEqual(w.hotbarStart, 54)
})

test('fixWindowLayout 按传入的总槽数覆盖 prismarine-windows 的默认布局', () => {
  // 双联箱：prismarine-windows 只认 storage 槽数，这里给它的窗口按 90 槽修正
  const w = windows.createWindow(3, 'minecraft:chest', title, 54)
  fixWindowLayout(w, 90)
  assert.strictEqual(w.inventoryStart, 54)
  assert.strictEqual(w.hotbarStart, 81)
  assert.strictEqual(w.inventoryEnd, 90)
})
