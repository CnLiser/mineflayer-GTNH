// GTNH-PATCH smoke test: open a GT machine GUI (ModularUI2) and read it.
//
// GT machines never send `open_window`; the window is inferred from the
// `window_items` packet that ModularUI2's server side sends after the click.
//
//   node tools/machine-smoke.js 127.0.0.1 54615 --pos "33 78 19" --tp "34.5 78 20.5"
//   node tools/machine-smoke.js 127.0.0.1 54615 --auto     # 自己搭台子、放机器、开 GUI
const { createBot } = require('../index')
const { Vec3 } = require('vec3')
const { rcon } = require('../../protocol-fml/tools/rcon')

function parseArgs () {
  const argv = process.argv.slice(2)
  const out = { host: argv[0] || '127.0.0.1', port: Number(argv[1] || 54615), pos: null, tp: null, user: 'machineBot', seconds: 8, auto: false, machine: 281, at: '60 80 60' }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--pos') out.pos = argv[++i].split(/[\s,]+/).map(Number)
    else if (a === '--tp') out.tp = argv[++i]
    else if (a === '--username') out.user = argv[++i]
    else if (a === '--seconds') out.seconds = Number(argv[++i])
    else if (a === '--auto') out.auto = true
    else if (a === '--machine') out.machine = Number(argv[++i])
    else if (a === '--at') out.at = argv[++i]
  }
  return out
}

async function main () {
  const opts = parseArgs()
  const bot = createBot({ host: opts.host, port: opts.port, username: opts.user, auth: 'offline' })
  const windows = []
  bot.on('login', () => console.log('login ok'))
bot.on('spawn', () => console.log('spawn ok'))
bot.on('windowOpen', (w) => windows.push(w))
  bot.on('error', (e) => console.log('[bot error]', String(e.message).slice(0, 120)))

  await new Promise((resolve, reject) => {
    bot.once('spawn', resolve)
    setTimeout(() => reject(new Error('spawn timeout')), 30000)
  })
  await new Promise(r => setTimeout(r, 1500))

  let pos = opts.pos
  if (opts.auto) {
    const scene = require('./scene')
    const Item = require('../lib/gtnh/items')(bot)
    const [ax, ay, az] = opts.at.split(/[\s,]+/).map(Number)
    const rcon1 = scene.rconAt(opts.host)
    await rcon1([`op ${opts.user}`, `gamemode 1 ${opts.user}`])
    await scene.prepareArena(rcon1, { x: ax, y: ay, z: az, radius: 2, username: opts.user })
    await scene.tpTo(rcon1, opts.user, { x: ax + 0.5, y: ay + 1, z: az + 2.5 })
    await scene.giveItem(bot, Item, { id: 3003, meta: opts.machine, count: 1, slot: 36 })
    await scene.placeAt(bot, scene.P(ax, ay, az), 1, { type: 3003, meta: opts.machine })
    pos = [ax, ay + 1, az]
    console.log('auto 场景就绪：机器放在', pos.join(' '))
  }
  if (!pos) {
    // nearest GT machine the bot can see
    const found = bot.findBlock({ maxDistance: 24, matching: (b) => b && /blockmachines/i.test(b.name) })
    if (!found) throw new Error('no gregtech:gt.blockmachines nearby; pass --pos "x y z"')
    pos = [found.position.x, found.position.y, found.position.z]
  }
  console.log('machine', pos.join(' '))

  if (opts.tp && !opts.auto) {
    const res = await rcon([`tp ${opts.user} ${opts.tp}`], { host: opts.host })
    console.log('tp', res.join(' | ').slice(0, 120))
    await new Promise(r => setTimeout(r, 2000))
  }

  const click = async (direction = 1) => {
    bot._client.write('block_place', {
      location: { x: pos[0], y: pos[1], z: pos[2] },
      direction,
      heldItem: { blockId: -1 },
      cursorX: 8,
      cursorY: 16,
      cursorZ: 8
    })
    // ModularUI2 windows open ~150ms after the click
    for (let i = 0; i < 40 && windows.length === 0; i++) await new Promise(r => setTimeout(r, 100))
  }

  await click(1)
  if (!windows.length) throw new Error('no window opened (server refused the click?)')
  const win = windows[0]
  console.log('window', win.id, 'type=' + win.type, 'slots=' + win.slots.length, 'invStart=' + win.inventoryStart)

  const containerSlots = win.slots.slice(0, win.inventoryStart)
  const filled = containerSlots.map((it, i) => it ? `${i}:${it.name}x${it.count}` : null).filter(Boolean)
  console.log('machine slots', win.inventoryStart, 'filled:', filled.join(' ') || '(empty)')
  const invItems = win.slots.slice(win.inventoryStart).map((it, i) => it ? `${win.inventoryStart + i}:${it.name}x${it.count}` : null).filter(Boolean)
  console.log('player slots in window:', invItems.join(' ') || '(empty)')

  // close and reopen: the machine must still answer with a new window id
  bot.closeWindow(win)
  await new Promise(r => setTimeout(r, 800))
  windows.length = 0
  await click(1)
  if (!windows.length) throw new Error('machine did not reopen after close')
  console.log('reopened as window', windows[0].id, 'slots=' + windows[0].slots.length)

  if (win.slots.length <= 36) throw new Error('window has no machine slots')
  console.log('✓ machine GUI (ModularUI2) ready')
  bot.quit()
  process.exit(0)
}

main().catch((e) => { console.log('FAIL', e.message); process.exit(1) })
