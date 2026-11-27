// GTNH-PATCH: ModularUI2 windows.
//
// GTNH's GT machines do not send `open_window`. Their GUI is opened by the
// ModularUI2 mod, which ships its own `modularui2` plugin channel; the
// container contents still arrive through the vanilla `window_items` /
// `set_slot` packets, using a window id the client never saw announced.
//
// The client therefore has to infer the window from the first `window_items`
// that carries an unknown id: the slot count is the machine's slot count plus
// the 36 player-inventory slots, so the player inventory starts at
// `slotCount - 36`.
const { decodeSyncValue, encodeSyncHandler, encodeWidgetAction, encodeCloseGui } = require('protocol-fml')

const PLAYER_SLOTS = 36

// How long to wait for a real `open_window` before inferring a window from
// `window_items` alone. Villager/chest windows send their items before the
// open packet, so inference must not fire while the open packet is in flight.
const IMPLICIT_DELAY_MS = 150

function createModularWindow (windows, title, packet) {
  const count = packet.items.length
  const playerSlots = Math.min(PLAYER_SLOTS, count)
  const inventoryStart = count - playerSlots
  const win = new windows.Window(packet.windowId, 'modularui2', title, count,
    { start: inventoryStart, end: count - 1 }, -1, false)
  win.implicit = true
  win.modularUI = true
  return win
}

// 监听 protocol-fml 解好的 `gtnh_mui2` 事件：
//   openGui     -> 记住 windowId / factory / 方块坐标，供窗口层立刻开窗
//   syncHandler -> 把面板里的控件值聚合到 bot.machineState
//   closeGui    -> 清掉对应的 pending 信息
function attachModularUI (bot) {
  const state = new Map() // panel -> Map(key -> decoded)
  const listeners = []

  function panelState (panel) {
    let entry = state.get(panel)
    if (!entry) {
      entry = new Map()
      state.set(panel, entry)
    }
    return entry
  }

  const onMui2 = (msg) => {
    switch (msg.name) {
      case 'openGui':
        bot.pendingModularWindow = {
          windowId: msg.windowId,
          factory: msg.factory,
          blockPos: msg.blockPos,
          networkId: msg.networkId
        }
        bot.emit('modularOpen', bot.pendingModularWindow)
        break
      case 'closeGui':
      case 'closeAllGui':
        if (bot.pendingModularWindow && (msg.name === 'closeAllGui' || bot.pendingModularWindow.networkId === msg.networkId)) {
          const closed = bot.pendingModularWindow
          bot.pendingModularWindow = null
          bot.emit('modularClose', closed)
        }
        break
      case 'syncHandler': {
        const decoded = { key: msg.key, panel: msg.panel, action: msg.action, ...decodeSyncValue(msg.key, msg.data) }
        panelState(msg.panel).set(msg.key, decoded)
        bot.emit('modularSync', decoded)
        break
      }
    }
  }

  bot._client.on('gtnh_mui2', onMui2)
  listeners.push(() => bot._client.removeListener('gtnh_mui2', onMui2))

  bot.machineState = state
  bot.panelState = (panel) => {
    const entry = state.get(panel)
    if (!entry) return null
    const out = {}
    for (const [key, value] of entry) out[key] = value
    return out
  }
  // ---------- 写路径 ----------
  // MUI2 的 syncHandler 是双向的：客户端发同一个包（id 12）就能改值，
  // 服务端在 ValueSyncHandler.readOnServer(0) 里 read() 落回 setter。
  // 服务端可以用 allowC2S(false) 关掉，那样包会被静默丢弃（不会断连）。
  const sendRaw = (buf) => bot._client.write('custom_payload', { channel: 'modularui2', data: buf })

  // 面板里的 key 常带 `:<n>` 后缀（powerSwitch:0、auto_sync:<panel>:2），
  // 对外 API 允许传短名，这里做一次解析。
  function resolveKey (panel, key) {
    const entry = state.get(panel)
    if (!entry || entry.has(key)) return key
    for (const k of entry.keys()) {
      if (k === key || k.split(':')[0] === key || k.split(':').pop() === key) return k
    }
    return key
  }

  function currentType (panel, key, value) {
    const cur = state.get(panel)?.get(key)
    if (cur && cur.kind && cur.kind !== 'raw') return cur.kind === 'bool' ? 'bool' : cur.kind === 'double' ? 'double' : cur.kind === 'long' ? 'long' : 'int'
    return typeof value === 'boolean' ? 'bool' : Number.isInteger(value) ? 'int' : 'double'
  }

  // bot.muiSet(panel, key, value, {type}) -> boolean（有没有发出去）
  bot.muiSet = (panel, key, value, opts = {}) => {
    const win = bot.pendingModularWindow
    if (!win) return false
    key = resolveKey(panel, key)
    const type = opts.type || currentType(panel, key, value)
    sendRaw(encodeSyncHandler({ networkId: win.networkId, panel, key, value, type }))
    bot.emit('modularWrite', { panel, key, value, type })
    return true
  }

  // 取反一个布尔（powerSwitch 这类开关）
  bot.muiToggle = (panel, key) => {
    key = resolveKey(panel, key)
    const cur = state.get(panel)?.get(key)
    const next = !(cur && cur.value)
    return bot.muiSet(panel, key, next)
  }

  // 点一个 widget（action=true）：payload 由调用方给，默认空
  bot.muiClick = (panel, key, payload) => {
    const win = bot.pendingModularWindow
    if (!win) return false
    key = resolveKey(panel, key)
    sendRaw(encodeWidgetAction({ networkId: win.networkId, panel, key, payload }))
    bot.emit('modularWrite', { panel, key, action: true })
    return true
  }

  // 关掉当前 MUI2 窗口（GT 机器不发 close_window，走 MUI2 自己的包）
  bot.muiClose = (dispose = false) => {
    const win = bot.pendingModularWindow
    if (!win) return false
    sendRaw(encodeCloseGui({ networkId: win.networkId, dispose }))
    return true
  }

  bot.modularPanels = () => [...state.keys()]
  bot.disposeModularUI = () => { for (const off of listeners) off() }
  return bot
}

module.exports = {
  PLAYER_SLOTS,
  IMPLICIT_DELAY_MS,
  createModularWindow,
  attachModularUI
}
