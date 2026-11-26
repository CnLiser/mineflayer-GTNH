'use strict'

// 丢弃物品 + 吃食物：动作层的最后两块。
//
// 丢弃走 window_click(-999)（点窗口外），吃掉走 block_place(-1,-1,-1)，
// 服务器用 entity_status 9 表示「用完了」。两者都不看本地模型，
// 以服务器回的 set_slot / update_health / 掉落物实体为准。
const { createBot } = require('..')
const { rcon } = require('protocol-fml/tools/rcon')

const host = process.argv[2] || '127.0.0.1'
const port = Number(process.argv[3] || 54615)
const name = process.argv[4] || 'actionBot'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const BREAD = 297
const DIRT = 3

function fail (msg) {
  console.error('✗ ' + msg)
  process.exit(1)
}

async function main () {
  const bot = createBot({ host, port, username: name })
  bot.on('error', () => {})
  await new Promise((resolve) => bot.once('spawn', resolve))
  const pos = bot.entity.position.floored()
  console.log(`✓ 生成于 (${pos.x}, ${pos.y}, ${pos.z})`)

  await rcon([`op ${name}`, `gamemode 1 ${name}`, `clear ${name}`, `tp ${name} ${pos.x + 0.5} 90 ${pos.z + 0.5}`], { host })
  await sleep(800)

  const Item = require('../lib/gtnh/items')(bot)
  await bot.creative.setInventorySlot(36, new Item(BREAD, 4))
  await sleep(300)
  await bot.creative.setInventorySlot(37, new Item(DIRT, 5))
  await sleep(400)

  // ---- 丢弃 ----
  const dirt = bot.inventory.items().find((i) => i.type === DIRT)
  if (!dirt) fail('没拿到泥土')
  console.log(`  丢弃前：${dirt.name} x${dirt.count} @${dirt.slot}`)
  await bot.tossStack(dirt)
  await sleep(1500)

  const dirtLeft = bot.inventory.items().find((i) => i.type === DIRT)
  if (dirtLeft) fail(`tossStack 后背包里还有泥土 x${dirtLeft.count}`)

  // 服务器应该在我们脚下生成一个 Item 实体
  const dropEntities = Object.values(bot.entities)
    .filter((e) => e !== bot.entity && /item/i.test(String(e.name || e.displayName)))
    .filter((e) => e.position && e.position.distanceTo(bot.entity.position) < 3.5)
  if (dropEntities.length === 0) fail('没看到脚边的掉落物实体')
  console.log(`  ✓ 丢弃物品通过（脚边掉落物 ${dropEntities.length} 个，背包已清空）`)

  // ---- 吃食物 ----
  // 服务端切生存 + 加饥饿，客户端视角仍是创造（1.7 的 gamemode 变更不通知客户端）
  await rcon([`gamemode 0 ${name}`, `effect ${name} 17 300 5`], { host })
  console.log('  等饥饿值掉到 18 以下…')
  for (let i = 0; i < 45; i++) {
    await sleep(1000)
    if (bot.food !== undefined && bot.food < 18) break
  }
  if (bot.food === undefined || bot.food >= 18) fail(`饥饿值没掉下来（food=${bot.food}）`)

  bot.setQuickBarSlot(0)
  await sleep(300)
  const bread = bot.heldItem
  if (!bread || bread.type !== BREAD) fail('手里不是面包')
  const before = { food: bot.food, count: bread.count }
  console.log(`  开始吃：food=${before.food} 面包 x${before.count}`)

  try {
    await bot.consume()
  } catch (e) {
    fail(`consume() 失败：${e.message}`)
  }
  await sleep(800)
  const after = { food: bot.food, count: bot.heldItem ? bot.heldItem.count : 0 }
  if (after.food <= before.food) fail(`饥饿值没回升（${before.food} → ${after.food}）`)
  if (after.count >= before.count) fail(`面包没减少（${before.count} → ${after.count}）`)
  console.log(`  ✓ 吃东西通过（food ${before.food} → ${after.food}，面包 ${before.count} → ${after.count}）`)

  bot.quit()
  await sleep(300)
  console.log('✓ 丢弃 + 吃食物冒烟通过')
  process.exit(0)
}

main().catch((e) => {
  console.error('✗', e)
  process.exit(1)
})
