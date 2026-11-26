'use strict'

/*
 * GTNH 的实体类型表。
 *
 * 原版 1.7.10 只有 50 个实体，装完 mod 后服务器 EntityList 里注册了 148 个数字 id
 * （mod 的生物、投射物、载具都在里面）。minecraft-data 只认识原版那批，
 * 所以 mod 实体在 mineflayer 里一律落成 name='unknown'。
 *
 * 这份表由 jmx 探针 DumpEntity1 从运行中的服务器导出：
 *   net.minecraft.entity.EntityList 的 IDtoClassMapping × classToStringMapping
 */

const fs = require('fs')
const path = require('path')

const ENTITIES_FILE = path.join(__dirname, '..', 'data', 'entities.json')

class EntityTypes {
  constructor (entities) {
    this.list = entities
    this.byId = new Map()
    this.byName = new Map()
    for (const e of entities) {
      this.byId.set(e.id, e)
      this.byName.set(e.name, e)
    }
  }

  get (id) {
    return this.byId.get(Number(id)) || null
  }

  idOf (name) {
    const e = this.byName.get(name)
    return e ? e.id : null
  }

  nameOf (id) {
    const e = this.get(id)
    return e ? e.name : null
  }

  names () {
    return this.list.map((e) => e.name)
  }

  get size () {
    return this.list.length
  }

  /** 只保留 mod 的（类名不以 net.minecraft 开头的） */
  modEntities () {
    return this.list.filter((e) => !String(e.cls).startsWith('net.minecraft'))
  }
}

function loadEntities (file = ENTITIES_FILE) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  return new EntityTypes(data.entities || [])
}

module.exports = { EntityTypes, loadEntities, ENTITIES_FILE }
