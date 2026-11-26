'use strict'

/*
 * 服务器列表 ping：确认目标是不是 Forge 服，并顺手把服务器 ModList 存下来。
 * Forge 1.7.10 会在 status 响应里塞 modinfo.modList —— 这是 FML 握手要回传的权威列表。
 *
 * 用法：node tools/ping.js <host> <port> [--out <file>]
 */

const fs = require('fs')
const path = require('path')
const mc = require('minecraft-protocol')

async function main () {
  const [host, portArg] = process.argv.slice(2).filter(a => !a.startsWith('--'))
  const outIdx = process.argv.indexOf('--out')
  if (!host || !portArg) {
    console.error('usage: node tools/ping.js <host> <port> [--out <file>]')
    process.exit(1)
  }
  const port = Number(portArg)

  const started = Date.now()
  const res = await mc.ping({ host, port, version: '1.7.10', closeTimeout: 10000 })
  const elapsed = Date.now() - started

  const modinfo = res.modinfo
  const mods = modinfo?.modList ?? null

  console.log(`host: ${host}:${port}  (${elapsed}ms)`)
  console.log(`version: ${res.version?.name}  protocol: ${res.version?.protocol}`)
  console.log(`players: ${res.players?.online}/${res.players?.max}`)
  console.log(`description: ${typeof res.description === 'string' ? res.description : JSON.stringify(res.description)}`)
  if (modinfo) {
    console.log(`forge: type=${modinfo.type}  mods=${mods?.length ?? 0}`)
    if (mods) {
      const sample = mods.slice(0, 8).map(m => `${m.modid}@${m.version}`)
      console.log(`sample: ${sample.join(', ')}${mods.length > 8 ? ', …' : ''}`)
    }
  } else {
    console.log('forge: no modinfo in ping response (vanilla or FML disabled)')
  }

  if (mods) {
    const out = outIdx >= 0
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify({ host, port, pingedAt: new Date().toISOString(), mods }, null, 2))
    console.log(`saved: ${out}`)
  }
}

main().catch(err => {
  console.error('ping failed:', err.message)
  process.exit(1)
})
