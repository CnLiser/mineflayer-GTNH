'use strict'

/*
 * 诊断：把每一个「解析失败的帧」按包名统计出来，找出 GTNH 改过格式的包。
 * nmp 的解析错误走 client 'error' 事件，e.field 形如 play.toClient.<packetName>。
 * 用法：node tools/packet-diag.js <host> <port> [--seconds 20]
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
  const seconds = Number(arg('--seconds', 20))
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const raw = JSON.parse(fs.readFileSync(modsFile, 'utf8'))
  const mods = Array.isArray(raw) ? raw : raw.mods

  const client = createFmlClient({
    host,
    port,
    username: 'GtnhBot',
    mods,
    log: () => {},
    hideErrors: true // 关掉 protodef 自己往控制台打的堆栈
  })

  const failures = new Map()
  const ok = new Map()

  client.on('error', (err) => {
    const field = err.field ?? ''
    const name = field.split('.').slice(2).join('.') || '(unknown)'
    const prev = failures.get(name) ?? { count: 0, messages: new Set() }
    prev.count++
    prev.messages.add(String(err.message).replace(/^Parse error for [^:]*:\s*/, '').slice(0, 120))
    failures.set(name, prev)
  })

  client.on('packet', (data, meta) => {
    ok.set(meta.name, (ok.get(meta.name) || 0) + 1)
  })

  setTimeout(() => {
    console.log('=== 解析失败的包 ===')
    if (!failures.size) console.log('（没有失败帧）')
    for (const [name, e] of [...failures.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`${name} ×${e.count}  ${[...e.messages][0]}`)
    }
    console.log('\n=== 成功解析的包（前 25） ===')
    for (const [name, n] of [...ok.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${name} ×${n}`)
    try { client.end('diag-done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 200)
  }, seconds * 1000)
}

main()
