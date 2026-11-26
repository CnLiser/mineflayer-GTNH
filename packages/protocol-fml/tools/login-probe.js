'use strict'

/*
 * 登录探针：不做 FML 回应，只看服务器在 1.7.10 + \0FML\0 标记下会说什么。
 * 目的：确认 online-mode / 是否被 FML 拒 / 握手包序列。
 *
 * 用法：node tools/login-probe.js <host> <port> [username] [seconds]
 */

const mc = require('minecraft-protocol')

async function main () {
  const host = process.argv[2]
  const port = Number(process.argv[3])
  const username = process.argv[4] ?? 'GtnhProbe'
  const seconds = Number(process.argv[5] ?? 12)
  if (!host || !port) {
    console.error('usage: node tools/login-probe.js <host> <port> [username] [seconds]')
    process.exit(1)
  }

  console.log(`connecting ${host}:${port} as ${username} (FML marker on, version 1.7.10)`)
  const client = mc.createClient({
    host,
    port,
    username,
    version: '1.7.10',
    auth: 'offline',
    fakeHost: `${host}\u0000FML\u0000`,
    hideErrors: true
  })

  const dump = v => {
    if (v === null || v === undefined) return String(v)
    if (Buffer.isBuffer(v)) return `<buffer ${v.length}B>`
    const s = JSON.stringify(v)
    return s.length > 400 ? s.slice(0, 400) + '…' : s
  }

  client.on('state', s => console.log(`[state] ${s}`))
  client.on('connect', () => console.log('[connect] tcp connected'))
  client.on('packet', (data, meta) => console.log(`<< ${meta.name} ${dump(data)}`))
  client.on('error', err => console.log(`[error] ${err.message}`))
  client.on('end', reason => console.log(`[end] ${reason}`))

  setTimeout(() => {
    console.log('[probe] done, closing')
    try { client.end('probe done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(0), 300)
  }, seconds * 1000)
}

main().catch(err => {
  console.error('probe failed:', err.message)
  process.exit(1)
})
