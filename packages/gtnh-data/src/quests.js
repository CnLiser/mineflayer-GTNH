'use strict'

/**
 * BetterQuesting 任务书（GTNH 的主线就是它）。
 *
 * 数据：data/quests.json（由 tools/build-quests.js 从 agent dump 的 NBT 压出来）
 * 3814 条任务 / 46 条任务线，每条带：名称、说明、图标、前置、任务要求、奖励。
 *
 * 这一层只做「查」，不做「做」；「按背包算能交哪些任务」在 Quests#readyWith。
 */

const fs = require('fs')
const path = require('path')

const QUESTS_FILE = path.join(__dirname, '..', 'data', 'quests.json')

let cached = null

function loadQuests (file = QUESTS_FILE) {
  if (cached && file === QUESTS_FILE) return cached
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const q = new Quests(data)
  if (file === QUESTS_FILE) cached = q
  return q
}

function itemKey (id, meta) {
  return String(id) + ':' + (meta | 0)
}

class Quests {
  constructor (data) {
    this.data = data
    this.quests = data.quests || {}
    this.lines = data.lines || {}
    this.byLine = data.byLine || {}
    this.byItem = data.byItem || {}
    this._dependents = null
  }

  get total () { return Object.keys(this.quests).length }

  /** 所有任务线 [{id, name, desc, icon}] */
  lineList () {
    return Object.entries(this.lines).map(([id, l]) => ({ id, ...l }))
  }

  line (id) {
    const l = this.lines[id]
    return l ? { id, ...l } : null
  }

  lineByName (name) {
    const hit = this.lineList().find((l) => l.name === name)
    return hit || null
  }

  /** 一条线上的所有任务（按任务书里的顺序） */
  questsOfLine (lineId) {
    return (this.byLine[lineId] || []).map((id) => this.get(id)).filter(Boolean)
  }

  get (id) {
    return this.quests[id] || null
  }

  /** 按名字找（先精确，再包含） */
  byName (name) {
    const all = Object.values(this.quests)
    const exact = all.filter((q) => q.name === name)
    if (exact.length) return exact
    const needle = String(name).toLowerCase()
    return all.filter((q) => q.name.toLowerCase().includes(needle))
  }

  /** 名字或说明里包含关键词 */
  search (text, opts = {}) {
    const needle = String(text).toLowerCase()
    const limit = opts.limit || 50
    const out = []
    for (const q of Object.values(this.quests)) {
      if (out.length >= limit) break
      if (q.name.toLowerCase().includes(needle) || (q.desc || '').toLowerCase().includes(needle)) out.push(q)
    }
    return out
  }

  /** 哪些任务要求交这个物品（id + meta） */
  forItem (id, meta = 0, opts = {}) {
    const ids = this.byItem[itemKey(id, meta)] || []
    const out = ids.map((qid) => this.get(qid)).filter(Boolean)
    if (opts.ore) {
      for (const q of Object.values(this.quests)) {
        if (out.includes(q)) continue
        for (const t of q.tasks) {
          if ((t.items || []).some((it) => it.ore === opts.ore)) { out.push(q); break }
        }
      }
    }
    return out
  }

  /** 前置任务 */
  prereqOf (id) {
    const q = this.get(id)
    return q ? q.prereq.slice() : []
  }

  /** 反向依赖：哪些任务把 id 当前置 */
  dependents (id) {
    if (!this._dependents) {
      this._dependents = {}
      for (const q of Object.values(this.quests)) {
        for (const p of q.prereq) {
          if (!this._dependents[p]) this._dependents[p] = []
          this._dependents[p].push(q.id)
        }
      }
    }
    return (this._dependents[id] || []).slice()
  }

  /** 从根到该任务的前置链（拓扑序，含自己） */
  chain (id) {
    const seen = new Set()
    const order = []
    const walk = (qid) => {
      if (seen.has(qid)) return
      seen.add(qid)
      for (const p of this.prereqOf(qid)) walk(p)
      order.push(qid)
    }
    walk(id)
    return order.map((qid) => this.get(qid)).filter(Boolean)
  }

  /**
   * 背包能交哪些任务。
   * inv: [{id, meta, count}]（mineflayer 的 bot.inventory.items() 直接能传）
   * 只算 retrieval / optional_retrieval；crafting/hunt/location/fluid 无法从背包判断，记为 unknown。
   */
  readyWith (inv, opts = {}) {
    const have = inventoryCounts(inv)
    const out = []
    for (const q of Object.values(this.quests)) {
      if (opts.line && q.line !== opts.line) continue
      const r = this.check(q.id, inv, { have })
      if (r.ready) out.push(q)
      if (opts.limit && out.length >= opts.limit) break
    }
    return out.sort((a, b) => a.tasks.length - b.tasks.length)
  }

  /** 交这个任务还缺什么（物品列表） */
  missingFor (id, inv) {
    return this.check(id, inv).missing
  }

  /**
   * 检查一个任务：ready = 所有能判断的 task 都满足，且至少有一个 retrieval task。
   * 返回 { ready, missing: [{id, meta, need, have}], unknown: [taskType] }
   */
  check (id, inv, opts = {}) {
    const q = this.get(id)
    if (!q) return { ready: false, missing: [], unknown: [], reason: '任务不存在' }
    const have = opts.have || inventoryCounts(inv)
    const missing = []
    const unknown = []
    let judgeable = 0
    let satisfied = 0
    for (const t of q.tasks) {
      if (t.type === 'retrieval' || t.type === 'optional_retrieval') {
        judgeable++
        for (const it of t.items || []) {
          const got = have.get(itemKey(it.id, it.meta)) || 0
          if (got < it.count) missing.push({ id: it.id, meta: it.meta, need: it.count, have: got })
        }
      } else {
        unknown.push(t.type)
      }
    }
    // 每一条 retrieval 都检查完了才能说满足
    for (const m of missing) if (m.have >= m.need) satisfied++
    const ready = missing.length === 0 && judgeable > 0
    return { ready, missing: dedupeMissing(missing), unknown }
  }

  /** 概览 */
  summary () {
    const byTask = {}
    for (const q of Object.values(this.quests)) {
      for (const t of q.tasks) byTask[t.type] = (byTask[t.type] || 0) + 1
    }
    return { total: this.total, lines: Object.keys(this.lines).length, byTask }
  }
}

/** 兼容两种物品写法：任务数据里的 {id, meta}，mineflayer 的 {name, metadata} */
function itemIdOf (it) {
  return it.name || it.id
}

function itemMetaOf (it) {
  return (it.meta != null ? it.meta : it.metadata) | 0
}

function inventoryCounts (inv) {
  const m = new Map()
  for (const it of inv || []) {
    const key = itemKey(itemIdOf(it), itemMetaOf(it))
    m.set(key, (m.get(key) || 0) + (it.count || 1))
  }
  return m
}

function dedupeMissing (list) {
  const m = new Map()
  for (const x of list) {
    const k = itemKey(x.id, x.meta)
    const prev = m.get(k)
    if (prev) prev.need = Math.max(prev.need, x.need)
    else m.set(k, { ...x })
  }
  return Array.from(m.values())
}

module.exports = { loadQuests, Quests, itemKey, QUESTS_FILE }
