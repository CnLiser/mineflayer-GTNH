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
  bot.questMissing = (id) => {
    const b = load()
    const q = b.get(id) || (b.byName(id) || [])[0]
    return q ? b.missingFor(q.id, invItems(bot)) : []
  }

  /**
   * 交任务：默认走 BQ 自己的通道（和玩家点「提交」是同一条路），opts.via:'rcon' 才用管理命令。
   *
   *   bot.submitQuest('I Want SOLIDS Not LIQUIDS!')
   *   // => { ok: true, via: 'bq', verified: true }
   *
   * 服务端对失败是静默的（前置没做/物品不够都不回错），所以有 rcon 时会顺带
   * `bq_admin check` 核对一次（verified）。opts.verify:false 跳过核对。
   * 通道格式见 FINDINGS §39.5。
   */
  bot.submitQuest = async (id, opts = {}) => {
    let q = null
    try {
      const b = load()
      q = b.get(id) || b.byName(id)[0] || null
    } catch {}
    if (!q) return { ok: false, reason: `任务书里没有：${id}` }
    if (opts.via === 'rcon') return submitViaAdmin(bot, q, opts)

    // —— 玩家路径：BQ_NET_CHAN 的 quest_action(action=0) ——
    try {
      const { encodeQuestAction, CHANNEL } = require('protocol-fml/src/gtnh/bqnet')
      for (const data of encodeQuestAction([q.id], 0)) {
        bot._client.write('custom_payload', { channel: CHANNEL, data })
      }
    } catch (e) {
      return { ok: false, quest: q.id, reason: `发 BQ 包失败：${e.message}` }
    }
    await new Promise((r) => setTimeout(r, opts.waitMs ?? 800))

    const run = opts.rcon || bot.rcon
    const player = opts.player || bot.username || (bot._client && bot._client.username)
    if (typeof run !== 'function' || opts.verify === false || !player) {
      return { ok: true, via: 'bq', quest: q.id, verified: null }
    }
    let out
    try {
      out = await run([`bq_admin check ${player} ${uuidToBq(q.id)}`])
    } catch (e) {
      return { ok: true, via: 'bq', quest: q.id, verified: null, reason: `核对失败：${e.message}` }
    }
    const text = Array.isArray(out) ? out.join('\n') : String(out || '')
    if (/has completed/i.test(text)) return { ok: true, via: 'bq', quest: q.id, verified: true, reply: text }
    if (/has not completed/i.test(text)) {
      return { ok: false, via: 'bq', quest: q.id, reason: '服务端没接受（前置没完成或物品不够）', reply: text }
    }
    return { ok: true, via: 'bq', quest: q.id, verified: false, reply: text }
  }

  // 管理员代交：不校验前置，多选一奖励由服务端选
  async function submitViaAdmin (b, q, opts) {
    const run = opts.rcon || b.rcon
    if (typeof run !== 'function') {
      return { ok: false, reason: '交任务需要 rcon（bq_admin 是管理命令）：createBot({ rcon }) 或传 opts.rcon' }
    }
    const player = opts.player || b.username || (b._client && b._client.username)
    if (!player) return { ok: false, reason: '不知道玩家名：传 opts.player' }
    let out
    try {
      out = await run([`bq_admin complete ${uuidToBq(q.id)} ${player}`])
    } catch (e) {
      return { ok: false, reason: `rcon 失败：${e.message}` }
    }
    const text = Array.isArray(out) ? out.join('\n') : String(out || '')
    if (/Completed quest/i.test(text)) return { ok: true, via: 'rcon', quest: q.id, reply: text }
    return { ok: false, via: 'rcon', quest: q.id, reason: text || 'rcon 没有回复' }
  }

  /**
   * 任务缺的东西「怎么弄」——缺料里凡是能查到配方的，给出一条路线（一层层往下拆）。
   *
   *   bot.questPlan('Shadow Metal')   // [{ name, need, have, how: { kind, inputs, next } | null }]
   *
   * depth 控制往下拆几层（默认 2），limit 控制最多展开几条缺料。
   */
  bot.questPlan = (id, opts) => {
    const o = { depth: 2, limit: 10, ...(opts || {}) }
    const b = load()
    const q = b.get(id)
    if (!q) throw new Error(`没有这条任务：${id}`)
    const inv = invItems(bot)
    return b.missingFor(id, inv).slice(0, o.limit).map((m) => {
      const node = { ...m, how: howToMake(bot, m, o.depth - 1) }
      return node
    })
  }
}

/** BetterQuesting 的任务名带 § 颜色码（§c§l…），比较和显示前都剥掉 */
function stripColor (s) {
  return String(s || '').replace(/\u00a7./g, '').trim()
}

/** 物品名（注册名字符串）→ 注册表里的数字 id；数字原样返回 */
function idOf (bot, id) {
  if (typeof id === 'number') return id
  if (!bot.registry || !bot.registry.itemsByName) return null
  // GTNH 注册表里原版物品有的带 minecraft: 前缀、有的不带，两个方向都试
  const short = String(id).replace(/^minecraft:/, '')
  const byName = bot.registry.itemsByName[id] ||
    bot.registry.itemsByName[short] ||
    bot.registry.itemsByName['minecraft:' + short]
  return byName ? byName.id : null
}

/** 一条能把 item 造出来的配方（按 原版合成 → GT 合成台 → mod 配方 → GT 机器 → 熔炉 的顺序找） */
function recipeFor (bot, item) {
  const nid = idOf(bot, item.id)
  if (nid == null) return null
  try {
    // recipesFor 的最后一位要传 true（允许用工作台），传 null 会把 3x3 配方全滤掉
    const vanilla = typeof bot.recipesAll === 'function'
      ? bot.recipesAll(nid, item.meta || null, true)
      : (typeof bot.recipesFor === 'function' ? bot.recipesFor(nid, item.meta || null, 1, true) : [])
    if (vanilla && vanilla.length) {
      const r = vanilla[0]
      // delta 里产物自己是正数、原料是负数；只取原料，别把产物也算成「需要 -N 个自己」
      const delta = (r.delta || []).filter((d) => d.count < 0)
      const made = (r.delta || []).filter((d) => d.count > 0 && bot.registry.items[d.id] && bot.registry.items[d.id].name === itemNameOf(bot, bot.registry.items[d.id].id))
        .reduce((n, d) => n + d.count, 0) || 1
      return {
        kind: 'craft',
        outputCount: made,
        inputs: delta.map((d) => ({ id: itemNameOf(bot, d.id), meta: d.metadata || 0, count: -d.count }))
      }
    }
  } catch {}
  try {
    if (typeof bot.gtnhRecipesFor === 'function') {
      const rs = bot.gtnhRecipesFor(nid, item.meta || 0)
      if (rs && rs.length) {
        const r = rs[0]
        return {
          kind: 'gt',
          inputs: (r.delta || []).map((d) => ({ id: itemNameOf(bot, d.id), meta: d.metadata, count: -d.count }))
        }
      }
    }
  } catch {}
  try {
    if (typeof bot.modRecipesFor === 'function') {
      const rs = bot.modRecipesFor(nid, item.meta || 0)
      if (rs && rs.length) {
        const r = rs[0]
        return {
          kind: `mod:${r.mod}:${r.kind}`,
          inputs: (r.ins || []).map((alts) => {
            const a = (alts || [])[0] || {}
            return { id: a.id || a.name || a.species, meta: a.meta || 0, count: 1 }
          })
        }
      }
    }
  } catch {}
  try {
    if (typeof bot.gtRecipesForOutput === 'function') {
      const rs = bot.gtRecipesForOutput(nid, item.meta || 0)
      if (rs && rs.length) {
        const r = rs[0]
        return {
          kind: `gt:${r.map}`,
          eu: r.eu,
          dur: r.dur,
          // count 0 的是模具/催化剂，不算消耗
          inputs: (r.in || []).filter((i) => (i.count | 0) > 0).map((i) => ({ id: i.name || itemNameOf(bot, i.id), meta: i.meta, count: i.count }))
        }
      }
    }
  } catch {}
  try {
    // 熔炉要反查：gtnhSmeltingFor 是「原料→产物」，这里要知道「产物从什么来」
    if (typeof bot.gtnhSmeltSource === 'function') {
      const sm = bot.gtnhSmeltSource(nid, item.meta || 0)
      if (sm) return { kind: 'smelt', inputs: [{ id: itemNameOf(bot, sm.in[0]), meta: sm.in[1], count: 1 }] }
    }
  } catch {}
  return null
}

function itemNameOf (bot, id) {
  if (typeof id === 'string') return id
  if (bot.registry && bot.registry.items && bot.registry.items[id]) return bot.registry.items[id].name
  return String(id)
}

/** 递归一层：这一步要什么，以及每一步的原料还能怎么来 */
function howToMake (bot, item, depth) {
  const r = recipeFor(bot, item)
  if (!r) return null
  if (depth <= 0) return { kind: r.kind, inputs: r.inputs }
  return {
    ...r,
    next: r.inputs.map((i) => ({ ...i, how: howToMake(bot, i, depth - 1) }))
  }
}

function invItems (bot) {
  try {
    return bot.inventory ? bot.inventory.items() : []
  } catch {
    return []
  }
}

/**
 * BetterQuesting 的 QuestCommandComplete 不用标准 UUID 字符串，用的是
 * `UuidConverter.encodeUuid`：16 字节（mostSig 8 + leastSig 8，大端）做
 * URL-safe base64 并去掉 `=`。`bq_admin check/complete/reset` 的参数都是这个形式。
 */
function uuidToBq (uuid) {
  const hex = String(uuid).replace(/-/g, '').toLowerCase()
  if (hex.length !== 32) throw new Error(`不是 UUID：${uuid}`)
  return Buffer.from(hex, 'hex').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function bqToUuid (b64) {
  const raw = String(b64).replace(/-/g, '+').replace(/_/g, '/')
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 16) throw new Error(`不是 BQ 的 uuid 编码：${b64}`)
  const h = buf.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

module.exports = { attachQuests, recipeFor, howToMake, idOf, stripColor, uuidToBq, bqToUuid }
