'use strict'

/*
 * M5 端到端 demo：把一个真实的 BetterQuesting 任务从「背包里什么都没有」
 * 做到「服务端确认已提交」。
 *
 *   npm --workspace mineflayer-fork run quest-demo -- "Your First Night"
 *   node tools/quest-demo.js 127.0.0.1 54615 demo2 "Your First Night" --at 70 80 70
 *
 * 它做四件事：
 *   1. 读任务书，算出这一步要挖什么/合成什么（bot.questSteps）
 *   2. 在场地里把要挖的方块铺好（自己搭场景，不依赖别人手放的机器）
 *   3. 交给 bot.runQuest 执行（挖 → 捡 → 合成 → 熔炼，按轮重算）
 *   4. 材料齐了自动提交（BQ 自己的通道），并回读服务端状态
 *
 * 限制：只演示「纯挖矿/合成/熔炼」能做完的任务。带机器配方的任务会出现在
 * blocked 里——那需要先做 MUI2 的写入路径（见 docs/MEMORY.md §7）。
 */

const mineflayer = require('..')
const scene = require('./scene')

const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--at') {
    flags.at = args.slice(i + 1, i + 4).map(Number)
    i += 3
  } else if (args[i].startsWith('--')) {
    flags[args[i].slice(2)] = true
  }
}
const positional = args.filter((a) => !a.startsWith('--') && !flags.at?.includes(Number(a)))
const HOST = positional[0] || '127.0.0.1'
const PORT = Number(positional[1] || 54615)
const USER = positional[2] || 'quest-demo'
const QUEST = positional[3] || 'Your First Night'
const AT = flags.at || [70, 80, 70]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const invLine = (bot) =>
  bot.inventory
    .items()
    .map((i) => `${i.name}x${i.count}`)
    .join(' ')

/* 从计划里反推要在场地里摆什么：挖 d 个 X 就摆 d+2 个 X 方块（多的两个当容错） */
function blocksToPlace(plan) {
  const out = []
  for (const step of plan.steps) {
    if (step.kind !== 'mine') continue
    const block = step.block || String(step.item).replace(/^minecraft:/, '')
    out.push({ block, count: step.count + 2 })
  }
  return out
}

async function main() {
  const R = scene.rconAt(HOST)
  const bot = mineflayer.createBot({ host: HOST, port: PORT, username: USER, rcon: R })
  bot.on('error', (e) => {
    // GTNH 的未注册包会触发 "Read error for undefined"，是常态噪音
    if (!/Read error for undefined/.test(String(e && e.message))) console.log('bot error:', e.message)
  })
  await new Promise((res, rej) => {
    bot.once('spawn', res)
    bot.once('end', (r) => rej(new Error('连接结束：' + r)))
  })
  await bot.waitForTicks(20)

  const plan = bot.questSteps(QUEST)
  console.log(`任务：${plan.quest.name}（${plan.quest.line}）`)
  console.log('计划：', plan.steps.map((s) => `${s.kind} ${s.item} x${s.count}`).join(' ; ') || '（背包已经够了）')
  if (plan.blocked.length) {
    console.log('做不了的部分：')
    for (const b of plan.blocked) console.log(`  - ${b.item} x${b.count}：${b.reason}`)
    if (!plan.steps.length) {
      console.log('这一步只有机器配方，demo 做不了（要给 MUI2 加写入路径）')
      bot.quit()
      return 1
    }
  }

  // 铺场地：先 tp 把区块拉起来，否则 setblock 报 "Cannot place block outside of the world"
  await R([`tp ${USER} ${AT[0] + 0.5} ${AT[1] + 20} ${AT[2] + 0.5}`, `gamemode 1 ${USER}`])
  await sleep(3000)
  await scene.prepareArena(R, { x: AT[0], y: AT[1], z: AT[2], radius: 4, username: USER })

  const need = blocksToPlace(plan)
  let slots = []
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) slots.push([dx, dz])
  slots = slots.sort((a, b) => Math.hypot(...a) - Math.hypot(...b))
  let put = 0
  for (const { block, count } of need) {
    const name = block.includes(':') ? block : `minecraft:${block}`
    for (let i = 0; i < count; i++) {
      const [dx, dz] = slots[(put + i) % slots.length]
      if (dx === 0 && dz === 0) continue
      const r = await R([`setblock ${AT[0] + dx} ${AT[1]} ${AT[2] + dz} ${name}`])
      if (!/Block placed/i.test(String(r))) console.log(`  摆 ${name} @ ${dx},${dz} 失败：${r}`)
    }
    put += count
    console.log(`摆好 ${name} x${count}`)
  }

  // 空背包开跑：从背包里清干净，让它真的全靠自己挖/合成
  await R([`clear ${USER}`, `tp ${USER} ${AT[0] + 0.5} ${AT[1] + 1} ${AT[2] + 0.5}`, `gamemode 0 ${USER}`])
  await sleep(1500)
  console.log('背包（开始前）：', invLine(bot) || '空')

  const res = await bot.runQuest(QUEST, { rounds: 8, timeoutMs: 900000 })
  console.log('\n每轮做了什么：')
  for (const entry of res.log) {
    const tail = entry.ok === false ? `✗ ${entry.reason || '没做成'}` : `ok${entry.mined != null ? `（挖到 ${entry.mined}）` : ''}`
    console.log(`  第 ${entry.round} 轮  ${entry.kind} ${entry.item} x${entry.count}  ${tail}`)
  }
  console.log('\n背包（结束后）：', invLine(bot) || '空')
  console.log(res.done ? '✓ 任务已提交，服务端确认完成' : `✗ 没交成${res.submit ? '：' + JSON.stringify(res.submit) : ''}`)
  bot.quit()
  return res.done ? 0 : 1
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error('FAIL', e && e.message)
      process.exit(1)
    })
}

module.exports = { blocksToPlace }
