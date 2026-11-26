'use strict'
// GTNH 的实体类型表（148 个数字 id，其中 98 个来自 mod）。
// minecraft-data 只认识原版 50 个，mod 实体原本一律落成 name='unknown'。
const { loadEntities } = require('gtnh-data')

let cached = null

function entityTypes () {
  if (cached === null) cached = loadEntities()
  return cached
}

/**
 * internalId → 与 minecraft-data 同形的实体描述；表里没有返回 null。
 *
 * 宽高取原版「怪物」的默认值：1.7 的 EntityList 不带碰撞箱信息，
 * 而 mineflayer 只用它算视线/命中，宽高差一点不影响判断。
 */
function gtnhEntityData (internalId) {
  const e = entityTypes().get(internalId)
  if (!e) return null
  return {
    id: e.id,
    type: 'mob',
    name: e.name,
    displayName: e.name,
    category: 'Unknown',
    width: 0.6,
    height: 1.8,
    internalId: e.id,
    gtnhClass: e.cls
  }
}

module.exports = { entityTypes, gtnhEntityData }
