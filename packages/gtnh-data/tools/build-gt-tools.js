// 从 gregtech 的 lang 里生成 GT 自带工具的 damage → 工具类型表。
//
// 为什么需要：GT 的扳手、剪线钳、锤都塞在同一个物品里（gregtech:gt.metatool.01 + damage），
// 注册名完全一样，按名字匹配工具会全部落空。名字只在 lang 里有
// （gt.metatool.01.<damage>.name），所以在这里解析出来做成数据表。
//
// 用法：node tools/build-gt-tools.js [gregtech.jar]
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const JAR = process.argv[2] || 'G:/mc/GTNH2.9.0-server/mods/gregtech-5.09.54.265.jar'
const OUT = path.join(__dirname, '..', 'data', 'gt-tools.json')

// lang 名 → 内部类型名。harvest.json 里的 tool 用的是 pickaxe / wrench / cutter 这一套。
const KINDS = [
  [/^saw$/i, 'saw'],
  [/^hammer$/i, 'hammer'],
  [/^soft mallet$/i, 'soft_mallet'],
  [/^wrench$/i, 'wrench'],
  [/^file$/i, 'file'],
  [/^crowbar$/i, 'crowbar'],
  [/^screwdriver$/i, 'screwdriver'],
  [/^mortar$/i, 'mortar'],
  [/^wire ?cutter$/i, 'cutter'],
  [/^scoop$/i, 'scoop'],
  [/^branch ?cutter$/i, 'branch_cutter'],
  [/knife$/i, 'knife'],
  [/^plunger$/i, 'plunger'],
  [/^rolling pin$/i, 'rolling_pin'],
  [/turbine$/i, 'turbine'],
  [/^pocket multitool/i, 'multitool']
]

function kindOf (name) {
  for (const [re, kind] of KINDS) if (re.test(name)) return kind
  return 'tool'
}

// 1.7.10 的 lang 文件是 ISO-8859-1 里混 UTF-8 的，这里只要英文键，按 latin1 读足够。
function readLang (jar, entry) {
  const raw = execFileSync('python', ['-c', `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
sys.stdout.buffer.write(z.read(sys.argv[2]))
`, jar, entry], { maxBuffer: 64 * 1024 * 1024 })
  const map = {}
  for (const line of raw.toString('utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    map[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return map
}

const en = readLang(JAR, 'assets/gregtech/lang/en_US.lang')
const zh = readLang(JAR, 'assets/gregtech/lang/zh_CN.lang')

const items = {}
let count = 0
for (const key of Object.keys(en)) {
  const m = /^gt\.(metatool\.\d+)\.(\d+)\.name$/.exec(key)
  if (!m) continue
  const item = 'gregtech:gt.' + m[1]
  const dmg = Number(m[2])
  const nameEn = en[key]
  const nameZh = zh[key] || ''
  const kind = kindOf(nameEn)
  if (!items[item]) items[item] = {}
  items[item][String(dmg)] = { kind, name: nameEn, zh: nameZh }
  count++
}

const out = {
  generatedAt: new Date().toISOString(),
  source: path.basename(JAR),
  count,
  items
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n')
console.log(`${count} 个 GT 工具 → ${OUT}`)
for (const [item, metas] of Object.entries(items)) {
  const parts = Object.entries(metas).map(([d, v]) => `${d}:${v.kind}`)
  console.log(item, parts.join(' '))
}
