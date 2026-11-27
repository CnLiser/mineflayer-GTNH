'use strict'

/*
 * GTNH 2.9 的 GT 机器 GUI 走 ModularUI2，不开原版 open_window。
 *
 * 线上看到的是 standard FML 插件通道 `modularui2` 的 custom_payload：
 * 首字节是 SimpleNetworkWrapper 的包 id，后面才是包体。NetworkHandler 注册
 * 7 个包（registerBoth 的占两个 id）：
 *
 *   1  SClipboard        S -> C
 *   2  SyncConfig        C -> S
 *   3  OpenGuiPacket     S -> C   (4 = C -> S)
 *   5  ReopenGuiPacket   (6)
 *   7  CloseGuiPacket    (8)
 *   9  CloseAllGuiPacket (10)
 *  11  PacketSyncHandler (12)
 *
 * 关键点：客户端**必须先向服务器 REGISTER 这个通道**，否则 FML 不会把任何
 * modularui2 载荷发过来（NetworkDispatcher 只看玩家声明过的通道）。
 */

const { readVarInt, writeVarInt, writeString } = require('../codec')

const PACKET_NAMES = {
  1: 'clipboard',
  2: 'syncConfig',
  3: 'openGui',
  4: 'openGui',
  5: 'reopenGui',
  6: 'reopenGui',
  7: 'closeGui',
  8: 'closeGui',
  9: 'closeAllGui',
  10: 'closeAllGui',
  11: 'syncHandler',
  12: 'syncHandler'
}

// PacketSyncHandler 里那个前导 varint：值是 ValueSyncHandler.SYNC_VALUE(0)
// 或 ItemSlotSH.SYNC_ITEM(0) / SYNC_ENABLED(1)，用来区分同一个 key 上的不同写入。
const SYNC_VALUE = 0
const SYNC_ITEM = 0
const SYNC_ENABLED = 1

function readString (buf, offset) {
  const len = readVarInt(buf, offset)
  const start = offset + len.size
  if (start + len.value > buf.length) throw new Error('modularui: string out of bounds')
  return { value: buf.toString('utf8', start, start + len.value), size: len.size + len.value }
}

function readByteBuf (buf, offset) {
  const len = readVarInt(buf, offset)
  const start = offset + len.size
  if (start + len.value > buf.length) throw new Error('modularui: buffer out of bounds')
  return { value: buf.subarray(start, start + len.value), size: len.size + len.value }
}

function parseOpenGui (buf, offset) {
  const windowId = readVarInt(buf, offset)
  const networkId = readVarInt(buf, offset + windowId.size)
  let off = offset + windowId.size + networkId.size
  const factory = readString(buf, off)
  off += factory.size
  const data = readByteBuf(buf, off)
  return {
    windowId: windowId.value,
    networkId: networkId.value,
    factory: factory.value,
    data: data.value,
    // GT 的 UI factory 把方块坐标塞进 data（varint 长度 3 + x/y/z 各一字节）
    blockPos: data.value.length === 3 ? { x: data.value[0], y: data.value[1], z: data.value[2] } : null
  }
}

function parseCloseGui (buf, offset) {
  const networkId = readVarInt(buf, offset)
  return { networkId: networkId.value, dispose: buf[offset + networkId.size] === 1 }
}

function parseSyncHandler (buf, offset) {
  const networkId = readVarInt(buf, offset)
  const panel = readString(buf, offset + networkId.size)
  let off = offset + networkId.size + panel.size
  const key = readString(buf, off)
  off += key.size
  const action = buf[off++] === 1
  const data = readByteBuf(buf, off)
  return {
    networkId: networkId.value,
    panel: panel.value,
    key: key.value,
    action,
    data: data.value
  }
}

// 解析一个 modularui2 custom_payload 的 data 部分。
function parsePacket (buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new Error('modularui: empty payload')
  const id = readVarInt(buf, 0)
  const name = PACKET_NAMES[id.value]
  const body = id.size
  const base = { id: id.value, name: name ?? 'unknown' }
  switch (name) {
    case 'openGui':
      return { ...base, ...parseOpenGui(buf, body) }
    case 'reopenGui':
      return { ...base, windowId: readVarInt(buf, body).value }
    case 'closeGui':
      return { ...base, ...parseCloseGui(buf, body) }
    case 'closeAllGui':
      return { ...base, raw: buf.subarray(body) }
    case 'syncHandler':
      return { ...base, ...parseSyncHandler(buf, body) }
    default:
      return { ...base, raw: buf.subarray(body) }
  }
}

// ---------- 同步值解码 ----------
//
// PacketSyncHandler.packet 是 SyncHandler 自己写的 PacketBuffer：
//   [varint tag][值]
// tag=0 表示「值同步」，之后是 handler.write() 的内容：
//   BooleanSyncValue -> 1 字节布尔
//   IntSyncValue     -> varint（负数按 32 位补码展开，-1 为 ff ff ff ff 0f）
//   LongSyncValue    -> 8 字节大端（writeLong）
//   DoubleSyncValue  -> 8 字节大端 IEEE-754（writeDouble；GT 进度条用它）
//   ItemSlotSH       -> [bool readOnly][ItemStack][bool enabled][bool false]
// MUI2 用 ASM 把 PacketBuffer.writeByte 改成 writeVarInt，所以物品数量是 varint。
//
// 注意：ItemSlotSH 的 SYNC_ITEM 与 ValueSyncHandler 的 SYNC_VALUE 都是 0，
// 光看 tag 分不出是值还是物品槽 —— 我们按 key 名与长度一起判断，拿不准就给 raw。

const BOOL_KEYS = new Set([
  'powerSwitch', 'hasError', 'powerfail', 'mufflerSyncer', 'itemAutoOutput',
  'fluidAutoOutput', 'active', 'enabled', 'muffler'
])

function keyBase (key) {
  const i = key.indexOf(':')
  return (i < 0 ? key : key.slice(0, i)).split('.').pop()
}

function readLongBE (buf, offset) {
  const v = buf.readBigInt64BE(offset)
  // 在安全范围内返回 number，否则保留 bigint
  return (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) ? Number(v) : v
}

// 解码一个 sync 值。返回 { tag, kind, value }，认不出来时 kind='raw'。
function decodeSyncValue (key, buf) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) return { tag: null, kind: 'raw', value: null }
  const tag = readVarInt(buf, 0)
  const rest = buf.subarray(tag.size)
  const base = keyBase(key)

  // 物品槽：3 个布尔 + 10 字节物品，最短 13 字节
  if (rest.length >= 13 && (rest[0] === 0 || rest[0] === 1)) {
    const item = decodeItemStack(rest, 1)
    if (item) {
      return {
        tag: tag.value,
        kind: 'item',
        value: {
          readOnly: rest[0] === 1,
          item: item.item,
          enabled: rest[item.size + 1] === 1,
          phantom: rest[item.size + 2] === 1
        }
      }
    }
  }

  if (rest.length === 1) return { tag: tag.value, kind: 'bool', value: rest[0] === 1 }
  if (rest.length === 8) {
    // MUI2 给「widget 自己带的值」自动注册 `auto_sync:<panel>:<n>`，长度上分不出
    // long / double（两边都是 8 字节大端）。GT 的进度条是
    // `new DoubleSyncValue(this::getAsDouble)`，空转时 0/0 = NaN —— 也就是
    // `ff f8 00 …` 那个「疑似哨兵」。进度值域是 [0,1] 或 NaN，据此把 double
    // 和 long（能量、数量）分开；认错的 8 字节值仍可用 `readDoubleBE` 复核。
    const asDouble = rest.readDoubleBE(0)
    if (/^auto_sync:/i.test(key) && (Number.isNaN(asDouble) || (asDouble >= 0 && asDouble <= 1))) {
      return { tag: tag.value, kind: 'double', value: asDouble }
    }
    if (/auto_sync|Energy|Amount|Long/i.test(key)) {
      return { tag: tag.value, kind: 'long', value: readLongBE(rest, 0) }
    }
  }
  if (rest.length <= 5) {
    // 5 字节以内既可能是 varint 整数，也可能是 1 字节布尔 + 填充；按 varint 解释
    try {
      return { tag: tag.value, kind: 'int', value: toSigned32(readVarInt(rest, 0).value) }
    } catch (e) { /* 落到 raw */ }
  }
  if (BOOL_KEYS.has(base) && rest.length >= 1) {
    return { tag: tag.value, kind: 'bool', value: rest[rest.length - 1] === 1 }
  }
  return { tag: tag.value, kind: 'raw', value: rest.toString('hex') }
}

// ItemStack：id(i32 BE) + count(u8) + damage(i16 BE) + nbtLen(i16 BE) + nbt + 末尾 1 字节
// 末尾那个字节在 GTNH 上等于 count（questbook x1 -> 01，x2 -> 02，x64 -> 40），
// 暂时当成不透明字段原样保留。
function decodeItemStack (buf, offset) {
  if (offset + 10 > buf.length) return null
  const id = buf.readInt32BE(offset)
  const count = buf[offset + 4]
  const damage = buf.readInt16BE(offset + 5)
  const nbtLen = buf.readInt16BE(offset + 7)
  let off = offset + 9
  let nbt = null
  if (nbtLen > 0) {
    if (off + nbtLen > buf.length) return null
    nbt = buf.subarray(off, off + nbtLen)
    off += nbtLen
  } else if (nbtLen !== -1) {
    return null
  }
  if (off + 1 > buf.length) return null
  const extra = buf[off]
  if (id < 0 || count > 64 || damage > 32767) return null
  return { size: off + 1 - offset, item: { blockId: id, itemCount: count, itemDamage: damage, nbt, extra } }
}

function toSigned32 (v) {
  return v >= 0x80000000 ? v - 0x100000000 : v
}

// 把一批 sync 值聚合成「面板 -> 状态」，方便直接打印/断言。
function collectSync (messages) {
  const panels = {}
  for (const msg of messages) {
    if (msg.name !== 'syncHandler' || msg.action) continue
    const panel = (panels[msg.panel] ??= {})
    panel[msg.key] = decodeSyncValue(msg.key, msg.data)
  }
  return panels
}


// ---------- 编码（客户端 -> 服务端） ----------
//
// 客户端发的是同一种 PacketSyncHandler，只是包 id 走 C->S 那一半：
//   4 openGui / 6 reopenGui / 8 closeGui / 10 closeAllGui / 2 syncConfig /
//   12 syncHandler
// 包体对称：varint networkId + string panel + string key + bool action +
// byteBuf(payload)，payload 是 [varint tag][值]。
// tag=0 同时用于 SYNC_VALUE 与 ItemSlotSH 的 SYNC_ITEM，靠 handler 类型区分。

// GTNH-PATCH: C2S 用的 discriminator 与 S2C **相同**（0..11），不是 S2C+1。
// `NetworkHandler.registerBoth` 是「把同一个 id 在两侧各注册一份」；猜 +1 的结果是
// 服务端回 `Undefined message for discriminator 12 in channel modularui2`（FML 只打日志、
// 不断连，所以一开始没发现）。实机验证：发 id 11 的 syncHandler 改 powerSwitch，
// 关掉 GUI 再打开，值真的变了。
const C2S_IDS = {
  syncConfig: 1,
  openGui: 3,
  reopenGui: 5,
  closeGui: 7,
  closeAllGui: 9,
  syncHandler: 11
}

// 把 JS 值编码成 SyncHandler.read() 期望的字节。type 决定用哪种 varint/double。
function encodeSyncPayload (value, type) {
  const tag = writeVarInt(SYNC_VALUE)
  const t = type || (typeof value === 'boolean' ? 'bool' : 'int')
  if (t === 'bool') return Buffer.concat([tag, Buffer.from([value ? 1 : 0])])
  if (t === 'int') return Buffer.concat([tag, writeVarInt(value | 0)])
  if (t === 'long') {
    const b = Buffer.alloc(8)
    b.writeBigInt64BE(BigInt(value))
    return Buffer.concat([tag, b])
  }
  if (t === 'double') {
    const b = Buffer.alloc(8)
    b.writeDoubleBE(Number(value))
    return Buffer.concat([tag, b])
  }
  if (t === 'string') return Buffer.concat([tag, writeString(String(value))])
  throw new Error('modularui: 不认识的同步类型 ' + t)
}

// 组一个 syncHandler 的 C->S 包（不含 custom_payload 外壳）。
function encodeSyncHandler ({ networkId, panel, key, action = false, value, type }) {
  const payload = encodeSyncPayload(value, type)
  return Buffer.concat([
    writeVarInt(C2S_IDS.syncHandler),
    writeVarInt(networkId | 0),
    writeString(String(panel)),
    writeString(String(key)),
    Buffer.from([action ? 1 : 0]),
    writeVarInt(payload.length),
    payload
  ])
}

// 只发 action（widget 点击），payload 交给调用方。
function encodeWidgetAction ({ networkId, panel, key, payload = Buffer.alloc(0) }) {
  return Buffer.concat([
    writeVarInt(C2S_IDS.syncHandler),
    writeVarInt(networkId | 0),
    writeString(String(panel)),
    writeString(String(key)),
    Buffer.from([1]),
    writeVarInt(payload.length),
    payload
  ])
}

// 关窗（C->S closeGui，id 8）—— GT 机器没有原版 close_window 时用它。
function encodeCloseGui ({ networkId, dispose = false }) {
  return Buffer.concat([writeVarInt(C2S_IDS.closeGui), writeVarInt(networkId | 0), Buffer.from([dispose ? 1 : 0])])
}

module.exports = {
  PACKET_NAMES,
  SYNC_VALUE,
  SYNC_ITEM,
  SYNC_ENABLED,
  parsePacket,
  decodeSyncValue,
  decodeItemStack,
  collectSync,
  C2S_IDS,
  encodeSyncPayload,
  encodeSyncHandler,
  encodeWidgetAction,
  encodeCloseGui,
  readString,
  readByteBuf
}
