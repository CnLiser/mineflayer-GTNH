// GTNH machine item smoke test.
//
// Opens a GT machine (ModularUI2 window), then proves both directions of item
// movement against server truth:
//   1. machine slot -> player inventory using a shift click (mode 1)
//   2. player inventory -> empty machine slot using pickup + place clicks
// Because ModularUI2 windows always report accepted=false (see FINDINGS 16),
// every step is verified by closing and reopening the window, i.e. by asking
// the server again instead of trusting the local window model.
//
//   node tools/machine-item-smoke.js 127.0.0.1 54615 --tp "34.5 78 20.5" --machine "33 78 19"

const { createBot } = require('../index')
const { rcon } = require('../../protocol-fml/tools/rcon')

const args = process.argv.slice(2)
const [host = '127.0.0.1', port = '54615'] = args
const opt = (name, dflt) => {
  const i = args.indexOf('--' + name)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const vec = (s, dflt) => (s ? s.split(',').map(Number) : dflt)
// Accept both "a,b,c" and "a b c".
const tpAt = (opt('tp', '34.5,78,20.5').replace(/ /g, ',')).split(',').map(Number)
const machine = (opt('machine', '33,78,19').replace(/ /g, ',')).split(',').map(Number)
const USER = opt('username', 'itemBot')
const DELAY = Number(opt('delay', '600'))

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const bits = [1, 2, 4]
const isVertical = (d) => bits.includes(d)

function fail (msg) {
  console.log('✗ ' + msg)
  process.exit(1)
}

const bot = createBot({ host, port: Number(port), username: USER, auth: 'offline', hideErrors: true })
bot.on('error', () => {})

let windowId = -1
bot._client.on('window_items', (packet) => {
  if (packet.windowId !== 0 && windowId === -1) windowId = packet.windowId
})

function describe (item) {
  if (!item) return null
  return { slot: item.slot, name: item.name, count: item.count }
}

function machineSlots () {
  const w = bot.currentWindow
  return w.slots.slice(0, w.inventoryStart)
}

function playerSlots () {
  const w = bot.currentWindow
  return w.slots.slice(w.inventoryStart)
}

async function openMachine () {
  windowId = -1
  bot.currentWindow = null
  const [x, y, z] = machine
  // Pick a face that looks at the player, then fall back to all six.
  let dirs = [5, 4, 1, 0, 2, 3]
  if (process.env.FACE) dirs = [Number(process.env.FACE)]
  for (const dir of dirs) {
    bot._client.write('block_place', {
      location: { x, y, z },
      direction: dir,
      heldItem: { blockId: -1 },
      cursorX: 8,
      cursorY: 16,
      cursorZ: 8
    })
    for (let i = 0; i < 20 && !bot.currentWindow; i++) await sleep(100)
    if (bot.currentWindow) {
      await sleep(DELAY)
      return bot.currentWindow
    }
  }
  fail('机器没有打开窗口（距离/朝向/权限？）')
}

async function reopen () {
  const w = bot.currentWindow
  if (w) bot._client.write('close_window', { windowId: w.id })
  bot.currentWindow = null
  await sleep(500)
  return openMachine()
}

bot.once('spawn', async () => {
  await sleep(1500)
  if (opt('tp')) {
    await rcon([`tp ${USER} ${tpAt.join(' ')}`], { host })
    await sleep(3000)
  }

  const w = await openMachine()
  console.log(`window ${w.id} type=${w.type} slots=${w.slots.length} inventoryStart=${w.inventoryStart}`)
  console.log('机器槽:', machineSlots().map((it, i) => it ? `${i}:${it.name.split(':').pop()}x${it.count}` : `${i}:-`).join(' '))
  console.log('玩家槽:', playerSlots().map((it, i) => it ? `${i + w.inventoryStart}:${it.name.split(':').pop()}x${it.count}` : '').filter(Boolean).join(' ') || '(empty)')

  // ---- direction 1: machine -> player, shift click ----
  const srcIndex = machineSlots().findIndex((it) => it)
  if (srcIndex >= 0) {
    const before = describe(machineSlots()[srcIndex])
    const playerBefore = playerSlots().reduce((n, it) => n + (it ? it.count : 0), 0)
    try {
      await bot.clickWindow(srcIndex, 0, 1) // mode 1 = shift click
    } catch (err) {
      fail('shift 点击失败: ' + err.message)
    }
    await sleep(DELAY)
    const reopened = await reopen()
    const playerAfter = playerSlots().reduce((n, it) => n + (it ? it.count : 0), 0)
    const stillThere = machineSlots()[srcIndex]
    console.log(`取出 ${before.name} x${before.count}: 机器槽 -> ${stillThere ? '还在' : '已移走'}, 玩家物品 ${playerBefore} -> ${playerAfter}`)
    if (stillThere) fail('shift 点击没有把物品移出机器槽')
    if (playerAfter <= playerBefore) fail('玩家背包数量没有增加')
  } else {
    console.log('（机器槽是空的，跳过取出测试）')
  }

  // ---- direction 2: player -> empty machine slot ----
  const destIndex = machineSlots().findIndex((it) => !it)
  const playerSlotItem = playerSlots().findIndex((it) => it)
  if (destIndex >= 0 && playerSlotItem >= 0) {
    const playerSlot = playerSlotItem + w.inventoryStart
    const item = describe(playerSlots()[playerSlotItem])
    try {
      await bot.clickWindow(playerSlot, 0, 0) // pick up
      await sleep(300)
      await bot.clickWindow(destIndex, 0, 0) // drop into machine slot
      await sleep(300)
      if (bot.currentWindow && bot.currentWindow.selectedItem) await bot.clickWindow(playerSlot, 0, 0)
    } catch (err) {
      fail('放入点击失败: ' + err.message)
    }
    await sleep(DELAY)
    await reopen()
    const landed = machineSlots()[destIndex]
    console.log(`放入 ${item.name} x${item.count}: 机器槽 ${destIndex} -> ${landed ? landed.name.split(':').pop() + 'x' + landed.count : '（空，服务器拒绝）'}`)
    if (!landed) fail('物品没有进入机器槽')
  } else {
    console.log('（无可放入的物品或机器槽已满，跳过放入测试）')
  }

  console.log('✓ 机器物品双向点击通过')
  process.exit(0)
})

setTimeout(() => {
  console.log('✗ 超时')
  process.exit(2)
}, Number(opt('timeout', '120000')))
