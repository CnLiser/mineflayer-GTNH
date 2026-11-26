'use strict'

/*
 * 抓包工具：登录并把服务器发来的每一帧（splitter 输出的包级字节）落盘。
 * 用途：分析被模组改过格式的包（EndlessIDs 的方块同步、区块等）。
 *
 * 用法：node tools/capture.js <host> <port> [--mods <json>] [--out <file>] [--seconds 20]
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
    console.error('usage: node tools/capture.js <host> <port> [--mods <json>] [--out <file>] [--seconds 20]')
    process.exit(1)
  }
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const out = arg('--out', path.join(__dirname, '..', 'data', 'raw', 'capture.jsonl'))
  const seconds = Number(arg('--seconds', 20))
  const username = arg('--username', 'GtnhBot')
  const raw = JSON.parse(fs.readFileSync(modsFile, 'utf8'))
  const mods = Array.isArray(raw) ? raw : raw.mods // ping.js 存的是 {host,port,mods}

  const client = createFmlClient({ host, port, username, mods, log: () => {} })
  const frames = []

  client.once('connect', () => {
    client.splitter.on('data', frame => {
      frames.push({ t: Date.now(), len: frame.length, hex: frame.toString('hex') })
    })
  })

  let joined = 0
  client.on('login', () => { joined = Date.now() })
  client.fml.on('complete', () => console.log('[fml] 握手完成'))
  client.on('error', err => console.log(`[error] ${err.message}`))
  client.on('end', reason => console.log(`[end] ${reason}`))

  setTimeout(() => {
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const dir = path.dirname(out)
    const base = path.basename(out, '.jsonl')
    fs.writeFileSync(out, frames.map(f => JSON.stringify(f)).join('\n'))
    fs.writeFileSync(path.join(dir, base + '-summary.json'), JSON.stringify({
      host,
      port,
      capturedAt: new Date().toISOString(),
      joined: Boolean(joined),
      frames: frames.length,
      byLength: frames.reduce((acc, f) => { acc[f.len] = (acc[f.len] || 0) + 1; return acc }, {}),
      byFirstByte: frames.reduce((acc, f) => { const b = parseInt(f.hex.slice(0, 2), 16); acc[b] = (acc[b] || 0) + 1; return acc }, {})
    }, null, 2))
    console.log(`[done] 帧数 ${frames.length}（joined=${Boolean(joined)}）→ ${out}`)
    try { client.end('done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 200)
  }, seconds * 1000)
}

main()
