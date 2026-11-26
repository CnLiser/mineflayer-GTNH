'use strict'

/*
 * 背包冒烟：连上服务端 → 验证 GTNH 的背包线格式与读写。
 *
 * 验证点：
 *   1. window_items 有 **46** 个槽位（Backhand 加的副手槽），字段名是 items；
 *   2. 物品 id 是 **4 字节 int**：新玩家进服时服务器会塞一个
 *      questbook:ItemQuestBook（id 6241 > 255，按 short 读就废了）；
 *   3. 非空物品比原版多一个尾字节 gtnhFlag（恒为 1，空槽没有）；
 *   4. 写方向：window_click 用 10 字节物品能爬上光标并搬到别的槽位，
 *      服务器回 transaction accepted。
 *
 *   node tools/inventory-smoke.js 127.0.0.1 54615
 */

const path = require('path')
const fs = require('fs')
const { createBot } = require('../src')
const { Lang } = require('gtnh-data')

function arg (name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

const host = process.argv[2] ?? '127.0.0.1'
const port = Number(process.argv[3] ?? 54615)
const username = arg('username', 'gtnh-bot')

const langDir = path.join(__dirname, '..', '..', 'gtnh-data', 'data', 'raw', 'gtnh-2.9.0', 'lang')
const lang = new Lang({
  en: JSON.parse(fs.readFileSync(path.join(langDir, 'en_US.json'), 'utf8')),
  zh: JSON.parse(fs.readFileSync(path.join(langDir, 'zh_CN.json'), 'utf8'))
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main () {
  const bot = await createBot({ host, port, username, lang })
  const errors = []
  let windowItemsPacket = null
  const transactions = []

  bot.on('error', (err) => errors.push(err.message))
  bot.on('transaction', (packet) => transactions.push(packet))
  bot.client.on('window_items', (packet) => { windowItemsPacket = packet })

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('等待 spawn 超时')), 30000)
    bot.on('spawn', () => { clearTimeout(timer); resolve() })
  })
  await sleep(1500)

  console.log(`已登录：entity ${bot.entity.id}，坐标 ${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`)
  console.log(`window_items：${windowItemsPacket ? `${windowItemsPacket.items.length} 个槽位` : '未收到'}`)

  const initial = bot.items()
  console.log(`\n=== 进服背包（${initial.length} 件）===`)
  for (const item of initial) {
    const display = item.name ? lang.itemName(item.name) : undefined
    const label = display && display !== item.name ? `${display} / ${item.name}` : item.name
    console.log(`槽位 ${item.slot}: ${label}  id=${item.blockId} 数量=${item.itemCount} damage=${item.itemDamage} flag=${item.gtnhFlag}`)
  }

  let ok = true
  if (!windowItemsPacket) { console.log('✗ 没收到 window_items'); ok = false } else if (windowItemsPacket.items.length !== 46) { console.log(`✗ 槽位数 ${windowItemsPacket.items.length}，应为 46`); ok = false }

  const quest = initial.find((item) => item.blockId === 6241)
  if (!quest) {
    console.log('✗ 没读到进服送的 questbook:ItemQuestBook（id 6241）')
    ok = false
  } else if (quest.itemCount !== 1 || quest.gtnhFlag !== 1) {
    console.log(`✗ questbook 字段异常：count=${quest.itemCount} flag=${quest.gtnhFlag}`)
    ok = false
  }

  // 读写往返：把 questbook 从 36 搬到 37，再搬回去
  if (quest) {
    const from = quest.slot
    const to = from === 36 ? 37 : 36
    console.log(`\n=== 搬运：槽位 ${from} → ${to} ===`)

    bot.pickUp(from)
    await sleep(600)
    console.log(`光标：${bot.inventory.cursor ? `id=${bot.inventory.cursor.blockId}` : '空'}`)

    bot.placeAt(to)
    await sleep(600)
    const moved = bot.inventory.slots[to]
    console.log(`槽位 ${from}：${bot.inventory.slots[from] ? '仍有物品' : '已空'}；槽位 ${to}：${moved ? `id=${moved.blockId}` : '空'}`)
    if (!moved || moved.blockId !== 6241) { console.log('✗ 物品没有搬到目标槽位'); ok = false }

    if (moved) {
      bot.pickUp(to)
      await sleep(600)
      bot.placeAt(from)
      await sleep(600)
      const back = bot.inventory.slots[from]
      console.log(`搬回：槽位 ${from} ${back ? `id=${back.blockId}` : '空'}`)
      if (!back || back.blockId !== 6241) { console.log('✗ 物品没搬回原槽位'); ok = false }
    }
  }

  const accepted = transactions.filter((t) => t.accepted).length
  console.log(`\n事务：${transactions.length} 次点击 / ${accepted} 次被接受`)
  if (transactions.length === 0) { console.log('✗ 服务器没有回 transaction'); ok = false }
  if (errors.length) { console.log(`✗ 错误：${errors.join(' | ')}`); ok = false }

  bot.quit()
  console.log(ok ? '\n✓ 背包层通了（46 槽 + 4 字节物品 id + 尾字节 flag + window_click 读写）' : '\n✗ 背包层未通过')
  await sleep(300)
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
