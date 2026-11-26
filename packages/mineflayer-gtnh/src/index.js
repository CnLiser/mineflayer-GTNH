'use strict'

/*
 * mineflayer-gtnh —— 面向 GTNH（MC 1.7.10 + Forge + ChunkAPI/EndlessIDs）的
 * mineflayer 替身：连接、世界、实体、玩家、生命值、聊天、背包、物理/移动、挖掘与放置。
 *
 * 与上游 mineflayer 的差别：
 *   - 不走 mineflayer 的 1.8+ 插件链（1.7.10 缺 38 个包、prismarine-chunk 没有 1.7 实现）；
 *   - 世界数据来自 ChatpAPI 线格式（见 @mineflayer-GTNH/protocol-fml）；
 *   - 方块/物品 id 是服务器运行时分配的，所以注册表跟着连接走。
 */

const { EventEmitter } = require('events')
const fs = require('fs')
const path = require('path')
const { Vec3 } = require('vec3')

const { createFmlClient } = require('protocol-fml')
const { ChunkStore } = require('prismarine-chunk-1.7')
const { ModRegistry, Lang, supports, featureValue, GTNH_FEATURES } = require('gtnh-data')
const { formatMessage } = require('./chat')
const physics = require('./physics')
const mcData = require('minecraft-data')('1.7.10')

// GTNH 的 Backhand 在玩家窗口里加了副手槽，46 号槽是副手
const INVENTORY_SLOTS = 46
const HOTBAR_START = 36

/*
 * GTNH 服务器会校验客户端的 mod 列表（Do not accept missing mods），
 * 少一个就 "Mod rejections [...]" 踢人。所以连接时必须把服务器自己的
 * mod 列表原样回声过去 —— 这份列表从 ping 结果里拿（protocol-fml 的 ping.js 会落盘）。
 */
function loadServerMods (file) {
  const candidates = file
    ? [file]
    : [
        path.join(__dirname, '..', '..', 'protocol-fml', 'data', 'raw', 'local-server-modlist.json'),
        path.join(__dirname, '..', '..', 'protocol-fml', 'data', 'raw', 'server-modlist.json')
      ]
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue
    const data = JSON.parse(fs.readFileSync(candidate, 'utf8'))
    const mods = Array.isArray(data) ? data : data.mods
    if (Array.isArray(mods) && mods.length) return mods
  }
  return []
}

const DEFAULT_OPTIONS = {
  host: '127.0.0.1',
  port: 54615,
  username: 'gtnh-bot',
  version: '1.7.10',
  hideErrors: true,
  // 打印每个未能解析的包（调试用）
  debugPackets: false,
  // FML 握手要回声的 mod 列表；留空则从 protocol-fml/data/raw 里找
  mods: null
}

class Entity {
  constructor (id, type) {
    this.id = id
    this.type = type || 'object'
    this.name = undefined
    this.username = undefined
    this.position = new Vec3(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this.metadata = {}
    this.equipment = []
    this.valid = true
  }

  get distanceTo () {
    return undefined
  }
}

class Bot extends EventEmitter {
  constructor (options = {}) {
    super()
    this.options = { ...DEFAULT_OPTIONS, ...options }
    this.username = this.options.username
    this.version = this.options.version

    this.client = null
    this.entity = new Entity(0, 'player')
    this.entity.username = this.username
    this.entities = new Map() // 除自己以外的实体
    this.players = new Map() // username -> { username, entity, ping, gameMode }

    // 每个维度一份 ChunkStore（GTNH 的自定义维度 id 可以很大，所以用 Map）
    this.worlds = new Map()
    this.world = null // 当前维度的 ChunkStore，收到第一个区块后创建
    this.registry = null
    this.lang = null

    this.health = 20
    this.food = 20
    this.saturation = 5
    this.gameMode = 0
    this.difficulty = 0
    this.dimension = 0
    this.levelType = 'default'

    this.time = { age: 0, timeOfDay: 0, day: 1 }
    this.experience = { level: 0, progress: 0, total: 0 }

    // 玩家背包（窗口 0）：0 输出 / 1-4 合成 / 5-8 装备 / 9-35 背包 / 36-44 快捷栏 / 45 副手
    // GTNH 装了 Backhand，窗口 0 是 **46** 个槽位（原版 45），45 号是副手槽。
    this.inventory = {
      windowId: 0,
      slots: new Array(INVENTORY_SLOTS).fill(null),
      cursor: null, // 光标上的物品（set_slot 的 windowId = -1）
      selectedSlot: 0,
      actionId: 0, // window_click 的事务号，服务器会回 transaction
      lastAcceptedAction: null
    }
    this.heldItemSlot = 0
    // 非 0 号窗口（箱子、GT 机器……）。null 表示当前只开着玩家背包。
    this.currentWindow = null
    this.spawned = false
    this.chunkCount = 0

    // 物理：position 是脚底中心，velocity 单位是 格/tick
    this.physicsEnabled = options.physics !== false
    this.physicsState = {
      position: this.entity.position,
      velocity: new Vec3(0, 0, 0),
      onGround: false
    }
    this.control = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sneak: false,
      sprint: false
    }
    this.tickCount = 0
    this.tickInterval = null
    this._lastSent = null
    this._boundingBoxes = null
  }

  /* ---------------- 连接 ---------------- */

  async connect () {
    const { host, port, username, version } = this.options
    const mods = this.options.mods ?? loadServerMods(this.options.modsFile)
    this.modCount = mods.length
    this.client = await createFmlClient({
      host,
      port,
      username,
      version,
      mods,
      hideErrors: this.options.hideErrors
    })
    this._wire()
    return this
  }

  _wire () {
    const client = this.client

    // FML 握手完成后才有注册表
    client.fml.on('registry', () => {
      const decoded = client.fml.registry
      this.registry = ModRegistry.fromObject({
        host: this.options.host,
        port: this.options.port,
        mods: client.fml.serverMods?.length,
        blocks: decoded.blocks,
        items: decoded.items
      })
      if (this.options.lang) {
        this.lang = new Lang(this.options.lang)
      }
      this.emit('registry', this.registry)
    })

    client.on('login', (packet) => {
      this.entity.id = packet.entityId
      this.gameMode = packet.gameMode
      this.difficulty = packet.difficulty
      this.dimension = packet.dimension
      this.worldFor(this.dimension)
      this.levelType = packet.levelType
      this.spawned = false
      this.emit('login', packet)
    })

    // S08 的 y 就是脚底（stance 单独一个字段，我们发的是 y + 1.62）
    client.on('position', (packet) => {
      this.entity.position = new Vec3(packet.x, packet.y, packet.z)
      this.entity.yaw = packet.yaw
      this.entity.pitch = packet.pitch
      this.entity.onGround = packet.onGround
      // 服务器把我们传走了：速度清零，物理状态跟着重置
      this.physicsState.position = this.entity.position
      this.physicsState.velocity.set(0, 0, 0)
      this._lastSent = null
      if (!this.spawned) {
        this.spawned = true
        this._startTicking()
        this.emit('spawn')
      }
      this.emit('move')
      this.emit('forcedMove')
    })

    client.on('update_health', (packet) => {
      this.health = packet.health
      this.food = packet.food
      this.saturation = packet.foodSaturation
      this.emit('health')
    })

    client.on('update_time', (packet) => {
      this.time.age = Number(packet.age)
      this.time.timeOfDay = Number(packet.time) % 24000
      this.time.day = Math.floor(Number(packet.time) / 24000)
      this.emit('time')
    })

    client.on('chat', (packet) => this._onChat(packet))
    client.on('system_chat', (packet) => this._onChat(packet))

    client.on('player_info', (packet) => {
      const name = packet.playerName
      const existing = this.players.get(name) ?? { username: name, entity: null }
      existing.ping = packet.ping
      existing.online = packet.online
      if (packet.online) {
        this.players.set(name, existing)
        this.emit('playerJoined', existing)
      } else {
        this.players.delete(name)
        this.emit('playerLeft', existing)
      }
    })

    client.on('named_entity_spawn', (packet) => this._onNamedEntitySpawn(packet))
    client.on('entity_destroy', (packet) => {
      for (const id of packet.entityIds) {
        const entity = this.entities.get(id)
        if (!entity) continue
        entity.valid = false
        this.entities.delete(id)
        this.emit('entityGone', entity)
      }
    })

    // 实体移动（位置是 1/32 格定点数）
    const move = (packet, absolute) => {
      const entity = this.entities.get(packet.entityId)
      if (!entity) return
      if (absolute) {
        entity.position.set(packet.x, packet.y, packet.z)
      } else {
        entity.position.translate(packet.dX / 32, packet.dY / 32, packet.dZ / 32)
      }
      if (packet.yaw !== undefined) entity.yaw = packet.yaw
      if (packet.pitch !== undefined) entity.pitch = packet.pitch
      this.emit('entityMoved', entity)
    }
    client.on('entity_teleport', (packet) => move(packet, true))
    client.on('rel_entity_move', (packet) => move(packet, false))
    client.on('entity_move_look', (packet) => move(packet, false))
    client.on('entity_look', (packet) => move(packet, false))

    client.on('entity_metadata', (packet) => {
      const entity = this.entities.get(packet.entityId) ?? (packet.entityId === this.entity.id ? this.entity : null)
      if (!entity) return
      for (const entry of packet.metadata) entity.metadata[entry.key] = entry.value
    })

    client.on('window_items', (packet) => this._onWindowItems(packet))
    client.on('open_window', (packet) => this._onOpenWindow(packet))
    client.on('close_window', (packet) => this._onServerCloseWindow(packet))
    client.on('set_slot', (packet) => this._onSetSlot(packet))
    client.on('transaction', (packet) => this._onTransaction(packet))
    client.on('held_item_slot', (packet) => {
      const slotId = packet.slotId ?? packet.slot
      if (slotId >= 36 && slotId <= 44) {
        this.inventory.selectedSlot = slotId - 36
        this.emit('heldItemChanged', this.inventory.selectedSlot)
      }
    })

    client.on('experience', (packet) => {
      this.experience = { level: packet.level, progress: packet.experienceBar, total: packet.experience }
    })

    client.on('respawn', (packet) => {
      const previous = this.dimension
      this.dimension = packet.dimension
      this.worldFor(this.dimension)
      this.gameMode = packet.gamemode
      this.spawned = false
      this.world = null
      this.entities.clear()
      this.players.clear()
      if (this.entity) this.entity.position.set(0, 0, 0)
      if (previous !== packet.dimension) {
        this.emit('dimensionChange', { from: previous, to: packet.dimension })
      }
      this.emit('respawn', packet)
    })

    // 我们自己重发的区块事件
    client.on('gtnh_chunk_bulk', (bulk) => this._onBulk(bulk))
    client.on('gtnh_chunk', (chunk) => this._onChunk(chunk))
    client.on('gtnh_block_change', (change) => this._onBlockChange(change))
    client.on('gtnh_multi_block_change', (multi) => this._onMultiBlockChange(multi))

    // 不回应 keep_alive 会被服务器踢
    client.on('keep_alive', (packet) => {
      this.emit('keepAlive', packet)
    })

    client.on('kick_disconnect', (packet) => {
      this.emit('kicked', packet)
      this.emit('end', 'kicked')
    })
    client.on('disconnect', (packet) => {
      this.emit('kicked', packet)
      this.emit('end', 'disconnect')
    })
    client.on('end', (reason) => this.emit('end', reason))
    client.on('error', (err) => this.emit('error', err))

    if (this.options.debugPackets) {
      const originalEmit = client.emit.bind(client)
      let seen = new Set()
      client.emit = (name, ...args) => {
        if (!seen.has(name)) {
          seen.add(name)
          this.emit('packet', name)
        }
        return originalEmit(name, ...args)
      }
    }
  }

  _onChat (packet) {
    const raw = packet.message ?? packet.data ?? ''
    const text = formatMessage(raw, this.lang)
    const message = { text, json: raw, position: packet.position }
    this.emit('chat', message)
    this.emit('message', message)
  }

  _onNamedEntitySpawn (packet) {
    const entity = new Entity(packet.entityId, packet.playerUUID ? 'player' : 'object')
    entity.name = packet.playerName
    entity.username = packet.playerName
    entity.uuid = packet.playerUUID
    entity.position = new Vec3(packet.x / 32, packet.y / 32, packet.z / 32)
    entity.yaw = packet.yaw
    entity.pitch = packet.pitch
    entity.currentItem = packet.currentItem
    this.entities.set(entity.id, entity)

    if (entity.username) {
      const player = this.players.get(entity.username) ?? { username: entity.username }
      player.entity = entity
      this.players.set(entity.username, player)
    }
    this.emit('entitySpawn', entity)
  }

  /* ---------------- 背包 ---------------- */

  _onOpenWindow (packet) {
    const window = {
      id: packet.windowId,
      type: packet.inventoryType,
      title: packet.windowTitle,
      slots: new Array(packet.slotCount).fill(null),
      slotCount: packet.slotCount
    }
    this.currentWindow = window
    // 打开窗口时鼠标指针会被清空
    this.inventory.cursor = null
    this.emit('windowOpen', window)
    this.emit('windowChanged', window)
  }

  _onServerCloseWindow (packet) {
    const window = this.currentWindow
    if (!window || window.id !== packet.windowId) return
    this.currentWindow = null
    this.emit('windowClose', window)
    this.emit('windowChanged', null)
  }

  /*
   * window_items 一次给出整个窗口的内容。windowId 0 是玩家背包，
   * 其它是当前打开的容器（箱子 27 格、GT 机器若干格）。
   * 注意字段名是 items（不是 slots）。
   */
  _onWindowItems (packet) {
    if (packet.windowId !== 0) {
      const window = this.currentWindow
      if (!window || window.id !== packet.windowId) {
        this.emit('windowItems', packet)
        return
      }
      const items = packet.items ?? packet.slots ?? []
      for (let i = 0; i < window.slots.length; i++) {
        const item = items[i]
        window.slots[i] = item && item.blockId !== -1 ? item : null
      }
      this.emit('windowUpdate', window)
      return
    }
    const items = packet.items ?? packet.slots ?? []
    for (let i = 0; i < this.inventory.slots.length; i++) {
      const item = items[i]
      this.inventory.slots[i] = item && item.blockId !== -1 ? item : null
    }
    this.emit('inventoryUpdate', this.inventory.slots)
  }

  _onSetSlot (packet) {
    const item = packet.item && packet.item.blockId !== -1 ? packet.item : null
    // windowId = -1 是光标上的物品
    if (packet.windowId === -1) {
      this.inventory.cursor = item
      this.emit('cursorUpdate', item)
      return
    }
    if (packet.windowId !== 0) {
      const window = this.currentWindow
      if (window && window.id === packet.windowId) {
        if (packet.slot >= 0 && packet.slot < window.slots.length) window.slots[packet.slot] = item
        this.emit('windowSlot', packet)
        this.emit('windowUpdate', window)
        return
      }
      this.emit('windowSlot', packet)
      return
    }
    if (packet.slot < 0 || packet.slot >= this.inventory.slots.length) return
    this.inventory.slots[packet.slot] = item
    this.emit('inventoryUpdate', this.inventory.slots)
    if (packet.slot === HOTBAR_START + this.inventory.selectedSlot) this.emit('heldItemChanged', this.inventory.selectedSlot)
  }

  _onTransaction (packet) {
    this.inventory.lastAcceptedAction = { action: packet.action, accepted: packet.accepted }
    this.emit('transaction', packet)
  }

  // 背包里的物品，附带注册名
  items () {
    const out = []
    this.inventory.slots.forEach((item, slot) => {
      if (!item) return
      out.push({
        slot,
        ...item,
        name: this.registry ? this.registry.itemName(item.blockId) ?? this.registry.blockName(item.blockId) : undefined
      })
    })
    return out
  }

  findItem (name) {
    return this.items().filter((item) => item.name === name)
  }

  get heldItem () {
    return this.inventory.slots[HOTBAR_START + this.inventory.selectedSlot] ?? null
  }

  /*
   * 点击某个槽位。mode 0 = 普通点击（左键拿起/放下，右键放一半），
   * mode 1 = shift 点击，mode 4 = 丢弃。
   * clickedItem 在 1.7.10 里是 **点之前光标上的物品**（协议字段名就叫 item）。
   * 打开窗口 0 时服务器不太校验它，但为了兼容其它窗口还是按实发。
   */
  clickSlot (slot, { button = 0, mode = 0, item = this.inventory.cursor, windowId } = {}) {
    const action = ++this.inventory.actionId
    this.client.write('window_click', {
      windowId: windowId ?? (this.currentWindow ? this.currentWindow.id : this.inventory.windowId),
      slot,
      mouseButton: button,
      action,
      mode,
      item: item ?? { blockId: -1 }
    })
    return action
  }

  /*
   * 拿起 / 放下是**乐观更新**：服务器对光标（windowId = -1 的 set_slot）
   * 的同步是懒的（要等下一次点击才 flush），实测点完 600ms 还收不到，
   * 所以本地先把光标和槽位改掉，等服务器回包再覆盖。
   */
  pickUp (slot) {
    const item = this.inventory.slots[slot]
    const action = this.clickSlot(slot, { button: 0, mode: 0, item })
    this.inventory.slots[slot] = null
    this.inventory.cursor = item
    this.emit('inventoryUpdate', this.inventory.slots)
    return action
  }

  // 把光标上的物品放到槽位
  placeAt (slot) {
    const item = this.inventory.cursor
    const action = this.clickSlot(slot, { button: 0, mode: 0, item })
    this.inventory.slots[slot] = item
    this.inventory.cursor = null
    this.emit('inventoryUpdate', this.inventory.slots)
    return action
  }

  // 把一个槽位的物品搬到另一个槽位（拿起 → 放下）
  async moveItem (fromSlot, toSlot) {
    this.pickUp(fromSlot)
    await new Promise((resolve) => setTimeout(resolve, 250))
    this.placeAt(toSlot)
    await new Promise((resolve) => setTimeout(resolve, 250))
    return this.inventory.slots[toSlot]
  }

  setQuickBarSlot (slot) {
    if (slot < 0 || slot > 8) throw new Error('setQuickBarSlot: 只能是 0-8')
    this.inventory.selectedSlot = slot
    this.heldItemSlot = slot
    this.client.write('held_item_slot', { slotId: HOTBAR_START + slot })
    this.emit('heldItemChanged', slot)
  }

  /* ---------------- 窗口（箱子、GT 机器……） ---------------- */

  /*
   * 右键一个方块。GT 机器 / 箱子都是靠这个包打开的，服务器回 open_window
   * 之后内容在 window_items 里。heldItem 为空手 { blockId: -1 } 也算合法。
   */
  activateBlock (block, faceVec = new Vec3(0, 1, 0)) {
    const base = block.position ?? block
    const target = { x: Math.floor(base.x), y: Math.floor(base.y), z: Math.floor(base.z) }
    const face = { x: Math.round(faceVec.x), y: Math.round(faceVec.y), z: Math.round(faceVec.z) }
    const direction = face.y === 1 ? 1 : face.y === -1 ? 0 : face.z === -1 ? 2 : face.z === 1 ? 3 : face.x === -1 ? 4 : 5
    this.client.write('block_place', {
      location: target,
      direction,
      heldItem: this.heldItem ?? { blockId: -1 },
      cursorX: 8,
      cursorY: face.y === 1 ? 16 : 8,
      cursorZ: 8
    })
    this._swing()
    this.emit('blockActivated', { ...target, direction })
    return target
  }

  // 关掉当前窗口（服务器也会主动发 close_window）
  closeWindow () {
    const window = this.currentWindow
    if (!window) return false
    this.client.write('close_window', { windowId: window.id })
    this.currentWindow = null
    this.emit('windowClose', window)
    this.emit('windowChanged', null)
    return true
  }

  // 等服务器把某个窗口打开（GT 机器 GUI 打开有时要等一两百毫秒）
  async waitForWindow (timeout = 3000) {
    if (this.currentWindow) return this.currentWindow
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.removeListener('windowOpen', onOpen)
        reject(new Error('waitForWindow: 超时'))
      }, timeout)
      const onOpen = (window) => {
        clearTimeout(timer)
        resolve(window)
      }
      this.once('windowOpen', onOpen)
    })
  }

  // 当前窗口 / 背包里所有物品（带注册名，附带槽位号）
  windowItems () {
    const window = this.currentWindow
    const out = []
    if (window) {
      window.slots.forEach((item, slot) => {
        if (item) out.push(this._describeItem(item, slot, 'window'))
      })
    }
    this.inventory.slots.forEach((item, slot) => {
      if (item) out.push(this._describeItem(item, slot, 'inventory'))
    })
    return out
  }

  _describeItem (item, slot, where) {
    const name = this.registry ? this.registry.itemName(item.blockId) : undefined
    const display = this.lang && name ? this.lang.itemName(name) : undefined
    return { slot, where, ...item, name, displayName: display }
  }

  /*
   * 某个维度的世界。GTNH 的维度可以很多（主世界 0、下界 -1、末地 1，再加一堆
   * Galacticraft / 模组维度），跨维度时实体位置会重来，但区块要分开存，
   * 否则从下界回来会看到一堆错位的方块。
   */
  worldFor (dimension = this.dimension) {
    let store = this.worlds.get(dimension)
    if (!store) {
      store = new ChunkStore()
      this.worlds.set(dimension, store)
      if (dimension === this.dimension) {
        this.world = store
        this.emit('worldReady', dimension)
      }
    }
    if (dimension === this.dimension && this.world !== store) this.world = store
    return store
  }

  _ensureWorld () {
    return this.worldFor(this.dimension)
  }

  _onBulk (bulk) {
    const world = this._ensureWorld()
    world.applyBulk(bulk)
    this.chunkCount = world.stats().columns
    this.emit('chunk', bulk)
  }

  _onChunk (chunk) {
    const world = this._ensureWorld()
    world.applyDecodedColumn(chunk)
    this.chunkCount = world.stats().columns
    this.emit('chunk', chunk)
  }

  _onBlockChange (change) {
    if (!this.world) return
    if (this.world.applyBlockChange(change)) this.emit('blockUpdate', change)
  }

  _onMultiBlockChange (multi) {
    if (!this.world) return
    this.world.applyMultiBlockChange(multi)
    this.emit('blockUpdates', multi.changes)
  }

  /* ---------------- 查询 ---------------- */

  /*
   * 1.7.10 的 feature 判定。minecraft-data 对 1.7.10 一律返回 false，
   * 所以这里走 gtnh-data 的表（已按 GTNH 的 mod 修正，比如副手槽）。
   */
  supports (feature) {
    return supports(feature)
  }

  featureValue (feature) {
    return featureValue(feature)
  }

  get features () {
    return GTNH_FEATURES
  }

  blockAt (position) {
    if (!this.world) return null
    return this.world.getBlock(position)
  }

  // 方块的名字（GTNH 注册名 + 中文本地化）
  blockNameAt (position) {
    const block = this.blockAt(position)
    if (!block) return null
    const name = this.registry ? this.registry.blockName(block.blockId) : undefined
    const display = this.lang && name ? this.lang.blockName(name) : undefined
    return { ...block, name, displayName: display }
  }

  entitiesNear (position = this.entity.position, radius = 16) {
    const out = []
    for (const entity of this.entities.values()) {
      if (entity.position.distanceTo(position) <= radius) out.push(entity)
    }
    return out
  }

  nearestEntity (type = null, radius = 32) {
    let best = null
    let bestDistance = radius
    for (const entity of this.entities.values()) {
      if (type && entity.type !== type) continue
      const distance = entity.position.distanceTo(this.entity.position)
      if (distance < bestDistance) {
        best = entity
        bestDistance = distance
      }
    }
    return best
  }

  /* ---------------- 物理与移动 ---------------- */

  _startTicking () {
    if (this.tickInterval) return
    this.tickInterval = setInterval(() => this._tick(), 50)
    // 别让 tick 循环把进程钉住（脚本跑完能正常退出）
    if (this.tickInterval.unref) this.tickInterval.unref()
  }

  _stopTicking () {
    if (this.tickInterval) clearInterval(this.tickInterval)
    this.tickInterval = null
  }

  _isSolid (x, y, z) {
    if (!this.world) return false
    const block = this.world.getBlock({ x, y, z })
    if (!block || block.blockId === 0) return false
    return this._blockInfo(block.blockId).boundingBox !== 'empty'
  }

  // 1.7.10 的方块数据只有 block / empty 两种碰撞箱
  _blockInfo (blockId) {
    if (!this._boundingBoxes) this._boundingBoxes = new Map()
    const cached = this._boundingBoxes.get(blockId)
    if (cached) return cached

    let name = null
    if (this.registry) name = this.registry.blockName(blockId) ?? this.registry.itemName(blockId)
    const base = name ? name.replace(/^minecraft:/, '').split(':').pop() : null
    const data = base ? mcData.blocksByName[base] : undefined
    const info = data
      ? { name: base, displayName: data.displayName, boundingBox: data.boundingBox, hardness: data.hardness, diggable: data.diggable !== false }
      // GTNH 的自定义方块默认按整块算
      : { name: name ?? `id:${blockId}`, displayName: name ?? `id:${blockId}`, boundingBox: 'block', hardness: 1, diggable: true }
    this._boundingBoxes.set(blockId, info)
    return info
  }

  _tick () {
    if (!this.spawned || !this.client) return
    this.tickCount++

    if (this.physicsEnabled) {
      physics.tick(
        this.physicsState,
        this.control,
        (x, y, z) => this._isSolid(x, y, z),
        this.entity.yaw
      )
      this.entity.onGround = this.physicsState.onGround
    }

    this._sendPosition()
  }

  _sendPosition () {
    const pos = this.physicsState.position
    const yaw = this.entity.yaw ?? 0
    const pitch = this.entity.pitch ?? 0
    const onGround = this.physicsState.onGround
    const last = this._lastSent
    const moved = !last ||
      Math.abs(pos.x - last.x) > 1e-3 ||
      Math.abs(pos.y - last.y) > 1e-3 ||
      Math.abs(pos.z - last.z) > 1e-3
    const rotated = !last || yaw !== last.yaw || pitch !== last.pitch

    if (moved || rotated) {
      this.client.write('position_look', {
        x: pos.x,
        y: pos.y,
        z: pos.z,
        stance: pos.y + physics.EYE_HEIGHT,
        yaw,
        pitch,
        onGround
      })
      this._lastSent = { x: pos.x, y: pos.y, z: pos.z, yaw, pitch }
      this.emit('move')
    } else {
      // 原地不动时也要报 onGround，否则服务器的掉落/燃烧判定会乱
      this.client.write('flying', { onGround })
    }
  }

  setControlState (name, state) {
    if (!(name in this.control)) throw new Error(`setControlState: 未知控制项 ${name}`)
    this.control[name] = Boolean(state)
  }

  clearControlStates () {
    for (const key of Object.keys(this.control)) this.control[key] = false
  }

  get onGround () {
    return this.physicsState.onGround
  }

  get velocity () {
    return this.physicsState.velocity
  }

  // 站到指定方块坐标（直接改本地位置，下个 tick 会发给服务器）
  setPosition (pos) {
    this.physicsState.position.set(pos.x, pos.y, pos.z)
    this.physicsState.velocity.set(0, 0, 0)
    this._lastSent = null
  }

  /* ---------------- 动作 ---------------- */

  chat (message) {
    this.client.write('chat', { message })
    this.emit('chatSent', message)
  }

  // 转视角。有物理 tick 时由 tick 统一发 position_look，不然直接发 look
  look (yaw, pitch, onGround = this.physicsState.onGround) {
    this.entity.yaw = yaw
    this.entity.pitch = pitch
    if (!this.spawned || !this.physicsEnabled) {
      this.client.write('look', { yaw, pitch, onGround })
    }
  }

  // 看向某个点（世界坐标）
  lookAt (point) {
    const eye = new Vec3(
      this.physicsState.position.x,
      this.physicsState.position.y + physics.EYE_HEIGHT,
      this.physicsState.position.z
    )
    const dx = point.x - eye.x
    const dy = point.y - eye.y
    const dz = point.z - eye.z
    const groundDistance = Math.hypot(dx, dz)
    const yaw = Math.atan2(-dx, dz) * 180 / Math.PI
    const pitch = -Math.atan2(dy, groundDistance) * 180 / Math.PI
    this.look(yaw, pitch)
    return { yaw, pitch }
  }

  _swing () {
    this.client.write('arm_animation', { entityId: this.entity.id, animation: 0 })
  }

  // 挖掉一个方块：status 0 开始，等够时间再 status 2 结束（创造模式秒破）
  async dig (block, { face = 1 } = {}) {
    const position = block.position ?? block
    const location = {
      x: Math.floor(position.x),
      y: Math.floor(position.y),
      z: Math.floor(position.z)
    }
    const current = this.blockAt(location)
    if (current) this.lookAt({ x: location.x + 0.5, y: location.y + 0.5, z: location.z + 0.5 })

    this.client.write('block_dig', { status: 0, location, face })
    this._swing()

    const delay = this.digTime(current)
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))

    this.client.write('block_dig', { status: 2, location, face })
    this._swing()
    this.emit('diggingCompleted', location)
    return true
  }

  digTime (block) {
    if (this.gameMode === 1) return 50
    const info = block ? this._blockInfo(block.blockId) : { hardness: 1 }
    const hardness = info.hardness ?? 1
    // 简化：硬度 × 1.5 秒（等价于空手挖石头 2.25s）
    return Math.max(50, Math.round(hardness * 1500))
  }

  /*
   * 在 refBlock 的某个面放方块。face 用 mineflayer 的约定（Vec3 偏移），
   * 里面换成 1.7.10 的方向号（0=-y 1=+y 2=-z 3=+z 4=-x 5=+x）。
   */
  placeBlock (refBlock, faceVec = new Vec3(0, 1, 0)) {
    const base = refBlock.position ?? refBlock
    const target = { x: Math.floor(base.x), y: Math.floor(base.y), z: Math.floor(base.z) }
    const face = { x: Math.round(faceVec.x), y: Math.round(faceVec.y), z: Math.round(faceVec.z) }
    const direction = face.y === 1 ? 1 : face.y === -1 ? 0 : face.z === -1 ? 2 : face.z === 1 ? 3 : face.x === -1 ? 4 : 5
    this.client.write('block_place', {
      location: target,
      direction,
      heldItem: this.heldItem ?? { blockId: -1 },
      cursorX: 8,
      cursorY: face.y === 1 ? 16 : 8,
      cursorZ: 8
    })
    this._swing()
    this.emit('placedBlock', { ...target, direction })
  }

  quit (reason = 'quit') {
    this._stopTicking()
    try {
      this.client.end(reason)
    } catch (err) {
      this.emit('error', err)
    }
  }
}

async function createBot (options = {}) {
  const bot = new Bot(options)
  await bot.connect()
  return bot
}

module.exports = { createBot, Bot, Entity, Vec3, loadServerMods, formatMessage }
