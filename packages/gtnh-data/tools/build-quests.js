#!/usr/bin/env node
'use strict'

/**
 * 把 Java 探针 dump 出来的 BetterQuesting 原始任务数据（NBT 逐条转 JSON）压成可用的任务书。
 *
 * 输入：data/raw/gtnh-2.9.0-server/quests-raw.json
 *   { counts, quests: [{ id, prereq: [uuid], nbt: { tasks, rewards, properties } }], lines: [{ id, quests: [uuid], nbt }] }
 * 输出：data/quests.json
 *   { generatedAt, total, lines: {id: {name, desc, icon, visibility}}, quests: {id: {...}}, byLine, byItem }
 *
 * 原始文件很大（11MB，含完整 NBT），这个脚本只留下「要什么、给什么、依赖谁、在哪条线」。
 */

const fs = require('fs')
const path = require('path')

const RAW = path.join(__dirname, '..', 'data', 'raw', 'gtnh-2.9.0-server', 'quests-raw.json')
const OUT = path.join(__dirname, '..', 'data', 'quests.json')

/** BQ 把字符串属性写成 JSON 字面量（带引号），这里剥掉 */
function unq (v) {
  if (typeof v !== 'string') return v
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
    try { return JSON.parse(v) } catch { return v.slice(1, -1) }
  }
  return v
}

/** ItemStack（BQ 的 BigItemStack）→ 精简 */
function stack (s) {
  if (!s) return null
  const id = unq(s.id)
  if (!id) return null
  // BQ 里 Count=0 表示「只要一个」（常见于 requireOnlyOneItem / partialMatch 的任务），
  // 当成 0 会让这种任务在空背包下就显示「能交」。
  const out = { id, meta: s.Damage | 0, count: Math.max(1, s.Count | 0) }
  const ore = unq(s.OreDict)
  if (ore) out.ore = ore
  if (s.tag && Object.keys(s.tag).length) out.nbt = true
  return out
}

function stacks (list) {
  return (list || []).map(stack).filter(Boolean)
}

/** 一种 task → {type, ...关键字段} */
function task (t) {
  const type = unq(t.taskID) || '?'
  const short = type.replace(/^bq_standard:/, '')
  const out = { type: short }
  if (t.requiredItems) out.items = stacks(t.requiredItems)
  if (t.requiredFluids) {
    out.fluids = t.requiredFluids.map((f) => ({ name: unq(f.FluidName), amount: Math.max(1, f.Amount | 0) }))
  }
  if (t.target) out.target = unq(t.target)
  if (t.required != null) out.count = t.required | 0
  if (t.range != null) out.range = t.range | 0
  if (t.name && short === 'location') out.name = unq(t.name)
  if (t.dimension != null && short === 'location') {
    out.dimension = t.dimension | 0
    out.pos = [t.posX | 0, t.posY | 0, t.posZ | 0]
  }
  if (short === 'retrieval' || short === 'optional_retrieval') {
    if (t.consume) out.consume = true
    if (t.partialMatch) out.partial = true
  }
  if (short === 'crafting') {
    if (t.allowCraft) out.craft = true
    if (t.allowSmelt) out.smelt = true
  }
  return out
}

/** 一种 reward → {type, ...} */
function reward (r) {
  const type = unq(r.rewardID) || '?'
  const short = type.replace(/^bq_standard:/, '')
  const out = { type: short }
  if (r.rewards) out.items = stacks(r.rewards)
  if (r.choices) out.choices = stacks(r.choices)
  if (r.amount != null) out.amount = r.amount | 0
  if (r.isLevels) out.levels = true
  return out
}

function main () {
  if (!fs.existsSync(RAW)) {
    console.error('没有找到原始数据：' + RAW)
    console.error('先用 DumpQuest13 从服务器内存导出（见 docs/HANDOVER.md §5）')
    process.exit(1)
  }
  const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'))

  // 任务线：id -> {name, desc, icon}，以及每个任务属于哪条线
  const lines = {}
  const questLine = {}
  for (const l of raw.lines || []) {
    const p = (l.nbt && l.nbt.properties && l.nbt.properties.betterquesting) || {}
    lines[l.id] = {
      name: unq(p.name) || '',
      desc: unq(p.desc) || '',
      icon: stack(p.icon),
      visibility: unq(p.visibility) || ''
    }
    for (const qid of l.quests || []) questLine[qid] = l.id
  }

  const quests = {}
  const byItem = {}
  for (const q of raw.quests || []) {
    const nbt = q.nbt || {}
    const p = (nbt.properties && nbt.properties.betterquesting) || {}
    const entry = {
      id: q.id,
      line: questLine[q.id] || null,
      name: unq(p.name) || '',
      desc: unq(p.desc) || '',
      icon: stack(p.icon),
      hidden: unq(p.visibility) === 'HIDDEN' || unq(p.visibility) === 'SECRET',
      prereq: q.prereq || [],
      tasks: (nbt.tasks || []).map(task),
      rewards: (nbt.rewards || []).map(reward)
    }
    quests[q.id] = entry
    for (const t of entry.tasks) {
      for (const it of t.items || []) {
        const key = String(it.id).replace(/^minecraft:/, '') + ':' + it.meta
        if (!byItem[key]) byItem[key] = []
        if (byItem[key][byItem[key].length - 1] !== q.id) byItem[key].push(q.id)
      }
    }
  }

  const byLine = {}
  for (const qid of Object.keys(quests)) {
    const lid = quests[qid].line
    if (!lid) continue
    if (!byLine[lid]) byLine[lid] = []
    byLine[lid].push(qid)
  }

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    total: Object.keys(quests).length,
    lines,
    quests,
    byLine,
    byItem
  }
  fs.writeFileSync(OUT, JSON.stringify(out))
  const kb = Math.round(fs.statSync(OUT).size / 1024)
  console.log(`任务书：${out.total} 条任务 / ${Object.keys(lines).length} 条线 / ${Object.keys(byItem).length} 个物品索引 → ${path.relative(process.cwd(), OUT)} (${kb} KB)`)
}

main()
