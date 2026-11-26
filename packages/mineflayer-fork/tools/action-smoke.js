'use strict'

/*
 * 动作层联机冒烟：生存挖掘 / 攻击实体 / 使用物品。
 *
 *   node tools/action-smoke.js 127.0.0.1 54615 [--username actionBot]
 *
 * 用 RCON 做前置：op、gamemode 0、tp 到开阔地，然后**重连一次**让登录包带上
 * 正确的 gameMode（1.7.10 的 gamemode 变更不会通知已登录的客户端）。
 *
 * 依次验证：
 *   1. 生存模式挖一个真方块：耗时应接近硬度 × 1.5s，且挖完变空气；
 *   2. 召唤一只鸡并连续攻击，直到实体消失；
 *   3. activateItem / deactivateItem 不抛错（1.7 走 block_place）。
 */

const { createBot } = require('..')

const args = process.argv.slice(2)
const host = args[0] || '127.0.0.1'
const port = Number(args[1] || 54615)
const opt = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const username = opt('--username', 'actionBot')
const tp = opt('--tp', '20.5 76 20.5')
const { loadServerMods } = require('..')
const { rcon } = require('protocol-fml/tools/rcon')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fail = (msg) => { console.error('✗', msg); process.exit(1) }

function connect () {
  return new Promise((resolve, reject) => {
    const bot = createBot({ host, port, username, mods: loadServerMods(), hideErrors: true })
    bot.on('error', () => {})
    bot.once('spawn', () => resolve(bot))
    bot.once('end', () => reject(new Error('连接被断开')))
    setTimeout(() => reject(new Error('生成超时（25s）')), 25000)
  })
}

// 在脚边找一块能挖的实体方块（避开 bedrock / 流体 / 带 TE 的）
function findDigTarget (bot) {
  const origin = bot.entity.position.floored()
  const bad = /water|lava|bedrock|barrier|chest|furnace|sign|door|machine/i
  for (let dy = 0; dy >= -2; dy--) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (dx === 0 && dz === 0 && dy === 0) continue
        const block = bot.blockAt(origin.offset(dx, dy, dz))
        if (!block || block.boundingBox !== 'block' || block.diggable !== true) continue
        if (bad.test(block.name)) continue
        return block
      }
    }
  }
  return null
}

;(async () => {
  const killer = setTimeout(() => fail('总超时（90s）'), 90000)

  // ---- 0. 用 RCON 准备好环境，然后重连 ----
  let bot = await connect()
  let player = null
  try {
    await rcon([
      `op ${username}`,
      `gamemode 0 ${username}`,
      `tp ${username} ${tp}`
    ], { host })
    player = { ok: true }
  } catch (err) {
    console.warn('  (RCON 前置失败，继续尝试)', err.message)
  }
  bot.quit()
  await sleep(1200)
  bot = await connect()
  await sleep(2500)
  console.log('✓ 重连后生成于', bot.entity.position.toString(), 'gamemode', bot.game?.gameMode)
  void player

  // ---- 1. 生存模式挖掘 ----
  if (bot.game?.gameMode !== 'survival') {
    console.warn(`  ! gameMode 报告为 ${bot.game?.gameMode}，仍按生存路径测试`)
  }
  const target = findDigTarget(bot)
  if (!target) fail('附近找不到可挖的方块')
  const expected = bot.digTime(target)
  const t0 = Date.now()
  await bot.dig(target)
  const elapsed = Date.now() - t0
  await sleep(600)
  const after = bot.blockAt(target.position)
  console.log(`  挖掘 ${target.name}（硬度 ${target.hardness}）预计 ${expected}ms，实际 ${elapsed}ms → ${after?.name}`)
  if (!after || after.type !== 0) fail(`方块没有被破坏（${after?.name ?? 'null'}）`)
  if (elapsed < 150) fail(`挖掘过快（${elapsed}ms），说明走的是创造模式路径`)
  console.log('✓ 生存挖掘通过')

  // ---- 2. 攻击实体 ----
  const p = bot.entity.position
  const sx = p.x + 2
  const sy = Math.floor(p.y)
  const sz = p.z + 0.5
  // 先清掉附近的鸡，免得后面拿到一只 87 格外的（打不到，服务器直接无视）
  try {
    await rcon([`kill @e[type=Chicken,r=24]`], { host })
  } catch (err) {
    // 1.7 的选择器不一定支持 r=，无所谓
  }
  await sleep(400)

  // 先挂监听再 summon：RCON 往返只有几毫秒，晚挂会漏掉 spawn 包
  const chickenPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 6000)
    const near = (e) => /chicken/i.test(e.name || '') && e.position.distanceTo(bot.entity.position) < 8
    const found = Object.values(bot.entities).find(near)
    if (found) {
      clearTimeout(timer)
      return resolve(found)
    }
    const onSpawn = (e) => {
      if (!near(e)) return
      clearTimeout(timer)
      bot.removeListener('entitySpawn', onSpawn)
      resolve(e)
    }
    bot.on('entitySpawn', onSpawn)
  })
  try {
    await rcon([`summon Chicken ${sx} ${sy} ${sz}`], { host })
  } catch (err) {
    fail('召唤鸡失败：' + err.message + '（需要 op 权限）')
  }
  const chicken = await chickenPromise
  if (!chicken) fail('6 秒内没在 8 格内看到鸡（summon 可能没生效）')
  // 走到鸡旁边再打：1.7 服务器的攻击距离只有 ~4 格，隔 7 格点 15 次它也不会掉血
  try {
    const c = chicken.position
    await rcon([`tp ${username} ${(c.x + 1.2).toFixed(2)} ${c.y.toFixed(2)} ${c.z.toFixed(2)}`], { host })
    await sleep(900)
  } catch (err) {
    console.warn('  (tp 到鸡旁边失败)', err.message)
  }
  console.log('  贴近后距离', bot.entity.position.distanceTo(chicken.position).toFixed(2))
  console.log('✓ 看到实体', chicken.name, 'id=' + chicken.id, '距离', bot.entity.position.distanceTo(chicken.position).toFixed(2))

  let hits = 0
  for (; hits < 15; hits++) {
    if (!bot.entities[chicken.id]) break
    bot.attack(chicken)
    await sleep(600)
  }
  await sleep(800)
  const gone = !bot.entities[chicken.id]
  console.log(`  攻击 ${hits} 次 → ${gone ? '实体已消失' : '实体仍在'}`)
  if (!gone) fail('攻击 15 次后鸡还活着')
  console.log('✓ 攻击实体通过')

  // ---- 3. 使用物品 ----
  const held = bot.heldItem || bot.inventory.slots[36]
  if (!held) {
    console.warn('  ! 手上没有物品，跳过 activateItem')
  } else {
    if (bot.inventory.selectedSlot !== 0) bot.setQuickBarSlot(0)
    try {
      bot.activateItem()
      await sleep(400)
      const using = bot.usingHeldItem === true
      bot.deactivateItem()
      await sleep(200)
      console.log(`  使用 ${held.name} → usingHeldItem=${using}，释放后 ${bot.usingHeldItem}`)
      if (!using) fail('activateItem 没把 usingHeldItem 置位')
      if (bot.usingHeldItem) fail('deactivateItem 没清掉 usingHeldItem')
      console.log('✓ 使用物品通过')
    } catch (err) {
      fail('activateItem 抛错：' + err.message)
    }
  }

  clearTimeout(killer)
  console.log('✓ 动作层冒烟通过')
  bot.quit()
  process.exit(0)
})().catch((err) => fail(err.stack || err.message))
