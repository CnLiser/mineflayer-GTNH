'use strict'

// 离线 bot：不连服务器，用一个假 client 驱动 fork 的真实插件链。
// 用来测「包处理 → bot 状态」这类以前只能联机验证的东西（背包、窗口、feature 表）。
//
// 假 client 要够 loader 和各个插件调：write / end / registerChannel / setSocket。
// 插件只在 bot._client 上注册监听和写包，不会真的碰 socket。

const { EventEmitter } = require('events')

class FakeClient extends EventEmitter {
  constructor (version = '1.7.10') {
    super()
    this.version = version
    this.writes = []
    this.channels = {}
  }

  write (name, params) {
    this.writes.push({ name, params })
  }

  end () {}

  registerChannel (name, parser) {
    this.channels[name] = parser
  }

  setSocket () {}

  // 取最后一个某名字的包（测试里最常用）
  lastWrite (name) {
    for (let i = this.writes.length - 1; i >= 0; i--) {
      if (this.writes[i].name === name) return this.writes[i].params
    }
    return undefined
  }
}

async function createOfflineBot (options = {}) {
  const { createBot } = require('../../lib/loader')
  const client = new FakeClient(options.version)
  const bot = createBot({
    client,
    username: 'offline',
    hideErrors: true,
    logErrors: false,
    ...options
  })
  // loader 在 inject_allowed 时才挂插件（setTimeout 0）
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('inject_allowed 超时：插件没挂上')), 5000)
    if (timer.unref) timer.unref()
    bot.once('inject_allowed', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  return { bot, client }
}

// 46 槽背包（1.7.10 + backhand：36 + 盔甲 4 + 副手 1 + 4 合成 + 1 结果）
function emptyInventoryItems (length = 46) {
  return Array.from({ length }, () => ({ blockId: -1 }))
}

function item (blockId, itemCount = 1, itemDamage = 0) {
  return { blockId, itemCount, itemDamage, nbt: undefined }
}

module.exports = { FakeClient, createOfflineBot, emptyInventoryItems, item }
