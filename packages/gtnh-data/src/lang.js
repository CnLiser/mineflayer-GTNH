'use strict'

/*
 * GTNH 的语言文件（en_US / zh_CN，来自整合包 jar 里的 lang）。
 *
 * 1.7.10 的 lang 是 「tile.xxx.name」 / 「item.xxx.name」 这种键，
 * 而 FML 注册表给的是 "modid:name" —— 两者对应规则是先到先得的替换：
 *   minecraft:stone      -> tile.stone.name
 *   gregtech:gt.blockmachines -> tile.gt.blockmachines.name
 * 精确到 metadata 的变体还有 tile.stone.granite.name 这种，所以查找要带后缀尝试。
 */

class Lang {
  constructor (data = {}) {
    this.en = data.en ?? {}
    this.zh = data.zh ?? {}
    this.fallback = data.fallback ?? 'en'
  }

  static fromObject (data) {
    return new Lang(data)
  }

  // 原始键查找
  key (k) {
    return this.zh[k] ?? this.en[k]
  }

  /*
   * 方块显示名。
   * name 形如 "minecraft:stone" 或 "gregtech:gt.blockmachines:5"
   */
  blockName (name) {
    if (!name) return undefined
    const [modid, ...rest] = name.split(':')
    let base = rest.join(':')
    let meta = null
    const parts = name.split(':')
    if (parts.length > 2) {
      meta = parts[2]
      base = parts[1]
    }
    const candidates = []
    if (meta !== null && meta !== '0') {
      candidates.push(`tile.${base}.${meta}.name`, `tile.${base}.name.${meta}`, `tile.${base}.name`)
    } else {
      candidates.push(`tile.${base}.name`)
    }
    // 有些 mod 的键直接是 modid + ":" 前缀（GT 的机器是 tile.gt.blockmachines.name）
    for (const c of candidates) {
      const v = this.key(c)
      if (v) return v
    }
    // 兜底：直接拿注册名
    return name
  }

  itemName (name) {
    if (!name) return undefined
    const parts = name.split(':')
    const base = parts.length > 2 ? parts[1] : parts.slice(1).join(':')
    const candidates = [`item.${base}.name`, `item.${base}.name.${parts[2] ?? '0'}`]
    for (const c of candidates) {
      const v = this.key(c)
      if (v) return v
    }
    return name
  }

  get size () {
    return { en: Object.keys(this.en).length, zh: Object.keys(this.zh).length }
  }
}

module.exports = { Lang }
