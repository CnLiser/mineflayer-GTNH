'use strict'

/*
 * 联机冒烟测试：登进 GTNH 服，统计解码出来的事件，证明整条链路（FML 握手 → ChunkAPI 解码）是通的。
 *
 * 用法：node tools/join-smoke.js <host> <port> [--seconds 20] [--mods <json>] [--username GtnhBot]
 */

const fs = require('fs')
const path = require('path')
const { createFmlClient } = require('../src')

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function main () {
  const host = process.argv[2]
  const port = Number(process.argv[3])
  if (!host || !port) {
    console.error('usage: node tools/join-smoke.js <host> <port> [--seconds 20] [--mods <json>]')
    process.exit(1)
  }
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const seconds = Number(arg('--seconds', 20))
  const username = arg('--username', 'GtnhBot')
  const raw = JSON.parse(fs.readFileSync(modsFile, 'utf8'))
  const mods = Array.isArray(raw) ? raw : raw.mods

  const stats = {
    chunks: 0,
    bulkFrames: 0,
    bulkColumns: 0,
    blockChanges: 0,
    multiBlockChanges: 0,
    managerIds: new Set(),
    errors: [],
    maxBlockId: 0,
    maxMeta: 0,
    maxSkylight: 0,
    maxBlocklight: 0
  }

  const client = createFmlClient({ host, port, username, mods, log: () => {}, hideErrors: true })
  const t0 = Date.now()

  client.once('login', () => console.log(`[login] ${Date.now() - t0}ms`))
  client.fml.on('complete', () => console.log(`[fml] 握手完成 ${Date.now() - t0}ms`))
  client.on('error', err => {
    stats.errors.push(err.message)
    console.log(`[error] ${err.message}`)
  })
  client.on('end', reason => console.log(`[end] ${reason}`))

  function scanChunk (chunk) {
    for (const id of chunk.managerIds ?? []) stats.managerIds.add(id)
    for (const sec of chunk.sections ?? []) {
      if (!sec) continue
      if (sec.hasBlockIds) for (const id of sec.blockIds) if (id > stats.maxBlockId) stats.maxBlockId = id
      if (sec.hasMetadata) for (const m of sec.metadata) if (m > stats.maxMeta) stats.maxMeta = m
      if (sec.hasSkyLight) for (const v of sec.skyLight) if (v > stats.maxSkylight) stats.maxSkylight = v
      if (sec.hasBlockLight) for (const v of sec.blockLight) if (v > stats.maxBlocklight) stats.maxBlocklight = v
    }
  }

  client.on('gtnh_chunk', chunk => {
    stats.chunks++
    scanChunk(chunk)
  })

  client.on('gtnh_chunk_bulk', bulk => {
    stats.bulkFrames++
    stats.bulkColumns += bulk.columns.length
    for (const column of bulk.columns) scanChunk(column)
    console.log(`[bulk] ${bulk.columns.length} 列，skylight=${bulk.skylight}`)
  })

  client.on('gtnh_block_change', change => {
    stats.blockChanges++
    if (change.blockId > stats.maxBlockId) stats.maxBlockId = change.blockId
  })

  client.on('gtnh_multi_block_change', multi => {
    stats.multiBlockChanges += multi.changes.length
  })

  client.on('gtnh_packet_error', ({ packet, error }) => {
    stats.errors.push(`${packet}: ${error.message}`)
  })

  setTimeout(() => {
    console.log('\n=== 结果 ===')
    console.log(`chunk 单包: ${stats.chunks}`)
    console.log(`bulk 帧: ${stats.bulkFrames}（共 ${stats.bulkColumns} 列）`)
    console.log(`block_change: ${stats.blockChanges}`)
    console.log(`multi_block_change: ${stats.multiBlockChanges} 条`)
    console.log(`manager: ${[...stats.managerIds].join(', ')}`)
    console.log(`最大 blockId: ${stats.maxBlockId} / metadata: ${stats.maxMeta} / skylight: ${stats.maxSkylight} / blocklight: ${stats.maxBlocklight}`)
    if (stats.errors.length) console.log(`错误 ${stats.errors.length} 条：\n  ` + stats.errors.slice(0, 5).join('\n  '))
    try { client.end('smoke-done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(stats.errors.length ? 1 : 0), 200)
  }, seconds * 1000)
}

main()
