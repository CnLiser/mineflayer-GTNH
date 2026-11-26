'use strict'

const test = require('node:test')
const assert = require('node:assert')

const { formatMessage, parseJSON } = require('../src/chat')
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
