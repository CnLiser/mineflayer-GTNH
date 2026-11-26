const { test } = require('node:test')
const assert = require('node:assert')
const windows = require('prismarine-windows')('1.7.10')
const { createModularWindow, IMPLICIT_DELAY_MS } = require('../lib/gtnh/modularui')

const empty = (n) => Array.from({ length: n }, () => ({ blockId: -1 }))

test('GT machine window: 41 slots, 5 machine + 36 player', () => {
  const win = createModularWindow(windows, 'title', { windowId: 1, items: empty(41) })
  assert.strictEqual(win.id, 1)
  assert.strictEqual(win.type, 'modularui2')
  assert.strictEqual(win.slots.length, 41)
  // machine slots 0..4, then the 36 player slots
  assert.strictEqual(win.inventoryStart, 5)
  assert.strictEqual(win.inventoryEnd, 41)
  // 27 main + 9 hotbar
  assert.strictEqual(win.hotbarStart, 32)
  assert.strictEqual(win.craftingResultSlot, -1)
  assert.strictEqual(win.requiresConfirmation, false)
  assert.strictEqual(win.implicit, true)
  assert.strictEqual(win.modularUI, true)
})

test('chest-sized ModularUI2 window keeps 27 container + 36 player', () => {
  const win = createModularWindow(windows, 'title', { windowId: 2, items: empty(63) })
  assert.strictEqual(win.inventoryStart, 27)
  assert.strictEqual(win.hotbarStart, 54)
})

test('window smaller than the player inventory clamps the split', () => {
  const win = createModularWindow(windows, 'title', { windowId: 3, items: empty(36) })
  assert.strictEqual(win.slots.length, 36)
  assert.strictEqual(win.inventoryStart, 0)
  assert.strictEqual(win.hotbarStart, 27)
})

test('implicit window delay is small but non-zero', () => {
  assert.ok(IMPLICIT_DELAY_MS > 0 && IMPLICIT_DELAY_MS <= 1000)
})
