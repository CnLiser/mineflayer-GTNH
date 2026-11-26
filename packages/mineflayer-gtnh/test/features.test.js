'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { Bot } = require('../src/index')

test('bot.supports 走 GTNH 口径，不是 minecraft-data 的（后者对 1.7.10 全 false）', () => {
  assert.equal(Bot.prototype.supports.call(null, 'blockMetadata'), true)
  assert.equal(Bot.prototype.supports.call(null, 'usesBlockStates'), false)
  assert.equal(Bot.prototype.supports.call(null, 'doesntHaveOffHandSlot'), false)
  assert.equal(Bot.prototype.supports.call(null, 'no_such_feature'), false)
})

test('bot.featureValue 返回枚举值本身', () => {
  assert.equal(Bot.prototype.featureValue.call(null, 'metadataIxOfItem'), 8)
  assert.equal(Bot.prototype.featureValue.call(null, 'whereDurabilityIsSerialized'), 'metadata')
})
