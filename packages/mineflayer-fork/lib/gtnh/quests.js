'use strict'

/**
 * 任务书（BetterQuesting）在 bot 上的门面。
 *
 * 数据来自 gtnh-data 的 data/quests.json（3814 条任务 / 46 条线）。
 * 这里只做「查」：按名字找、看前置、看背包能不能交、缺什么。
 *
 *   const q = bot.quests()                  // Quests 实例
 *   bot.questByName('Shadow Metal')         // 按名字（先精确后包含）
 *   bot.questReady()                        // 当前背包能交的任务
 *   bot.questMissing(q.id)                  // 交这个任务还缺什么
 */

function attachQuests (bot) {
  let book = null
  const load = () => {
    if (book) return book
    const data = require('gtnh-data')
    if (typeof data.loadQuests !== 'function') {
      throw new Error('gtnh-data 里没有 loadQuests（检查 packages/gtnh-data/index.js）')
    }
    book = data.loadQuests()
    return book
  }

  bot.quests = () => load()
  bot.questByName = (name) => load().byName(name)
  bot.questSearch = (text, opts) => load().search(text, opts)
  bot.questForItem = (id, meta, opts) => load().forItem(id, meta, opts)
  bot.questLines = () => load().lineList()
  bot.questLine = (nameOrId) => {
    const b = load()
    return b.line(nameOrId) || b.lineByName(nameOrId)
  }
  /** 这条线上的任务 */
  bot.questsOfLine = (nameOrId) => {
    const b = load()
    const line = b.line(nameOrId) || b.lineByName(nameOrId)
    return line ? b.questsOfLine(line.id) : []
  }
  /** 前置链（含自己，拓扑序） */
  bot.questChain = (id) => load().chain(id)
  /** 背包能交的任务；opts.line 可限定任务线 */
  bot.questReady = (opts) => load().readyWith(invItems(bot), opts)
  /** 交这个任务还缺什么 */
  bot.questMissing = (id) => load().missingFor(id, invItems(bot))
}

function invItems (bot) {
  try {
    return bot.inventory ? bot.inventory.items() : []
  } catch {
    return []
  }
}

module.exports = { attachQuests }
