'use strict'

const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')

const { attachModularUI, PLAYER_SLOTS } = require('../lib/gtnh/modularui')
const { parseModularUIPacket: parsePacket } = require('protocol-fml')

const OPEN_GUI = '0301000c67726567746563683a6d746503214e13'
const SYNC_POWER = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e30320d706f7765725377697463683a3000020001'
const SYNC_PLAYER = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e303208706c617965723a30000e000000001861010000ffff010100'

function fakeBot () {
  const bot = new EventEmitter()
  bot._client = new EventEmitter()
  return attachModularUI(bot)
}

test('openGui 记下窗口与 factory', () => {
  const bot = fakeBot()
  const opened = []
  bot.on('modularOpen', (v) => opened.push(v))
  bot._client.emit('gtnh_mui2', parsePacket(Buffer.from(OPEN_GUI, 'hex')))
  assert.strictEqual(bot.pendingModularWindow.windowId, 1)
  assert.strictEqual(bot.pendingModularWindow.factory, 'gregtech:mte')
  assert.deepStrictEqual(bot.pendingModularWindow.blockPos, { x: 33, y: 78, z: 19 })
  assert.strictEqual(opened.length, 1)
})

test('syncHandler 聚合到面板状态', () => {
  const bot = fakeBot()
  const seen = []
  bot.on('modularSync', (v) => seen.push(v))
  bot._client.emit('gtnh_mui2', parsePacket(Buffer.from(SYNC_POWER, 'hex')))
  bot._client.emit('gtnh_mui2', parsePacket(Buffer.from(SYNC_PLAYER, 'hex')))
  assert.deepStrictEqual(bot.modularPanels(), ['basicmachine.alloysmelter.tier.02'])
  const panel = bot.panelState('basicmachine.alloysmelter.tier.02')
  assert.strictEqual(panel['powerSwitch:0'].value, true)
  assert.strictEqual(panel['player:0'].value.item.blockId, 6241)
  assert.strictEqual(seen.length, 2)
  assert.strictEqual(bot.panelState('nope'), null)
})

test('closeGui 清掉 pending 窗口', () => {
  const bot = fakeBot()
  const closed = []
  bot.on('modularClose', (v) => closed.push(v))
  bot._client.emit('gtnh_mui2', parsePacket(Buffer.from(OPEN_GUI, 'hex')))
  // CloseGuiPacket: id 7, networkId 1, dispose 0
  bot._client.emit('gtnh_mui2', { name: 'closeGui', id: 7, networkId: 0, dispose: false })
  assert.strictEqual(bot.pendingModularWindow, null)
  assert.strictEqual(closed.length, 1)
})

test('PLAYER_SLOTS 固定 36', () => {
  assert.strictEqual(PLAYER_SLOTS, 36)
})
