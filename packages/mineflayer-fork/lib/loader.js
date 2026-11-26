// GTNH-PATCH: 不再直接用 minecraft-protocol 建连接，而是走 protocol-fml（FML 握手、ChunkAPI、
// EndlessIDs 的 slot/位置包补丁都在那一层）。
const { createFmlClient } = require('protocol-fml')
// GTNH-PATCH: registry.supportFeature 要返回「值」（如 typeOfValueForEnchantLevel = 'short'），
// 不是布尔。gtnh-data 的 supports 只给布尔，这里用 featureValue 原样返回，未知键回落 false。
const { supports: gtnhSupports, featureValue: gtnhFeatureValue0 } = require('gtnh-data')
const gtnhFeatureValue = (feature) => {
  const v = gtnhFeatureValue0(feature)
  return v === undefined ? false : v
}
const { EventEmitter } = require('events')
const pluginLoader = require('./plugin_loader')
const plugins = {
  abilities: require('./plugins/abilities'),
  bed: require('./plugins/bed'),
  title: require('./plugins/title'),
  block_actions: require('./plugins/block_actions'),
  blocks: require('./plugins/blocks'),
  book: require('./plugins/book'),
  boss_bar: require('./plugins/boss_bar'),
  breath: require('./plugins/breath'),
  chat: require('./plugins/chat'),
  chest: require('./plugins/chest'),
  command_block: require('./plugins/command_block'),
  craft: require('./plugins/craft'),
  creative: require('./plugins/creative'),
  digging: require('./plugins/digging'),
  enchantment_table: require('./plugins/enchantment_table'),
  entities: require('./plugins/entities'),
  experience: require('./plugins/experience'),
  explosion: require('./plugins/explosion'),
  fishing: require('./plugins/fishing'),
  furnace: require('./plugins/furnace'),
  game: require('./plugins/game'),
  health: require('./plugins/health'),
  inventory: require('./plugins/inventory'),
  kick: require('./plugins/kick'),
  physics: require('./plugins/physics'),
  place_block: require('./plugins/place_block'),
  rain: require('./plugins/rain'),
  ray_trace: require('./plugins/ray_trace'),
  resource_pack: require('./plugins/resource_pack'),
  scoreboard: require('./plugins/scoreboard'),
  team: require('./plugins/team'),
  settings: require('./plugins/settings'),
  simple_inventory: require('./plugins/simple_inventory'),
  sound: require('./plugins/sound'),
  spawn_point: require('./plugins/spawn_point'),
  tablist: require('./plugins/tablist'),
  time: require('./plugins/time'),
  villager: require('./plugins/villager'),
  anvil: require('./plugins/anvil'),
  place_entity: require('./plugins/place_entity'),
  generic_place: require('./plugins/generic_place'),
  particle: require('./plugins/particle'),
  sequence: require('./plugins/sequence')
}

const minecraftData = require('minecraft-data')
// GTNH-PATCH: 旧包（mineflayer-gtnh）归档后搬过来的门面工具
const { loadServerMods } = require('./gtnh/mods')
const { formatMessage, messageToJSON } = require('./gtnh/chat')
const { testedVersions, latestSupportedVersion, oldestSupportedVersion } = require('./version')
const latestSupportedProtocolVersion = minecraftData.versionsByMinecraftVersion.pc[latestSupportedVersion].version
if (!latestSupportedProtocolVersion) throw new Error(`Version '${latestSupportedVersion}' not supported by minecraft-data - is it up to date?`)

module.exports = {
  createBot,
  // GTNH-PATCH: 旧包（mineflayer-gtnh）归档后搬过来的门面工具
  loadServerMods,
  formatMessage,
  messageToJSON,
  Location: require('./location'),
  Painting: require('./painting'),
  ScoreBoard: require('./scoreboard'),
  BossBar: require('./bossbar'),
  Particle: require('./particle'),
  latestSupportedVersion,
  oldestSupportedVersion,
  testedVersions,
  // GTNH-PATCH: 1.7.10 的 feature 表由 gtnh-data 提供（minecraft-data 的 supportFeature 对
  // 1.7.10 全部返回 false）。
  supportFeature: (feature, version) => (version && version !== '1.7.10' ? minecraftData(version).supportFeature(feature) : gtnhFeatureValue(feature))
}


/* GTNH-PATCH: FML 注册表 → prismarine-registry（blocks / items / 反向表） */
function applyGtnhRegistry (bot) {
  const fml = bot._client && bot._client.fml
  if (!fml) return
  const apply = () => {
    const reg = fml.registry
    if (!reg || reg.__appliedToBot) return
    reg.__appliedToBot = true
    const strip = (name) => String(name).replace(/^minecraft:/, '')
    // FmlHandshake 的 registry.blocks / registry.items 是 Map，不是普通对象
    const entries = (m) => (m instanceof Map ? [...m.entries()] : Object.entries(m || {})).map(([k, v]) => [String(k), v])
    for (const [id, fullName] of entries(reg.blocks)) {
      if (bot.registry.blocks[id]) continue
      const name = strip(fullName)
      const entry = {
        id: Number(id),
        name,
        displayName: name,
        hardness: 1.5,
        stackSize: 64,
        diggable: true,
        boundingBox: 'block',
        material: null,
        transparent: false,
        emitLight: 0,
        filterLight: 0,
        resistance: 0,
        drops: [],
        minStateId: Number(id) * 65536,
        maxStateId: Number(id) * 65536 + 65535,
        defaultState: Number(id) * 65536
      }
      bot.registry.blocks[id] = entry
      bot.registry.blocksByName[name] = entry
    }
    for (const [id, fullName] of entries(reg.items)) {
      if (bot.registry.items[id]) continue
      const name = strip(fullName)
      const entry = { id: Number(id), name, displayName: name, stackSize: 64 }
      bot.registry.items[id] = entry
      bot.registry.itemsByName[name] = entry
    }
    // 世界那边按 id:meta 缓存了方块原型，名字要重新算
    if (bot.world && typeof bot.world.invalidate === 'function') bot.world.invalidate()
  }
  if (fml.completed) apply()
  else fml.once('complete', apply)
}

function createBot (options = {}) {
  options.username = options.username ?? 'Player'
  options.version = options.version ?? '1.7.10'
  options.plugins = options.plugins ?? {}
  options.hideErrors = options.hideErrors ?? false
  options.logErrors = options.logErrors ?? true
  options.loadInternalPlugins = options.loadInternalPlugins ?? true
  options.client = options.client ?? null
  options.brand = options.brand ?? 'vanilla'
  options.respawn = options.respawn ?? true
  const bot = new EventEmitter()
  bot._client = options.client
  bot.end = (reason) => bot._client.end(reason)
  bot._warn = function (...message) {
    if (options.hideErrors) return
    console.warn('[mineflayer]', ...message)
  }
  // GTNH-PATCH: 聊天组件里的 translate 键是整合包的，用 options.lang（gtnh-data
  // 的 Lang 实例）渲染；没给就原样输出 translate 键。
  bot.lang = options.lang ?? null
  bot.formatMessage = (input) => formatMessage(input, options.lang)
  if (options.logErrors) {
    bot.on('error', err => {
      if (options.hideErrors) return
      // GTNH-PATCH: FML / 各 mod 的插件通道载荷会被 nmp 当成原版通道去解，
      // 每次都是 partialReadError。这类噪音默认不打印（要看传 protodefLogErrors: true）。
      if (options.protodefLogErrors !== true && err && (err.partialReadError || /Read error for undefined/.test(String(err.message)))) return
      console.log(err)
    })
  }

  pluginLoader(bot, options)
  const internalPlugins = Object.keys(plugins)
    .filter(key => {
      if (typeof options.plugins[key] === 'function') return false
      if (options.plugins[key] === false) return false
      return options.plugins[key] || options.loadInternalPlugins
    }).map(key => plugins[key])
  const externalPlugins = Object.keys(options.plugins)
    .filter(key => {
      return typeof options.plugins[key] === 'function'
    }).map(key => options.plugins[key])
  bot.loadPlugins([...internalPlugins, ...externalPlugins])

  options.validateChannelProtocol = false
  if (bot._client) bot._client.options = bot._client.options || {}
  // GTNH-PATCH: mineflayer 的 hideErrors 管的是 bot 事件日志，和 protodef 的
  // 「解析失败打堆栈」不是一回事。GTNH 上偶发解析失败很多，默认把 protodef
  // 的噪音关掉；要看原始堆栈传 protodefLogErrors: true。
  bot._client = bot._client ?? createFmlClient({
    ...options,
    hideErrors: options.protodefLogErrors === true ? false : true
  })
  bot._client.on('connect', () => {
    bot.emit('connect')
  })
  bot._client.on('error', (err) => {
    bot.emit('error', err)
  })
  bot._client.on('end', (reason) => {
    bot.emit('end', reason)
  })
  if (!bot._client.wait_connect) next()
  else bot._client.once('connect_allowed', next)
  function next () {
    const serverPingVersion = bot._client.version
    bot.registry = require('prismarine-registry')(serverPingVersion)
    // GTNH-PATCH: 各 prismarine-* 库都会问 registry.supportFeature，1.7.10 的答案只有
    // gtnh-data 有，所以这里直接换掉
    if (bot.registry.version.minecraftVersion.startsWith('1.7')) {
      bot.registry.supportFeature = (feature) => gtnhFeatureValue(feature)
    }
    if (!bot.registry?.version) throw new Error(`Server version '${serverPingVersion}' is not supported, no data for version`)

    const versionData = bot.registry.version
    if (versionData['>'](latestSupportedVersion) && (versionData.version !== latestSupportedProtocolVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Latest supported version is '${latestSupportedVersion}'.`)
    } else if (versionData['<'](oldestSupportedVersion)) {
      throw new Error(`Server version '${serverPingVersion}' is not supported. Oldest supported version is '${oldestSupportedVersion}'.`)
    }

    bot.protocolVersion = versionData.version
    bot.majorVersion = versionData.majorVersion
    bot.version = versionData.minecraftVersion
    options.version = versionData.minecraftVersion
    // GTNH-PATCH: 用 gtnh-data 的 1.7.10 特征表
    bot.supportFeature = (feature) => gtnhFeatureValue(feature)

    // GTNH-PATCH: 把 FML 的 ModIdData 注册表灌进 prismarine-registry。
    // minecraft-data 只有原版 176 方块 / 303 物品，GTNH 有 4258 / 11343 个，
    // 不灌的话 bot.blockAt() 的 name 和 prismarine-item 的 name 都是 'unknown'。
    applyGtnhRegistry(bot)
    // GTNH-PATCH: ModularUI2 的机器状态聚合（openGui / syncHandler / closeGui）
    require('./gtnh/modularui').attachModularUI(bot)
    // GTNH-PATCH: GTNH 矿辞 / 配方数据（bot.gtnhRecipes / bot.oreItems / bot.gtnhRecipesFor）
    require('./gtnh/recipes').attachRecipes(bot)
    // GTNH-PATCH: TiC 冶炼炉/浇筑辅助（结构判定、投料、点水龙头）
    require('./gtnh/tconstruct').attachTconstruct(bot)
    require('./gtnh/smeltery').attachSmeltery(bot)
    setTimeout(() => bot.emit('inject_allowed'), 0)
  }
  return bot
}
