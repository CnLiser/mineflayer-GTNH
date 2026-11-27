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

// --- 写路径：bot.muiSet / muiToggle 要真的发 custom_payload(modularui2)
const { createOfflineBot } = require('./helpers/offline-bot')

const PANEL = 'basicmachine.alloysmelter.tier.02'

// protocol-fml 会把 modularui2 的 raw 包解成 `gtnh_mui2` 事件，这里直接喂解好的对象
function feedSync (bot, key, dataHex) {
  bot._client.emit('gtnh_mui2', { name: 'syncHandler', panel: PANEL, key, action: false, data: Buffer.from(dataHex, 'hex') })
}
function feedOpen (bot) {
  bot._client.emit('gtnh_mui2', {
    name: 'openGui',
    windowId: 1,
    networkId: 0,
    factory: 'gregtech:mte',
    blockPos: { x: 33, y: 78, z: 19 }
  })
}

test('muiSet 发 custom_payload，通道是 modularui2，头是 syncHandler', async () => {
  const { bot, client } = await createOfflineBot()
  try {
    feedOpen(bot)
    feedSync(bot, 'powerSwitch:0', '0001')
    const before = client.writes.length
    assert.strictEqual(bot.muiSet(PANEL, 'powerSwitch', false), true)
    const sent = client.writes.slice(before).filter(w => w.name === 'custom_payload')
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(sent[0].params.channel, 'modularui2')
    assert.strictEqual(sent[0].params.data[0], 11)  // syncHandler 的 C2S id（与 S2C 相同）
    assert.strictEqual(sent[0].params.data[1], 0)   // networkId
    assert.strictEqual(sent[0].params.data[sent[0].params.data.length - 1], 0) // false
  } finally {
    bot.end()
  }
})

test('muiToggle 读到 true 就发 false', async () => {
  const { bot, client } = await createOfflineBot()
  try {
    feedOpen(bot)
    feedSync(bot, 'powerSwitch:0', '0001')
    const before = client.writes.length
    bot.muiToggle(PANEL, 'powerSwitch')
    const sent = client.writes.slice(before).filter(w => w.name === 'custom_payload')
    assert.strictEqual(sent.length, 1)
    assert.strictEqual(sent[0].params.data[sent[0].params.data.length - 1], 0)
  } finally {
    bot.end()
  }
})

test('没有打开的 MUI2 窗口时 muiSet 返回 false 不发包', async () => {
  const { bot, client } = await createOfflineBot()
  try {
    const before = client.writes.length
    assert.strictEqual(bot.muiSet(PANEL, 'powerSwitch', false), false)
    assert.strictEqual(client.writes.length, before)
  } finally {
    bot.end()
  }
})
