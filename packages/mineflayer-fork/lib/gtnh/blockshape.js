'use strict'

/*
 * GTNH-PATCH: 1.7.10 的方块碰撞箱。
 *
 * minecraft-data 的 1.7.10 数据里所有方块都是 boundingBox='block'
 * （只有 block/empty 两种，没有 shapes 数组），所以 prismarine-physics 的
 * 老版本会把半砖、台阶、栅栏、地毯全当成整块。这里按注册名 + metadata
 * 补一张表，只覆盖「明显不是整块」的原版方块；mod 方块回落整块。
 *
 * 每个盒子都是相对方块原点的 AABB：{ minX, minY, minZ, maxX, maxY, maxZ }，
 * 单位是格（0..1）。返回 [] 表示可穿过。
 */

const FULL = Object.freeze([Object.freeze({ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 })])

function slab (meta) {
  return (meta & 8) ? FULL : [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 }]
}

function stairs (meta) {
  // bit 3（0x8）= 倒置：碰撞盒在上半格
  return (meta & 8)
    ? [{ minX: 0, minY: 0.5, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }]
    : [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5, maxZ: 1 }]
}

function tall (height) {
  return () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: height, maxZ: 1 }]
}

// 按名字后缀匹配（minecraft 与 mod 共用），越具体的放前面
const RULES = [
  [/(^|:)double_slab$/, () => FULL],
  [/(^|:)[a-z0-9_]*slab$/, slab],
  [/(^|:)[a-z0-9_]*stairs$/, stairs],
  [/(^|:)fence_gate$/, tall(1.5)],
  [/(^|:)[a-z0-9_]*fence$/, tall(1.5)],
  [/(^|:)[a-z0-9_]*wall$/, tall(1.5)],
  [/(^|:)carpet$/, () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.0625, maxZ: 1 }]],
  [/(^|:)snow_layer$/, (meta) => {
    const layers = meta & 7
    return layers === 0 ? [] : [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: layers * 0.125, maxZ: 1 }]
  }],
  [/(^|:)farmland$/, tall(0.9375)],
  [/(^|:)chest$/, tall(0.875)],
  [/(^|:)bed$/, tall(0.5625)],
  [/(^|:)enchanting_table$/, tall(0.75)],
  [/(^|:)cake$/, tall(0.4375)],
  [/(^|:)brewing_stand$/, tall(0.875)]
]

/*
 * 方块 → 相对碰撞盒数组。返回 [] 表示没有碰撞。
 * block 可以是 prismarine-block（有 name/metadata/boundingBox/shapes），也可以是 null。
 */
function blockShapes (block) {
  if (!block) return []
  if (block.boundingBox === 'empty') return []
  // 将来换到带 shapes 的数据（1.13+）就直接用，不必维护这张表
  if (Array.isArray(block.shapes) && block.shapes.length > 0) return block.shapes
  if (block.boundingBox !== 'block') return []

  const name = String(block.name || '').toLowerCase()
  const meta = (block.metadata || 0) & 0xf
  for (const [re, fn] of RULES) {
    if (re.test(name)) return fn(meta)
  }
  return FULL
}

module.exports = { blockShapes, RULES, FULL }
