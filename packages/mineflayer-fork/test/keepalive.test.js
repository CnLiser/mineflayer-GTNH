const { test } = require('node:test')
const assert = require('node:assert')

const { createOfflineBot } = require('./helpers/offline-bot')

test('收到 keep_alive 会原样回显（不回会被服务端踢）', async () => {
  const { bot, client } = await createOfflineBot()
  try {
    client.emit('keep_alive', { keepAliveId: 12345 })
    await new Promise((r) => setTimeout(r, 20))
    const out = client.lastWrite('keep_alive')
    assert.ok(out, '没有回 keep_alive')
    assert.strictEqual(out.keepAliveId, 12345)
  } finally {
    bot.end?.()
  }
})

test('keep_alive 会转发成 bot 事件，id 保持原值（负数也不丢）', async () => {
  const { bot, client } = await createOfflineBot()
  try {
    const seen = []
    bot.on('keepalive', (id) => seen.push(id))
    client.emit('keep_alive', { keepAliveId: -7 })
    await new Promise((r) => setTimeout(r, 20))
    assert.deepStrictEqual(seen, [-7])
    assert.strictEqual(client.lastWrite('keep_alive').keepAliveId, -7)
  } finally {
    bot.end?.()
  }
})
