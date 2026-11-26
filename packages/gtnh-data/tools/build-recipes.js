#!/usr/bin/env node
'use strict'
// 把服务端 agent 导出的 gtnh-dump.jsonl 转成体积小、加载快的 JSON 数据文件。
// 用法: node tools/build-recipes.js [dump.jsonl] [输出目录]
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const input = process.argv[2] || path.join(ROOT, 'data/raw/gtnh-2.9.0-server/gtnh-dump.jsonl')
const outDir = process.argv[3] || path.join(ROOT, 'data/recipes')

const ref = (s) => (s ? [s.id, s.meta] : null)
const key = ([id, meta]) => `${id}:${meta}`

function main () {
  const lines = fs.readFileSync(input, 'utf8').split('\n').filter(Boolean)
  const oredict = {}
  const crafting = []
  const smelting = {}
  for (const line of lines) {
    let rec
    try { rec = JSON.parse(line) } catch (e) { continue }
    if (rec.items) {
      oredict[rec.name] = rec.items.map(ref)
    } else if (rec.shaped !== undefined) {
      const out = ref(rec.out)
      if (!out) continue
      crafting.push({
        w: rec.w,
        h: rec.h,
        in: rec.in.map(ref),
        out,
        count: rec.out.count
      })
    } else if (rec.in && rec.out && !rec.shaped) {
      smelting[key(ref(rec.in))] = [ref(rec.out), rec.out.count]
    }
  }

  fs.mkdirSync(outDir, { recursive: true })
  const write = (name, data) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(data))
  write('oredict.json', oredict)
  write('crafting.json', crafting)
  write('smelting.json', smelting)
  write('meta.json', {
    source: path.relative(ROOT, input).split(path.sep).join('/'),
    oreNames: Object.keys(oredict).length,
    oreEntries: Object.values(oredict).reduce((n, v) => n + v.length, 0),
    crafting: crafting.length,
    smelting: Object.keys(smelting).length
  })
  const meta = JSON.parse(fs.readFileSync(path.join(outDir, 'meta.json'), 'utf8'))
  console.log(meta)
}

main()
