// GTNH: 压模机（extruder）冒烟：放机器 → 太阳能供电 → 投「金属锭 + 图案」→ 取部件
// 用法: node tools/extruder-smoke.js [host] [port] [--username ex] [--machine 281]
const { createBot } = require('..')
const { rcon } = require('protocol-fml/tools/rcon')
const { Vec3 } = require('vec3')
const { loadGtRecipes } = require('gtnh-data')
const { KNOWN_MACHINES, findExtruderRecipes, canRun, gtnWindowSlots, readMachineSlots } = require('../lib/gtnh/gtmachine')

const argv = process.argv.slice(2)
const host = argv[0] && !argv[0].startsWith('--') ? argv[0] : '127.0.0.1'
const port = argv[1] && /^\d+$/.test(argv[1]) ? Number(argv[1]) : 54615
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
const username = arg('username', 'extruderBot')
const machineMeta = Number(arg('machine', 281))
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const P = (x, y, z) => new Vec3(x, y, z)
const CUR = { 0: [8, 0, 8], 1: [8, 16, 8], 2: [8, 8, 0], 3: [8, 8, 16], 4: [0, 8, 8], 5: [16, 8, 8] }

;(async () => {
  const info = KNOWN_MACHINES[machineMeta]
  if (!info) throw new Error('unknown machine meta ' + machineMeta)
  const mods = require('protocol-fml/data/raw/server-modlist.json').mods
  const R = (c) => rcon(c, { host, timeout: 40000 })
  const bot = createBot({ host, port, username, version: '1.7.10', mods, hideErrors: true })
  bot.on('kicked', r => console.log('KICKED', r))
  bot.on('error', e => { if (!/Read error|partial/i.test(String(e))) console.log('ERR', e.message) })
  await new Promise(r => bot.once('spawn', r)).catch(() => {})
  await sleep(2000)
  const Item = require('../lib/gtnh/items')(bot)

  await R(['op ' + username, 'gamemode 1 ' + username, 'setblock 50 80 50 minecraft:stone',
    'setblock 51 80 50 minecraft:stone', 'setblock 50 80 51 minecraft:stone', 'tp ' + username + ' 50.5 81 52.5'])
  await sleep(2500)

  const give = async (id, meta, count, slot) => { try { await bot.creative.setInventorySlot(slot, new Item(id, count, meta)) } catch (e) { console.log('give fail', id, e.message) } await sleep(350) }
  await give(3003, machineMeta, 1, 36)
  await give(3003, 2733, 1, 37)   // LV solar panel = 供电
  await give(7639, 11019, 8, 38)  // GT 铁锭
  await give(4526, 2, 1, 39)      // 铁镐头图案

  const clickAt = async (loc, dir, hold) => {
    if (hold) { const it = bot.inventory.items().find(i => i.type === hold.type && i.metadata === hold.meta); if (it) { await bot.equip(it, 'hand'); await sleep(150) } }
    const c = CUR[dir]
    await bot.lookAt(P(loc.x + 0.5 + (c[0] - 8) / 32, loc.y + 0.5 + (c[1] - 8) / 32, loc.z + 0.5 + (c[2] - 8) / 32))
    await sleep(120)
    bot._client.write('block_place', { location: loc, direction: dir, heldItem: { blockId: -1 }, cursorX: c[0], cursorY: c[1], cursorZ: c[2] })
    await sleep(1300)
  }

  await clickAt({ x: 50, y: 80, z: 50 }, 1, { type: 3003, meta: machineMeta })
  const mblock = bot.blockAt(P(50, 81, 50))
  if (!mblock || mblock.name !== 'gregtech:gt.blockmachines') throw new Error('机器没放上')
  console.log('机器', mblock.name, 'meta', mblock.metadata, '档位', info.tier)
  await clickAt({ x: 51, y: 80, z: 50 }, 1, { type: 3003, meta: 2733 })
  console.log('供电', bot.blockAt(P(51, 81, 50)) && bot.blockAt(P(51, 81, 50)).name)

  const open = async () => { if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(600) } await clickAt({ x: 50, y: 81, z: 50 }, 1); await sleep(700); return bot.currentWindow }
  let w = await open()
  const map = gtnWindowSlots(w)
  bot.clickWindow(map.forInv(38), 0, 1); await sleep(1500)
  bot.clickWindow(map.forInv(39), 0, 1); await sleep(1500)
  if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(800) }

  let out = null
  for (let i = 0; i < 20; i++) {
    await sleep(6000)
    w = await open()
    const s = readMachineSlots(w, info)
    if (s.output) { out = s.output; break }
  }
  if (!out) throw new Error('60 秒内没有产出')
  const name = bot.registry.items[out.type] ? bot.registry.items[out.type].name : String(out.type)
  console.log('产出', name + 'x' + out.count + '@' + out.metadata)

  // 配方电压校验
  const g = loadGtRecipes()
  const rs = findExtruderRecipes(g, { output: { id: out.type, meta: out.metadata } })
  const r = rs[0]
  if (r) {
    const c = canRun(r, info.tier)
    console.log('配方', r.eu + ' EU/t, ' + r.dur + 't →', c.ok ? `✓ ${info.tier} 档可跑` : `✗ ${c.reason}`)
    if (!c.ok) process.exitCode = 1
  }
  // 取件
  bot.clickWindow(info.slots.out, 0, 0); await sleep(1200)
  if (bot.currentWindow) { bot.closeWindow(bot.currentWindow); await sleep(600) }
  const have = bot.inventory.items().find(i => i.type === out.type)
  console.log(have ? `✓ 已取到 ${name} x${have.count}` : '✗ 没取到')
  if (!have) process.exitCode = 1
  console.log('✓ 压模机冒烟通过')
  bot.quit(); process.exit(process.exitCode || 0)
})().catch(e => { console.error('FATAL', e.stack.split('\n').slice(0, 2).join(' | ')); process.exit(1) })
