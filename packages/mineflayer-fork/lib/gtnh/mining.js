// GTNH-PATCH: 挖矿循环——找目标方块、走过去、挖掉、捡掉落物。
//
// 上游 mineflayer 有 bot.dig()，但「挖矿」是一串动作：找最近的矿、绕过/挖穿挡路的石头、
// 站在挖得到的位置、挖完把掉落物捡起来。这一层把这些串起来，脚本只写一句
// `await bot.mineNearby('minecraft:coal_ore', { count: 4 })`。
const { Vec3 } = require('vec3')
const { equipToolFor } = require('./harvest')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 服务端不退 blockUpdate 时 bot.dig() 会永远挂着（挖不动、工具不对、区块卸载都会这样），
// 所以所有挖掘动作都套一层超时：挖不动就换下一块，别把整个循环挂死。
function withTimeout (promise, ms, fallback) {
  let timer
  return Promise.race([
    promise.catch(() => fallback),
    new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), ms) })
  ]).finally(() => clearTimeout(timer))
}

// 名字（或名字数组）→ 方块 id 列表。GTNH 的注册名没有 `minecraft:` 前缀，这里两种都收。
function resolveBlock (bot, n) {
  if (typeof n === 'number') return bot.registry.blocks[n] || null
  return bot.registry.blocksByName[n] || bot.registry.blocksByName[n.replace(/^minecraft:/, '')] || null
}

function blockIdsFor (bot, name) {
  const names = Array.isArray(name) ? name : [name]
  const ids = []
  for (const n of names) {
    const def = resolveBlock(bot, n)
    if (def) ids.push(def.id)
  }
  return ids
}

// 挖一块。站得太远就先走过去（允许挖穿挡路的方块）；挖之前先把需要的工具换上
// （GT 的矿要镐、机器要扳手、线缆要剪线钳，见 lib/gtnh/harvest.js）。
async function mineBlock (bot, block, opts = {}) {
  const reach = opts.reach || 3
  const pos = block.position
  if (bot.entity.position.distanceTo(pos) > reach) {
    // 站到方块**旁边的上一层**：脚下方块就是矿的邻居，有地面支撑，不会掉进坑里。
    // （第一版站「和矿同层」的那格——地表挖矿时那格是空气，bot 会掉下去；
    //   另一版站「矿正上方」，挖掉后自己就掉进坑。）
    const stand = new Vec3(pos.x + 1, pos.y + 1, pos.z)
    const ok = await bot.goto(stand, { dig: opts.dig !== false, timeoutMs: opts.timeoutMs || 20000 })
    // 走不过去但还在服务端的方块交互半径里（1.7 约 5 格），就直接挖——别白跑一趟
    if (!ok && bot.entity.position.distanceTo(pos) > 5) return false
  }
  const fresh = bot.blockAt(pos)
  if (!fresh || !fresh.boundingBox || fresh.boundingBox === 'empty') return false
  // 不直接用 bot.canDigBlock：它要求 prismarine 的 block.diggable，而 GTNH 的方块原型
  // 多数没这个字段（注册表来自 FML 的 ModIdData，不是 minecraft-data），
  // 会把所有 GTNH 方块判成「挖不了」。这里只排除液体/火焰/基岩，剩下的交给 bot.dig 试。
  if (!opts.force && /water|lava|fire|bedrock|barrier/i.test(fresh.name || '')) return false
  const tool = await equipToolFor(bot, fresh, opts)
  if (!tool.ok) { bot._lastMineReason = tool.reason; return false }
  const dug = await withTimeout(bot.dig(fresh, opts.force), opts.digTimeoutMs || 10000, 'timeout')
  if (dug === 'timeout') { bot._lastMineReason = `挖掘超时（${fresh.name}）`; return false }
  await sleep(opts.afterMs || 250)
  bot._lastMineReason = null
  return true
}

// 把附近掉的物品捡起来（走过去就行，1.7 的拾取半径约 1 格）
async function collectDrops (bot, opts = {}) {
  const radius = opts.collectRadius || 5
  const deadline = Date.now() + (opts.collectMs || 6000)
  let picked = 0
  while (Date.now() < deadline) {
    // GTNH-PATCH（2026-11-27）：1.7.10 的掉落物实体注册名是 `Item`（大写），
    // 上游 mineflayer 的 mcdata 里叫 `item`，严格相等会一个也捡不到——实测
    // 三个掉落物就在脚边、背包却是空的。这里大小写都认。
    const drops = Object.values(bot.entities).filter((e) =>
      e && typeof e.name === 'string' && /^item$/i.test(e.name) &&
      e.position && e.position.distanceTo(bot.entity.position) <= radius)
    if (!drops.length) break
    const it = drops[0]
    try { await bot.goto(it.position, { timeoutMs: 4000 }) } catch (e) { /* 捡不到就算了 */ }
    await sleep(250)
    picked++
  }
  return picked
}

// 主入口：找最近的 N 块目标方块，逐个挖掉，最后捡掉落物
async function mineNearby (bot, name, opts = {}) {
  const ids = blockIdsFor(bot, name)
  if (!ids.length) throw new Error('registry 里没有方块：' + (Array.isArray(name) ? name.join(',') : name))
  const want = opts.count || 1
  const found = bot.findBlocks({ matching: ids, maxDistance: opts.radius || 16, count: want * 4 })
  const mined = []
  const skipped = []
  for (const pos of found) {
    if (mined.length >= want) break
    const b = bot.blockAt(pos)
    if (!b || !b.boundingBox || b.boundingBox === 'empty') continue
    if (await mineBlock(bot, b, opts)) mined.push({ name: b.name, position: pos })
    else skipped.push({ name: b.name, position: pos, reason: bot._lastMineReason || '挖不动' })
  }
  mined.skipped = skipped
  if (opts.collect !== false && mined.length) await collectDrops(bot, opts)
  return mined
}

function attachMining (bot) {
  bot.mineNearby = (name, opts) => mineNearby(bot, name, opts)
  bot.mineBlock = (block, opts) => mineBlock(bot, block, opts)
  bot.collectDrops = (opts) => collectDrops(bot, opts)
}

module.exports = { resolveBlock, blockIdsFor, mineBlock, collectDrops, mineNearby, attachMining }
