'use strict'

// 聊天组件渲染（translate 键走整合包 lang）。原 packages/mineflayer-gtnh/test/chat.test.js。

const test = require('node:test')
const assert = require('node:assert')

const { formatMessage, parseJSON, messageToJSON } = require('../lib/gtnh/chat')
const { formatMessage: forkFormatMessage, messageToJSON: forkMessageToJSON } = require('..')
const { Lang } = require('gtnh-data')

const lang = new Lang({
  en: { 'dreamcraft.welcome.welcome': 'Welcome to GregTech: New Horizons %s', 'a.b': 'Hi %1$s, you have %2$d' },
  zh: { 'dreamcraft.welcome.welcome': '欢迎来到 GTNH %s', 'a.b': '你好 %1$s，你有 %2$d 个' }
})

test('formatMessage：纯文本与 text 组件', () => {
  assert.strictEqual(formatMessage('hello'), 'hello')
  assert.strictEqual(formatMessage({ text: 'hello' }), 'hello')
  assert.strictEqual(formatMessage({ text: 'a', extra: [{ text: 'b' }, 'c'] }), 'abc')
})

test('formatMessage：translate + with，用 GTNH lang 渲染', () => {
  const message = { translate: 'dreamcraft.welcome.welcome', with: [{ text: '2.9.0' }] }
  assert.strictEqual(formatMessage(message, lang), '欢迎来到 GTNH 2.9.0')
  assert.strictEqual(formatMessage(message), 'dreamcraft.welcome.welcome(2.9.0)')
})

test('formatMessage：显式位置参数 %1$s / %2$d', () => {
  const message = { translate: 'a.b', with: [{ text: 'Steve' }, { text: '3' }] }
  assert.strictEqual(formatMessage(message, lang), '你好 Steve，你有 3 个')
})

test('formatMessage：嵌套组件与 JSON 字符串', () => {
  const json = JSON.stringify({ text: '', extra: [{ translate: 'a.b', with: [{ text: 'x' }, { text: '1' }] }] })
  assert.strictEqual(formatMessage(json, lang), '你好 x，你有 1 个')
  assert.deepStrictEqual(parseJSON('not json'), { text: 'not json' })
  assert.strictEqual(formatMessage(null), '')
})

test('包门面也导出 formatMessage（旧 loadServerMods 那一档 API）', () => {
  assert.strictEqual(forkFormatMessage({ text: 'ok' }), 'ok')
})

test('messageToJSON：字符串/数组/null 原样，ChatMessage 取回原始组件', () => {
  const ChatMessage = require('prismarine-chat')(require('prismarine-registry')('1.7.10'))
  const json = {
    text: '',
    extra: [{ text: 'A' }, { translate: 'a.b', with: [{ text: 'x' }, { text: '1' }] }]
  }
  const message = new ChatMessage(json)
  // ChatMessage 的 extra/with 也是 ChatMessage，直接 stringify 会写成一棵树
  assert.notDeepStrictEqual(JSON.parse(JSON.stringify(message)), json)
  assert.deepStrictEqual(messageToJSON(message), json)
  assert.strictEqual(messageToJSON('hi'), 'hi')
  assert.strictEqual(messageToJSON(42), 42)
  assert.deepStrictEqual(messageToJSON([{ text: 'a' }, message]), [{ text: 'a' }, json])
  assert.strictEqual(messageToJSON(null), '')
  assert.strictEqual(messageToJSON(undefined), '')
  // JSON 往返之后还是原来的组件
  assert.deepStrictEqual(JSON.parse(JSON.stringify(messageToJSON(message))), json)
  assert.strictEqual(forkMessageToJSON(message).extra[1].translate, 'a.b')
})
