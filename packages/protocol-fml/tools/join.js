'use strict'

/*
 * 连服务器跑完整 FML 握手，导出服务器下发的 ModIdData（方块/物品 ID 表）。
 *
 * 用法：
 *   node tools/join.js <host> <port> [--mods <json>] [--out <file>] [--seconds 20] [--username Name]
 *
 * --mods 默认读 data/raw/server-modlist.json（ping 拿到的服务器 ModList，回声最稳）。
 */

const fs = require('fs')
const path = require('path')
const { createFmlClient } = require('../src')

function arg (name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

function loadMods (file) {
  const mods = JSON.parse(fs.readFileSync(file, 'utf8'))
  return Array.isArray(mods) ? mods : mods.mods
}

function main () {
  const host = process.argv[2]
  const port = Number(process.argv[3])
  if (!host || !port) {
    console.error('usage: node tools/join.js <host> <port> [--mods <json>] [--out <file>] [--seconds 20]')
    process.exit(1)
  }
  const modsFile = arg('--mods', path.join(__dirname, '..', 'data', 'raw', 'server-modlist.json'))
  const out = arg('--out', path.join(__dirname, '..', 'data', 'raw', 'fml-registry.json'))
  const seconds = Number(arg('--seconds', 20))
  const username = arg('--username', 'GtnhBot')
  const mods = loadMods(modsFile)

  console.log(`连接 ${host}:${port} 作为 ${username}，回声 ${mods.length} 个 mod`)
  const client = createFmlClient({
    host,
    port,
    username,
    mods,
    log: msg => console.log(`[fml] ${msg}`)
  })

  let joined = false
  client.fml.on('serverHello', e => console.log(`[fml] ServerHello proto=${e.protocolVersion} dim=${e.dimension}`))
  client.fml.on('serverModList', list => console.log(`[fml] 服务器 ModList: ${list.length} 个`))
  client.fml.on('modListChecked', e => {
    console.log(`[fml] 校验: 服务器 ${e.serverCount} / 缺失 ${e.missing.length} / 版本不符 ${e.mismatched.length}`)
    for (const m of e.missing.slice(0, 10)) console.log(`       缺失 ${m}`)
    for (const m of e.mismatched.slice(0, 10)) console.log(`       版本不符 ${m}`)
  })
  client.fml.on('multipartComplete', e => console.log(`[fml] 分片重组完成: ${e.channel} ${e.length}B`))
  client.fml.on('registryRaw', e => {
    console.log(`[fml] ModIdData 原始包 ${e.data.length}B，前 64 字节: ${e.data.subarray(0, 64).toString('hex')}`)
  })
  client.fml.on('registryParseError', e => console.log(`[fml] ModIdData 解析失败: ${e.message}`))
  client.fml.on('registry', e => console.log(`[fml] ModIdData: ${e.entries.length} 条`))
  client.fml.on('registryTrailing', e => console.log(`[fml] 注意: 解析消耗 ${e.consumed}/${e.total} 字节，尾部有剩余`))
  client.fml.on('serverAck', e => console.log(`[fml] 服务器 ACK phase=${e.phase}（本地 ${e.clientPhase}）`))
  client.fml.on('complete', e => {
    const registry = client.fml.registry
    const data = {
      host,
      port,
      capturedAt: new Date().toISOString(),
      mods: client.fml.serverMods,
      blocks: Object.fromEntries(registry.blocks),
      items: Object.fromEntries(registry.items),
      blockSubstitutions: registry.blockSubstitutions,
      itemSubstitutions: registry.itemSubstitutions
    }
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, JSON.stringify(data, null, 2))
    console.log(`[fml] 握手完成: ${e.blocks} 方块 / ${e.items} 物品 / ${e.mods} mods`)
    console.log(`[fml] 注册表已保存: ${out}`)
  })

  client.on('login', packet => {
    joined = true
    console.log(`[login] JoinGame: entityId=${packet.entityId} gamemode=${packet.gameMode} dimension=${packet.dimension} ` +
      `levelType=${packet.levelType} viewDistance=${packet.viewDistance}`)
  })
  client.on('error', err => console.log(`[error] ${err.message}`))
  client.on('end', reason => console.log(`[end] ${reason}`))

  setTimeout(() => {
    console.log(joined ? '[done] 已进入游戏，退出' : '[done] 超时，未进入游戏，退出')
    try { client.end('done') } catch (e) { /* ignore */ }
    setTimeout(() => process.exit(joined ? 0 : 1), 300)
  }, seconds * 1000)
}

main()
