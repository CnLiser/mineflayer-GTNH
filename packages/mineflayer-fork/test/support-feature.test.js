'use strict'

// 1.7.10 的 feature 表由 gtnh-data 提供（minecraft-data 对 1.7.10 全返回 false）。
// 原 packages/mineflayer-gtnh/test/features.test.js，归档后改成验 fork 的 loader 接线。

const test = require('node:test')
const assert = require('node:assert')

const { createOfflineBot } = require('./helpers/offline-bot')
const fork = require('..')

test('bot.supportFeature 返回 gtnh-data 的「值」而不是布尔', async () => {
  const { bot } = await createOfflineBot()

  assert.equal(bot.supportFeature('blockMetadata'), true)
  assert.equal(bot.supportFeature('usesBlockStates'), false)
  assert.equal(bot.supportFeature('doesntHaveOffHandSlot'), false, '1.7.10 有副手槽（backhand）')
  assert.equal(bot.supportFeature('no.such.feature'), false, '未知键回落 false')

  // 值型 feature：mineflayer 内部靠它决定线格式
  assert.equal(bot.supportFeature('metadataIxOfItem'), 8)
  assert.equal(bot.supportFeature('whereDurabilityIsSerialized'), 'metadata')
})

test('registry.supportFeature 与包门面走同一张表', async () => {
  const { bot } = await createOfflineBot()
  assert.equal(bot.registry.supportFeature('blockMetadata'), true)
  assert.equal(bot.registry.supportFeature('metadataIxOfItem'), 8)

  assert.equal(fork.supportFeature('blockMetadata', '1.7.10'), true)
  // 非 1.7.10 走 minecraft-data，不受 GTNH 表影响
  assert.equal(fork.supportFeature('blockMetadata', '1.8.8'), true)
})

test('createBot({ lang }) 把聊天渲染挂到 bot.formatMessage', async () => {
  const { Lang } = require('gtnh-data')
  const lang = new Lang({
    en: { 'server.welcome': 'Welcome %s' },
    zh: { 'server.welcome': '欢迎 %s' }
  })
  const { bot } = await createOfflineBot({ lang })

  assert.equal(bot.lang, lang)
  assert.equal(bot.formatMessage({ translate: 'server.welcome', with: [{ text: 'Steve' }] }), '欢迎 Steve')
  // 没给 lang 的 bot 原样输出键
  const { bot: bare } = await createOfflineBot()
  assert.equal(bare.formatMessage({ translate: 'server.welcome', with: [{ text: 'Steve' }] }), 'server.welcome(Steve)')
})
