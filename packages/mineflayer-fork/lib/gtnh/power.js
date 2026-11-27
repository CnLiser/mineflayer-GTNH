// GTNH 供电链路的三个动作：放发电机/导线、剪线钳连接、扳手调面。
//
// 全部走同一个包：`block_place`（1.7.10 的右键）。区别只在于手上拿什么、
// 以及扳手调面时要先潜行（GT 的 ItemWrench 只在 `player.isSneaking()` 时
// 走「调面」分支，否则是「拆机器」）。
//
// 线缆的 damage 是「材质 + 粗细」编码，GTNH 2.9.0 里：
//   1240 = 1x 锡导线（裸线）、1246 = 1x 锡线缆（绝缘）
// 方块 meta 8..11 = 线缆（4 种粗细），harvest 表里 tool=cutter 的只有它们。

const { Vec3 } = require('vec3')

/** 六个面的光标位置（16 分之几），与 tools/scene.js 的 CUR 一致 */
const CUR = { 0: [8, 0, 8], 1: [8, 16, 8], 2: [8, 8, 0], 3: [8, 8, 16], 4: [0, 8, 8], 5: [16, 8, 8] }

/** 与工具类型对应的物品（GT 的工具都在 metatool.01 下，type 是老 id） */
const TOOL_ITEM = { wrench: { id: 7649, damage: 16 }, cutter: { id: 7649, damage: 26 } }

const CABLE = {
  tin1xBare: { id: 3003, damage: 1240 },
  tin1xInsulated: { id: 3003, damage: 1246 }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 右键一个方块的某个面。
 * @param {object} opts { sneak, waitMs, cursor }
 */
async function useOn (bot, pos, face, opts = {}) {
  const c = CUR[face] ?? CUR[1]
  const cursor = opts.cursor ?? { x: c[0], y: c[1], z: c[2] }
  await bot.lookAt(new Vec3(pos.x + c[0] / 16, pos.y + c[1] / 16, pos.z + c[2] / 16), true)
  await sleep(120)
  if (opts.sneak) {
    bot.setControlState('sneak', true)
    await sleep(250)
  }
  bot._client.write('block_place', {
    location: { x: pos.x, y: pos.y, z: pos.z },
    direction: face,
    heldItem: { blockId: -1 },
    cursorX: cursor.x,
    cursorY: cursor.y,
    cursorZ: cursor.z
  })
  if (opts.sneak) {
    await sleep(150)
    bot.setControlState('sneak', false)
  }
  await sleep(opts.waitMs ?? 800)
}

/** 把一件物品放到手上（快捷栏第 0 格），返回它 */
async function hold (bot, itemFactory, spec) {
  const Item = itemFactory(bot)
  const it = new Item(spec.id, spec.count ?? 1, spec.damage ?? 0)
  await bot.creative.setInventorySlot(36, it)
  bot.setQuickBarSlot(0)
  await sleep(600)
  return it
}

/**
 * 往 `at` 位置放一个方块（用 `below` 方块的顶面当依托）。
 * @param {object} at { x, y, z } 目标方块位置
 * @param {object} spec { id, damage, count }
 */
async function placeBlock (bot, itemFactory, at, spec) {
  await hold(bot, itemFactory, spec)
  const below = { x: at.x, y: at.y - 1, z: at.z }
  await useOn(bot, below, 1, { waitMs: 1300 })
  const got = bot.blockAt(new Vec3(at.x, at.y, at.z))
  return got && got.name !== 'air' ? got : null
}

/** 放一根导线（默认 1x 锡裸线） */
async function placeCable (bot, itemFactory, at, spec = CABLE.tin1xBare) {
  return placeBlock(bot, itemFactory, at, spec)
}

/**
 * 剪线钳右键导线的一个面，建立那一侧的连接。
 * GT 的线缆不会自动吸附，必须每个方向单独点一次。
 */
async function connectCable (bot, itemFactory, at, face) {
  await hold(bot, itemFactory, TOOL_ITEM.cutter)
  await useOn(bot, at, face, { waitMs: 900 })
  return true
}

/**
 * 扳手 shift+右键，把某个面设成「输出面」（发电机/机器都只有一个面朝外）。
 * 不潜行是「拆机器」，所以这里必须潜行。
 */
async function setOutputFace (bot, itemFactory, at, face) {
  await hold(bot, itemFactory, TOOL_ITEM.wrench)
  await useOn(bot, at, face, { sneak: true, waitMs: 900 })
  return true
}

/** 机器/发电机周围有没有能导电的东西（诊断用，读方块名） */
function powerNeighbours (bot, pos) {
  const found = []
  const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
  for (const [dx, dy, dz] of dirs) {
    const b = bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz))
    if (!b || b.name === 'air') continue
    if (b.name === 'gregtech:gt.blockmachines') found.push({ name: b.name, metadata: b.metadata, offset: [dx, dy, dz] })
  }
  return found
}

/**
 * 从发电机往机器拉一根直线上的导线（只支持同轴的简单情况）。
 * 返回可连接的面：发电机朝向导线的那面、导线两端的面、机器朝向导线的那面。
 */
function cablePlan (from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const nonzero = [dx, dy, dz].filter((v) => v !== 0).length
  if (nonzero !== 1) return null        // 只处理同轴的简单情况
  const axis = dx !== 0 ? 'x' : (dy !== 0 ? 'y' : 'z')
  const step = axis === 'x' ? Math.sign(dx) : axis === 'y' ? Math.sign(dy) : Math.sign(dz)
  const len = Math.abs(axis === 'x' ? dx : axis === 'y' ? dy : dz)
  const cells = []
  for (let i = 1; i < len; i++) {
    cells.push(axis === 'x' ? { x: from.x + step * i, y: from.y, z: from.z }
      : axis === 'y' ? { x: from.x, y: from.y + step * i, z: from.z }
        : { x: from.x, y: from.y, z: from.z + step * i })
  }
  // 面：0=-y 1=+y 2=-z 3=+z 4=-x 5=+x
  const plusFace = axis === 'x' ? 5 : axis === 'y' ? 1 : 3
  const minusFace = axis === 'x' ? 4 : axis === 'y' ? 0 : 2
  // 发电机在 to 一侧，它的输出面朝回机器；机器的输入面朝发电机
  const genFace = step > 0 ? minusFace : plusFace
  const machineFace = step > 0 ? plusFace : minusFace
  return { cells, genFace, machineFace, axis }
}

module.exports = {
  CUR,
  CABLE,
  TOOL_ITEM,
  useOn,
  hold,
  placeBlock,
  placeCable,
  connectCable,
  setOutputFace,
  powerNeighbours,
  cablePlan
}
