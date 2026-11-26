'use strict'

/*
 * 服务器 mod 列表（FML 握手要按服务器下发的顺序/数量回声，少一个就被踢）。
 *
 * 原来在 packages/mineflayer-gtnh/src/index.js 里，旧包归档后搬到这里。
 * 数据由 packages/protocol-fml/tools/ping.js 落盘：
 *   data/raw/local-server-modlist.json  （本机随手 ping 的，优先）
 *   data/raw/server-modlist.json        （服务器基线）
 */

const fs = require('fs')
const path = require('path')

function rawDirs () {
  const dirs = []
  // 正常情况：protocol-fml 是 workspace 依赖，从它的包根找
  try {
    dirs.push(path.join(path.dirname(require.resolve('protocol-fml/package.json')), 'data', 'raw'))
  } catch {}
  // 兜底：按仓库布局找（packages/mineflayer-fork/lib/gtnh → packages/protocol-fml）
  dirs.push(path.join(__dirname, '..', '..', '..', 'protocol-fml', 'data', 'raw'))
  return dirs
}

function loadServerMods (file) {
  const candidates = file
    ? [file]
    : rawDirs().flatMap((dir) => [
      path.join(dir, 'local-server-modlist.json'),
      path.join(dir, 'server-modlist.json')
    ])
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    const data = JSON.parse(fs.readFileSync(candidate, 'utf8'))
    const mods = Array.isArray(data) ? data : data.mods
    if (Array.isArray(mods) && mods.length) return mods
  }
  return []
}

module.exports = { loadServerMods }
