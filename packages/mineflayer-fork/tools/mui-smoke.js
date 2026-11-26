// GTNH-PATCH smoke test: read ModularUI2 widget state from a GT machine GUI.
//
//   node tools/mui-smoke.js 127.0.0.1 54615 --pos "33 78 19" --tp "34.5 78 20.5"
//
// 打开机器 GUI 后，ModularUI2 会把面板里的控件值以 `key -> buf` 推过来
// （powerSwitch / hasError / progress / energy …）。这里把它们解出来打印。
const { createBot } = require('../index')
const { rcon } = require('../../protocol-fml/tools/rcon')

function parseArgs () {
  const argv = process.argv.slice(2)
  const out = { host: argv[0] || '127.0.0.1', port: Number(argv[1] || 54615), pos: null, tp: null, user: 'muiBot', seconds: 6 }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pos') out.pos = argv[++i].split(/[\s,]+/).map(Number)
    else if (a === '--tp') out.tp = argv[++i]
    else if (a === '--username') out.user = argv[++i]
    else if (a === '--seconds') out.seconds = Number(argv[++i])
  }
  return out
}

function describe (value) {
  if (!value) return '?'
  switch (value.kind) {
    case 'bool': return String(value.value)
    case 'int': return String(value.value)
    case 'long': return String(value.value)
    case 'double': return Number.isNaN(value.value) ? 'NaN（机器空转，进度 0/0）' : value.value.toFixed(3)
    case 'item': {
      const it = value.value.item
      return it.blockId < 0 ? 'empty' : `item ${it.blockId} x${it.itemCount} dmg=${it.itemDamage}`
    }
    default: return `raw ${value.value}`
  }
}

async function main () {
  const opts = parseArgs()
  const bot = createBot({ host: opts.host, port: opts.port, username: opts.user, auth: 'offline' })
  const windows = []
  const syncs = []
  bot.on('windowOpen', (w) => windows.push(w))
  bot.on('modularSync', (v) => syncs.push(v))
  bot.on('modularOpen', (v) => console.log('modularOpen', v.windowId, v.factory, v.blockPos))
  bot.on('error', (e) => console.log('[bot error]', String(e.message).slice(0, 120)))

  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    setTimeout(() => reject(new Error('spawn timeout')), 30000)
  })
  await new Promise(r => setTimeout(r, 1500))

  let pos = opts.pos
  if (!pos) {
    const found = bot.findBlock({ maxDistance: 24, matching: (b) => b && /blockmachines/i.test(b.name) })
    if (!found) throw new Error('no gregtech:gt.blockmachines nearby; pass --pos "x y z"')
    pos = [found.position.x, found.position.y, found.position.z]
  }
  console.log('machine', pos.join(' '))

  if (opts.tp) {
    const res = await rcon([`tp ${opts.user} ${opts.tp}`], { host: opts.host })
    console.log('tp', res.join(' | ').slice(0, 120))
    await new Promise(r => setTimeout(r, 2000))
  }

  bot._client.write('block_place', {
    location: { x: pos[0], y: pos[1], z: pos[2] },
    direction: 1,
    heldItem: { blockId: -1 },
    cursorX: 8,
    cursorY: 16,
    cursorZ: 8
  })
  for (let i = 0; i < 40 && windows.length === 0; i++) await new Promise(r => setTimeout(r, 100))
  if (!windows.length) throw new Error('no window opened (server refused the click?)')
  console.log('window', windows[0].id, 'slots=' + windows[0].slots.length, 'factory=' + (windows[0].factory || '?'))

  await new Promise(r => setTimeout(r, opts.seconds * 1000))

  // 只打印窗口打开之后收到的同步值
  const panels = new Map()
  for (const s of syncs) {
    if (!panels.has(s.panel)) panels.set(s.panel, new Map())
    panels.get(s.panel).set(s.key, s)
  }
  if (!panels.size) throw new Error('no ModularUI2 sync values (channel not registered?)')
  for (const [panel, entries] of panels) {
    console.log(`panel ${panel} (${entries.size} keys)`)
    for (const [key, value] of entries) {
      console.log(`  ${key.padEnd(52)} ${value.kind.padEnd(5)} ${describe(value)}`)
    }
  }
  const all = [...panels.values()].flatMap(m => [...m.values()])
  const power = all.find(v => v.key === 'powerSwitch:0')
  if (!power) throw new Error('panel has no powerSwitch key')
  console.log(`✓ ModularUI2 控件流解出 ${all.length} 个值，powerSwitch=${describe(power)}`)
  bot.quit()
  process.exit(0)
}

main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
