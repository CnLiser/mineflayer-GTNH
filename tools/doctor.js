#!/usr/bin/env node
'use strict'

/*
 * 环境自检：接手的人（或 AI）跑一次，缺什么一次说清。
 *
 *   npm run doctor            # 全查（服务端那项连不上只提示）
 *   npm run doctor -- 54616   # 换端口
 *
 * 退出码：有「需要处理」的项就 1，否则 0。服务端没开不算失败。
 */

const fs = require('fs')
const net = require('net')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PORT = Number(process.argv[2] || 54615)
const HOST = '127.0.0.1'

const ok = []
const bad = []
const info = []

function pass (msg) { ok.push(msg); console.log(`  ✓ ${msg}`) }
function fail (msg, fix) { bad.push({ msg, fix }); console.log(`  ✗ ${msg}${fix ? `\n      → ${fix}` : ''}`) }
function note (msg) { info.push(msg); console.log(`  … ${msg}`) }

const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function fileCheck (name, file, minBytes = 10) {
  const full = path.join(ROOT, file)
  if (!fs.existsSync(full)) {
    fail(`${name} 缺失：${file}`, '数据文件不入库的实现见 docs/HANDOVER.md §5；正常 clone 后应自带（gtnh-data/data/）')
    return null
  }
  const size = fs.statSync(full).size
  if (size < minBytes) {
    fail(`${name} 只有 ${size} 字节：${file}`, '文件是空的，重新生成')
    return null
  }
  pass(`${name} ${mb(size)}：${file}`)
  return full
}

console.log(`\nmineflayer-GTNH 环境自检  (${ROOT})\n`)

// ---------------------------------------------------------------- 运行时
console.log('运行时')
const major = Number(process.versions.node.split('.')[0])
if (major >= 22) pass(`Node ${process.version}`)
else fail(`Node ${process.version}，要求 >= 22`, 'engines 写的是 >=22，16/18 会缺 fs.glob 等新 API')

for (const pkg of ['protocol-fml', 'gtnh-data', 'prismarine-chunk-1.7', 'mineflayer-fork']) {
  try {
    require.resolve(pkg, { paths: [ROOT] })
    pass(`包 ${pkg} 可解析`)
  } catch {
    fail(`包 ${pkg} 解析不到`, '在仓库根跑 npm install（workspace 链接）')
  }
}

// ---------------------------------------------------------------- 数据
console.log('\n数据（离线测试和查配方都靠它）')
fileCheck('矿辞表', 'packages/gtnh-data/data/recipes/oredict.json')
fileCheck('原版合成', 'packages/gtnh-data/data/recipes/crafting.json')
fileCheck('原版熔炉', 'packages/gtnh-data/data/recipes/smelting.json')
fileCheck('GT 机器配方', 'packages/gtnh-data/data/gt/gt-recipes.jsonl.gz')
fileCheck('mod 配方', 'packages/gtnh-data/data/recipes/mod-recipes.json')
fileCheck('实体表', 'packages/gtnh-data/data/entities.json')
fileCheck('TiC 静态表', 'packages/gtnh-data/data/tconstruct/tconstruct.json')
fileCheck('语言表 en', 'packages/gtnh-data/data/raw/gtnh-2.9.0/lang/en_US.json')
fileCheck('语言表 zh', 'packages/gtnh-data/data/raw/gtnh-2.9.0/lang/zh_CN.json')
fileCheck('服务器 mod 列表', 'packages/protocol-fml/data/raw/server-modlist.json')

// ---------------------------------------------------------------- Java
console.log('\nJava（只有重新导出数据时才要）')
const javaHome = process.env.JAVA_HOME
const javaBin = javaHome ? path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java') : 'java'
const javaRun = spawnSync(javaBin, ['-version'], { encoding: 'utf8' })
if (javaRun.status === 0) {
  const line = `${javaRun.stdout}${javaRun.stderr}`.split('\n').find((l) => /version "/.test(l)) || 'java（版本未知）'
  pass(line.replace(/^\s*picked up.*$/i, '').trim())
} else {
  note('没找到 java（JAVA_HOME 与 PATH 都没有）。不影响连服和测试，只影响重新导出配方数据')
}

// ---------------------------------------------------------------- 服务端
console.log(`\n服务端（${HOST}:${PORT}，可选）`)
const probe = net.connect({ host: HOST, port: PORT })
probe.setTimeout(1500)
probe.once('connect', () => {
  probe.destroy()
  pass(`GTNH 服务端在 ${HOST}:${PORT}`)
  finish()
})
probe.once('timeout', () => {
  probe.destroy()
  note(`连不上 ${HOST}:${PORT}（没开服时正常；开了服就跑 npm --workspace mineflayer-fork run fork-smoke）`)
  finish()
})
probe.once('error', () => {
  note(`连不上 ${HOST}:${PORT}（没开服时正常）`)
  finish()
})

function finish () {
  console.log('')
  if (bad.length === 0) {
    console.log(`结论：${ok.length} 项通过，0 项需要处理。`)
    console.log('下一步：npm test（213 个离线测试）；有服务端再跑 fork-smoke。')
    process.exit(0)
  }
  console.log(`结论：${ok.length} 项通过，${bad.length} 项需要处理：`)
  for (const item of bad) console.log(`  - ${item.msg}${item.fix ? `\n    → ${item.fix}` : ''}`)
  process.exit(1)
}
