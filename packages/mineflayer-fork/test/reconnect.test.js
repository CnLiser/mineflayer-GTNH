const { test } = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('node:events')
const { connect } = require('../lib/gtnh/reconnect')

// 假 bot：只需要 on/once/emit/quit，够 reconnect 用
function fakeCreateBot () {
  const b = new EventEmitter()
  b.quit = () => b.emit('end', 'quit')
  b.spawn = () => b.emit('spawn')
  setTimeout(() => b.spawn(), 1)
  return b
}

test('断线后按指数退避重建，spawn 后计数归零', async () => {
  const bots = []
  const events = []
  const link = connect({ host: 'x' }, {
    createBot: () => { const b = fakeCreateBot(); bots.push(b); return b },
    baseDelayMs: 10,
    maxDelayMs: 40
  })
  link.on('bot', (b) => bots.push(b))
  link.on('reconnect', (e) => events.push(e))
  link.start()
  await new Promise((r) => setTimeout(r, 10))
  assert.equal(bots.length >= 1, true)
  bots[0].emit('end', 'ECONNRESET')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(bots.length >= 2, true)
  assert.equal(events.length >= 1, true)
  assert.equal(events[0].tries, 1)
  assert.equal(events[0].delay, 10)
  link.stop()
})

test('stop() 之后不再重建', async () => {
  let made = 0
  const link = connect({}, { createBot: () => { made++; return fakeCreateBot() }, baseDelayMs: 5 })
  link.start()
  await new Promise((r) => setTimeout(r, 10))
  const first = made
  link.stop()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(made, first)
})

test('超过 maxTries 后给出 giveup，不再重试', async () => {
  let made = 0
  const giveup = []
  const link = connect({}, {
    createBot: () => { made++; const b = fakeCreateBot(); b.spawn = () => {}; return b },
    baseDelayMs: 5,
    maxTries: 2
  })
  link.on('giveup', (e) => giveup.push(e))
  link.start()
  await new Promise((r) => setTimeout(r, 5))
  link.bot.emit('end', 'a')
  await new Promise((r) => setTimeout(r, 20))
  link.bot.emit('end', 'b')
  await new Promise((r) => setTimeout(r, 20))
  if (link.bot) link.bot.emit('end', 'c')
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(giveup.length >= 1, true)
  link.stop()
})
