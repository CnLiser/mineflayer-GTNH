const scene = require('./packages/mineflayer-fork/tools/scene')
const { createBot, loadServerMods } = require('mineflayer-fork')
;(async () => {
  const bot = createBot({ host: '127.0.0.1', port: 54615, username: 'dropBot2', mods: loadServerMods(), hideErrors: true })
  bot.on('error', () => {})
  await new Promise((r) => bot.once('spawn', r))
  const R = scene.rconAt('127.0.0.1')
  await R(['op dropBot2', 'gamemode 1 dropBot2'])
  const X = 220, Y = 80, Z = 220
  await scene.prepareArena(R, { x: X, y: Y, z: Z, radius: 4, username: 'dropBot2' })
  await R([`setblock ${X + 2} ${Y + 1} ${Z} minecraft:coal_ore`, `setblock ${X + 3} ${Y + 1} ${Z} minecraft:coal_ore`])
  await scene.tpTo(R, 'dropBot2', { x: X + 0.5, y: Y + 1, z: Z + 0.5 })
  for (let i = 0; i < 40 && !bot.entity.onGround; i++) await scene.sleep(100)
  console.log('onGround', bot.entity.onGround, 'pos', bot.entity.position)
  console.log('rcon:', JSON.stringify(await R(['gamemode 0 dropBot2', 'give dropBot2 minecraft:diamond_pickaxe 1'])))
  for (let i = 0; i < 25; i++) {
    if (bot.inventory.items().some((x) => /pickaxe/.test(x.name))) break
    await scene.sleep(300)
  }
  const pick = bot.inventory.items().find((x) => /pickaxe/.test(x.name))
  console.log('pickaxe in inv:', !!pick)
  if (pick) await bot.equip(pick, 'hand')
  console.log('held:', bot.heldItem && bot.heldItem.name)
  const out = await bot.mineNearby('minecraft:coal_ore', { count: 2, radius: 8 })
  console.log('mined', JSON.stringify(out))
  console.log('inv:', bot.inventory.items().map((x) => x.name + 'x' + x.count).join(' '))
  bot.quit(); setTimeout(() => process.exit(0), 300)
})()
