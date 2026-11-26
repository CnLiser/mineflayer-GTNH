'use strict'

/*
 * 把服务器的 FML ModIdData（方块/物品注册表）落盘。
 *
 * 为什么要按服务器各存一份：EndlessIDs 的 id 是服务器运行时分配的，
 * 同一个整合包、不同的 mod 集合（少一个 mod）就会让 id 整体错位，
 * 所以「公网服的 registry」不能拿来查「本地服」的方块名。
 *
 * 用法：node tools/dump-registry.js <host> <port> [--out data/raw/local-fml-registry.json]
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
    console.error('usage: node tools/dump-registry.js <host> <port> [--out <file>] [--username GtnhBot]')
    process.exit(1)
  }
  const out = arg('--out', path.join(__dirname, '..', 'data', 'raw', 'local-fml-registry.json'))
  const username = arg('--username', 'GtnhBot')
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const raw = JSON.parse(fs.readFileSync(modsFile, 'utf8'))
  const mods = Array.isArray(raw) ? raw : raw.mods

  const client = createFmlClient({ host, port, username, mods, log: () => {}, hideErrors: true })
  const timer = setTimeout(() => {
    console.error('超时：30 秒内没拿到注册表')
    process.exit(1)
  }, 30000)

  client.once('login', () => console.log('[login] 已进入，等待 ModIdData…'))
  client.on('error', err => console.error('[error]', err.message))
  client.on('gtnh_packet_error', ({ packet, error }) => console.error('[packet-error]', packet, error.message))

  client.fml.on('registryAcked', ({ blocks, items }) => console.log(`[registry] 收到 ${blocks} 方块 / ${items} 物品`))

  client.fml.on('complete', ({ blocks, items, mods }) => {
    const reg = client.fml.registry
    const file = {
      host,
      port,
      capturedAt: new Date().toISOString(),
      mods,
      blocks: Object.fromEntries([...reg.blocks.entries()].sort((a, b) => a[0] - b[0])),
      items: Object.fromEntries([...reg.items.entries()].sort((a, b) => a[0] - b[0]))
    }
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(file))
    const ids = Object.keys(file.blocks).map(Number)
    console.log(`[写盘] ${out}`)
    console.log(`方块 ${ids.length}（id ${Math.min(...ids)}–${Math.max(...ids)}）/ 物品 ${Object.keys(file.items).length} / mods ${mods}`)
    clearTimeout(timer)
    try { client.end('done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 200)
  })
}

main()
