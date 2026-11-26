// GTNH-PATCH: 断线重连的薄封装。
//
// 上游 mineflayer 不管重连——socket 断了就是 end，用户自己重建。对 GTNH 这种
// 长时间挂机的场景，这意味着一断线整个任务就停了。这里不改 bot 内部状态
// （世界缓存、背包、窗口都跟着旧 client 一起丢掉），而是断线后**整个 bot 重建**，
// 用指数退避避免服务端还在重启时反复砸门。
//
//   const { connect } = require('mineflayer-fork')
//   const link = connect({ host, port, username })
//   link.on('bot', (bot) => { bot.once('spawn', () => console.log('又连上了')) })
//   link.start()
// 延迟 require：loader 也在往这里导出 connect，顶层互相 require 会有循环依赖告警
const defaultCreateBot = (options) => require('../loader').createBot(options)

function connect (options, opts = {}) {
  const createBot = opts.createBot || defaultCreateBot
  const baseDelayMs = opts.baseDelayMs ?? 1000
  const maxDelayMs = opts.maxDelayMs ?? 30000
  const maxTries = opts.maxTries ?? Infinity

  let bot = null
  let tries = 0
  let stopped = false
  let timer = null
  const listeners = { bot: [], reconnect: [], giveup: [] }

  const emit = (name, arg) => { for (const fn of listeners[name] || []) fn(arg) }

  function schedule (reason) {
    if (stopped) return
    tries++
    if (tries > maxTries) { emit('giveup', { reason, tries }); return }
    const delay = Math.min(baseDelayMs * 2 ** (tries - 1), maxDelayMs)
    emit('reconnect', { delay, tries, reason })
    timer = setTimeout(start, delay)
    if (timer.unref) timer.unref()
  }

  function start () {
    if (stopped) return null
    bot = createBot(options)
    tries = tries || 0
    bot.once('spawn', () => { tries = 0 })
    bot.once('end', (reason) => { bot = null; schedule(reason) })
    emit('bot', bot)
    return bot
  }

  return {
    start,
    get bot () { return bot },
    on (name, fn) {
      (listeners[name] = listeners[name] || []).push(fn)
      return this
    },
    stop () {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      if (bot) { try { bot.quit() } catch (e) {} }
      bot = null
    }
  }
}

module.exports = { connect }
