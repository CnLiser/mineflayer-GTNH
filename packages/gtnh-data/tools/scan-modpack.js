'use strict'

/*
 * 扫描 GTNH 整合包（PrismLauncher 实例目录或 .minecraft 目录），导出：
 *   - modlist.json : mcmod.info 里的 modid / version / name（FML 握手要用）
 *   - lang/*.json  : 各语言词典（方块/物品显示名）
 *   - meta.json    : 整合包版本、Forge 版本、统计
 *
 * 用法：
 *   node tools/scan-modpack.js <实例目录或 .minecraft> [--out <目录>] [--locales en_US,zh_CN]
 */

const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')

const DEFAULT_LOCALES = ['en_US', 'zh_CN']

function parseArgs (argv) {
  const args = { input: null, out: null, locales: DEFAULT_LOCALES }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--out') args.out = argv[++i]
    else if (a === '--locales') args.locales = argv[++i].split(',').map(s => s.trim()).filter(Boolean)
    else if (!args.input) args.input = a
  }
  if (!args.input) {
    console.error('usage: node tools/scan-modpack.js <instance|.minecraft> [--out <dir>] [--locales en_US,zh_CN]')
    process.exit(1)
  }
  return args
}

// 传入实例目录时，找到真正的 .minecraft
function resolveMinecraftRoot (input) {
  const candidates = [
    path.join(input, '.minecraft'),
    input
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'mods'))) return dir
  }
  throw new Error(`找不到 mods/ 目录：${input}`)
}

function readJsonSafe (file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (e) {
    return null
  }
}

// 从 mmc-pack.json / instance.cfg / changelog 猜整合包版本
function readPackMeta (minecraftRoot) {
  const instanceDir = path.dirname(minecraftRoot)
  const meta = { instanceDir, mcVersion: null, forgeVersion: null, gtnhVersion: null }

  const pack = readJsonSafe(path.join(instanceDir, 'mmc-pack.json'))
  if (pack && Array.isArray(pack.components)) {
    for (const c of pack.components) {
      if (c.uid === 'net.minecraft') meta.mcVersion = c.version
      if (c.uid === 'net.minecraftforge') meta.forgeVersion = c.version
    }
  }

  const cfg = (() => {
    try { return fs.readFileSync(path.join(instanceDir, 'instance.cfg'), 'utf8') } catch (e) { return '' }
  })()
  const nameMatch = cfg.match(/^name=(.+)$/m)
  if (nameMatch) meta.instanceName = nameMatch[1].trim()

  // GTNH 会在 .minecraft 根目录留一份升级日志：changelog from 2.8.4 to 2.9.0.md
  try {
    for (const f of fs.readdirSync(minecraftRoot)) {
      const m = f.match(/changelog from [\d.]+ to ([\d.]+)\.md/i)
      if (m) meta.gtnhVersion = m[1]
    }
  } catch (e) { /* ignore */ }
  if (!meta.gtnhVersion && meta.instanceName) {
    const m = meta.instanceName.match(/(\d+\.\d+\.\d+)/)
    if (m) meta.gtnhVersion = m[1]
  }
  return meta
}

function parseLangFile (text) {
  const dict = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    dict[key] = trimmed.slice(eq + 1)
  }
  return dict
}

function readEntry (zip, name) {
  const entry = zip.getEntry(name)
  if (!entry) return null
  return zip.readFile(entry).toString('utf8').replace(/^\uFEFF/, '')
}

// mcmod.info 在 1.7.10 里有三种写法：数组、{modList:[...]}、单个对象
function normalizeMcmodInfo (parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.modList)) return parsed.modList
  if (parsed && (parsed.modid || parsed.modId)) return [parsed]
  return []
}

function countByPrefix (dict) {
  const counts = { tile: 0, item: 0, entity: 0, other: 0 }
  for (const key of Object.keys(dict)) {
    if (key.startsWith('tile.')) counts.tile++
    else if (key.startsWith('item.')) counts.item++
    else if (key.startsWith('entity.')) counts.entity++
    else counts.other++
  }
  return counts
}

function main () {
  const args = parseArgs(process.argv)
  const minecraftRoot = resolveMinecraftRoot(args.input)
  const meta = readPackMeta(minecraftRoot)
  const outDir = args.out
    ? path.resolve(args.out)
    : path.join(__dirname, '..', 'data', 'raw', meta.gtnhVersion ? `gtnh-${meta.gtnhVersion}` : 'unknown')

  const modsDir = path.join(minecraftRoot, 'mods')
  const jars = fs.readdirSync(modsDir).filter(f => f.toLowerCase().endsWith('.jar'))

  const mods = []
  const langs = Object.fromEntries(args.locales.map(l => [l, {}]))
  const jarsWithoutMcmodInfo = []
  const mcmodFormats = { array: 0, modList: 0, single: 0 }
  let jarsWithLang = 0

  for (const jar of jars) {
    const zip = new AdmZip(path.join(modsDir, jar))

    const mcmod = readEntry(zip, 'mcmod.info')
    if (mcmod) {
      try {
        const parsed = JSON.parse(mcmod)
        if (Array.isArray(parsed)) mcmodFormats.array++
        else if (parsed && Array.isArray(parsed.modList)) mcmodFormats.modList++
        else mcmodFormats.single++
        for (const m of normalizeMcmodInfo(parsed)) {
          const modid = m.modid ?? m.modId
          if (!modid) continue
          mods.push({
            modid,
            version: m.version ?? '',
            name: m.name ?? modid,
            jar
          })
        }
      } catch (e) {
        jarsWithoutMcmodInfo.push(`${jar} (bad mcmod.info)`)
      }
    } else {
      jarsWithoutMcmodInfo.push(jar)
    }

    const entries = zip.getEntries()
    let foundLang = false
    for (const locale of args.locales) {
      const re = new RegExp(`^assets/[^/]+/lang/${locale}\\.lang$`)
      for (const entry of entries) {
        if (!re.test(entry.entryName)) continue
        foundLang = true
        Object.assign(langs[locale], parseLangFile(zip.readFile(entry).toString('utf8').replace(/^\uFEFF/, '')))
      }
    }
    if (foundLang) jarsWithLang++
  }

  // 同一 modid@version 可能被多个 jar 重复声明，去重保留第一个
  const seen = new Set()
  const uniqueMods = mods.filter(m => {
    const key = `${m.modid}@${m.version}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  fs.mkdirSync(path.join(outDir, 'lang'), { recursive: true })
  fs.writeFileSync(path.join(outDir, 'modlist.json'), JSON.stringify(uniqueMods, null, 2))
  for (const locale of args.locales) {
    fs.writeFileSync(path.join(outDir, 'lang', `${locale}.json`), JSON.stringify(langs[locale], null, 2))
  }

  const summary = {
    ...meta,
    scannedAt: new Date().toISOString(),
    modsDir,
    jarCount: jars.length,
    jarsWithLang,
    mcmodFormats,
    jarsWithoutMcmodInfo,
    modEntriesRaw: mods.length,
    modEntryCount: uniqueMods.length,
    uniqueModIds: new Set(uniqueMods.map(m => m.modid)).size,
    lang: Object.fromEntries(args.locales.map(l => [l, {
      keys: Object.keys(langs[l]).length,
      byPrefix: countByPrefix(langs[l])
    }]))
  }
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify(summary, null, 2))

  console.log(`整合包版本: ${meta.gtnhVersion ?? '?'}  MC: ${meta.mcVersion ?? '?'}  Forge: ${meta.forgeVersion ?? '?'}`)
  console.log(`jars: ${jars.length}（带 lang: ${jarsWithLang}，无 mcmod.info: ${summary.jarsWithoutMcmodInfo.length}）`)
  console.log(`mcmod.info 格式: 数组 ${mcmodFormats.array} / modList ${mcmodFormats.modList} / 单对象 ${mcmodFormats.single}`)
  console.log(`mod 条目: ${summary.modEntriesRaw} 条 → 去重后 ${summary.modEntryCount}，唯一 modid: ${summary.uniqueModIds}`)
  for (const locale of args.locales) {
    const l = summary.lang[locale]
    console.log(`lang ${locale}: ${l.keys} 键（tile ${l.byPrefix.tile} / item ${l.byPrefix.item} / entity ${l.byPrefix.entity}）`)
  }
  console.log(`输出目录: ${outDir}`)
}

if (require.main === module) main()

module.exports = { parseLangFile, countByPrefix, resolveMinecraftRoot }
