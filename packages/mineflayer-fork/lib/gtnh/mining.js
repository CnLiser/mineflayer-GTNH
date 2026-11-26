// GTNH-PATCH: 挖矿循环——找目标方块、走过去、挖掉、捡掉落物。
//
// 上游 mineflayer 有 bot.dig()，但「挖矿」是一串动作：找最近的矿、绕过/挖穿挡路的石头、
// 站在挖得到的位置、挖完把掉落物捡起来。这一层把这些串起来，脚本只写一句
// `await bot.mineNearby('minecraft:coal_ore', { count: 4 })`。
const { Vec3 } = require('vec3')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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

// 挖一块。站得太远就先走过去（允许挖穿挡路的方块）
async function mineBlock (bot, block, opts = {}) {
  const reach = opts.reach || 3
  const pos = block.position
  if (bot.entity.position.distanceTo(pos) > reach) {
    // 站到方块旁边一格，别站到它正上方（挖自己脚下会掉下去）
    const stand = new Vec3(pos.x + 1, pos.y, pos.z + 1) // 和矿同层站，别站到空中
    const ok = await bot.goto(stand, { dig: opts.dig !== false, timeoutMs: opts.timeoutMs || 20000 })
    if (!ok) return false
  }
  const fresh = bot.blockAt(pos)
  if (!fresh || !fresh.boundingBox || fresh.boundingBox === 'empty') return false
  if (!opts.force && bot.canDigBlock && !bot.canDigBlock(fresh)) return false
  try {
    await bot.dig(fresh, opts.force)
  } catch (e) {
    return false
  }
  await sleep(opts.afterMs || 250)
  return true
}

// 把附近掉的物品捡起来（走过去就行，1.7 的拾取半径约 1 格）
async function collectDrops (bot, opts = {}) {
  const radius = opts.collectRadius || 5
  const deadline = Date.now() + (opts.collectMs || 6000)
  let picked = 0
  while (Date.now() < deadline) {
    const drops = Object.values(bot.entities).filter((e) =>
      e.name === 'item' && e.position && e.position.distanceTo(bot.entity.position) <= radius)
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
  for (const pos of found) {
    if (mined.length >= want) break
    const b = bot.blockAt(pos)
    if (!b || !b.boundingBox || b.boundingBox === 'empty') continue
    if (await mineBlock(bot, b, opts)) mined.push({ name: b.name, position: pos })
  }
  if (opts.collect !== false && mined.length) await collectDrops(bot, opts)
  return mined
}

function attachMining (bot) {
  bot.mineNearby = (name, opts) => mineNearby(bot, name, opts)
  bot.mineBlock = (block, opts) => mineBlock(bot, block, opts)
  bot.collectDrops = (opts) => collectDrops(bot, opts)
}

module.exports = { resolveBlock, blockIdsFor, mineBlock, collectDrops, mineNearby, attachMining }
