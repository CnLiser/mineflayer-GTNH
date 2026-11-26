'use strict'

/*
 * 世界层冒烟：登进 GTNH 服 → 把区块/方块包灌进 ChunkStore → 按世界坐标查方块。
 * 这是 T1「感知」的验收脚本：能看到「脚下方块是什么、y=0 是不是基岩、生物群系是什么」。
 *
 * 用法：node tools/world-smoke.js <host> <port> [--seconds 20] [--mods <json>] [--username GtnhBot]
 */

const fs = require('fs')
const path = require('path')
const { createFmlClient } = require('../src')
const { ChunkStore } = require('prismarine-chunk-1.7')
const { ModRegistry, Lang } = require('gtnh-data')

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function main () {
  const host = process.argv[2]
  const port = Number(process.argv[3])
  if (!host || !port) {
    console.error('usage: node tools/world-smoke.js <host> <port> [--seconds 20] [--mods <json>]')
    process.exit(1)
  }
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const seconds = Number(arg('--seconds', 20))
  const username = arg('--username', 'GtnhBot')
  const raw = JSON.parse(fs.readFileSync(modsFile, 'utf8'))
  const mods = Array.isArray(raw) ? raw : raw.mods

  // 注册表要跟服务器对得上：默认读 dump-registry.js 抓下来的本地服版本
  const registryFile = arg('--registry', path.join(__dirname, '..', 'data', 'raw', 'local-fml-registry.json'))
  const registry = fs.existsSync(registryFile)
    ? ModRegistry.fromJSON(fs.readFileSync(registryFile, 'utf8'))
    : null
  const lang = new Lang({
    en: JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gtnh-data', 'data', 'raw', 'gtnh-2.9.0', 'lang', 'en_US.json'), 'utf8')),
    zh: JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'gtnh-data', 'data', 'raw', 'gtnh-2.9.0', 'lang', 'zh_CN.json'), 'utf8'))
  })
  const describe = (block) => {
    if (!block) return '未加载'
    const name = registry ? registry.blockName(block.blockId) : undefined
    const display = name ? lang.blockName(name) : undefined
    return `id=${block.blockId}${name ? ` ${name}` : ''}${display && display !== name ? `（${display}）` : ''} ` +
      `meta=${block.metadata} biome=${block.biome} sky=${block.skyLight} light=${block.blockLight}`
  }

  const store = new ChunkStore()
  const errors = []
  let position = null
  let bulkFrames = 0
  let blockChanges = 0
  let multiChanges = 0

  const client = createFmlClient({ host, port, username, mods, log: () => {}, hideErrors: true })
  const t0 = Date.now()

  client.once('login', () => console.log(`[login] ${Date.now() - t0}ms`))
  client.fml.on('complete', () => console.log(`[fml] 握手完成 ${Date.now() - t0}ms`))
  client.on('error', err => {
    errors.push(err.message)
    console.log(`[error] ${err.message}`)
  })
  client.on('end', reason => console.log(`[end] ${reason}`))

  client.on('position', pos => {
    position = pos
    console.log(`[position] ${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`)
  })

  client.on('gtnh_chunk', chunk => store.applyDecodedColumn(chunk))
  client.on('gtnh_chunk_bulk', bulk => {
    bulkFrames++
    store.applyBulk(bulk)
  })
  client.on('gtnh_block_change', change => {
    if (store.applyBlockChange(change)) blockChanges++
  })
  client.on('gtnh_multi_block_change', multi => {
    multiChanges += store.applyMultiBlockChange(multi)
  })
  client.on('gtnh_packet_error', ({ packet, error }) => errors.push(`${packet}: ${error.message}`))

  setTimeout(() => {
    const stats = store.stats()
    console.log('\n=== 世界层结果 ===')
    console.log(`柱体: ${stats.columns}（非空段 ${stats.nonEmpty}/${stats.sections}）`)
    console.log(`bulk 帧 ${bulkFrames} / 方块变更 ${blockChanges} / 批量方块 ${multiChanges}`)
    console.log(`最大 blockId ${stats.maxBlockId} / metadata ${stats.maxMetadata} / skylight ${stats.maxSkyLight} / blocklight ${stats.maxBlockLight}`)

    let ok = true
    if (!stats.columns) {
      console.log('✗ 一个柱体都没收到')
      ok = false
    }

    if (position && stats.columns) {
      const px = Math.floor(position.x)
      const pz = Math.floor(position.z)
      const feet = store.getBlock({ x: px, y: Math.floor(position.y) - 1, z: pz })
      console.log(`脚下 (${px}, ${Math.floor(position.y) - 1}, ${pz}): ${describe(feet)}`)
      if (!feet) ok = false

      // 从上往下找第一个非空气方块
      let top = null
      for (let y = 255; y >= 0; y--) {
        const b = store.getBlock({ x: px, y, z: pz })
        if (b && b.blockId !== 0) { top = { ...b }; break }
      }
      console.log(`该列最高非空气方块: y=${top ? top.y : '—'} ${top ? describe(top) : ''}`)
      if (!top) ok = false

      // y=0 应该是基岩（id 7）
      const bedrock = store.getBlock({ x: px, y: 0, z: pz })
      console.log(`y=0: ${describe(bedrock)}（基岩应为 7）`)
      if (bedrock && bedrock.blockId !== 7) {
        console.log('✗ y=0 不是基岩，说明区块解析仍不对')
        ok = false
      }
    } else if (!position) {
      console.log('✗ 没收到 position 包')
      ok = false
    }

    if (errors.length) {
      console.log(`错误 ${errors.length} 条：\n  ` + errors.slice(0, 5).join('\n  '))
      ok = false
    }

    console.log(ok ? '\n✓ 世界层通了' : '\n✗ 世界层还有问题')
    try { client.end('smoke-done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(ok ? 0 : 1), 200)
  }, seconds * 1000)
}

main()
