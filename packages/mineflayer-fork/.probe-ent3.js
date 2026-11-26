const { createBot } = require('.')
const { loadServerMods } = require('mineflayer-gtnh/src/index')
const { rcon } = require('protocol-fml/tools/rcon')
const bot = createBot({ host: '127.0.0.1', port: 54615, username: 'entProbe3', mods: loadServerMods(), hideErrors: true })
bot.on('error', () => {})
let n = 0
bot._client.on('spawn_entity_living', (p) => {
  if (n++ < 8) console.log('living', 'id=' + p.entityId, 'type=' + p.type, 'pos=' + [p.x / 32, p.y / 32, p.z / 32].join('/'), 'meta=' + (p.metadata && p.metadata.length))
})
bot.once('spawn', async () => {
  await rcon(['op entProbe3', 'gamemode 1 entProbe3', 'tp entProbe3 20.5 76 20.5', 'summon Chicken 22.5 76 20.5'], { host: '127.0.0.1' })
  await new Promise(r => setTimeout(r, 5000))
  const list = Object.values(bot.entities).filter(e => e.type === 'mob')
  console.log('mob entities', list.length, list.slice(0, 5).map(e => `${e.name}@${e.position.toString()}`).join(' '))
  console.log('any chicken?', list.some(e => /chicken/i.test(e.name || '')))
  process.exit(0)
})
