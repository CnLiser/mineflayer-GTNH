'use strict'

/*
 * Forge 1.7.10 客户端 FML 握手（FML|HS）。
 *
 * 序列（Login Success 之后、JoinGame 之前）：
 *   S→C REGISTER          通道声明
 *   S→C FML|HS 0          ServerHello(协议版本, 维度)
 *   C→S REGISTER/ClientHello/ModList
 *   S→C FML|HS 2          服务器 ModList（校验点）
 *   C→S FML|HS 255/2      ACK WAITINGSERVERDATA
 *   S→C FML|HS 3          ModIdData（1.7 专属：方块/物品数字 ID 表，大包走 FML|MP 分片）
 *   C→S FML|HS 255/3      ACK WAITINGSERVERCOMPLETE
 *   S→C FML|HS 255/2      ACK
 *   C→S FML|HS 255/4      ACK PENDINGCOMPLETE
 *   S→C FML|HS 255/3      ACK
 *   C→S FML|HS 255/5      ACK COMPLETE
 *   S→C login             JoinGame
 */

const { EventEmitter } = require('events')
const {
  readVarInt,
  writeVarInt,
  readString,
  writeString,
  splitChannels,
  joinChannels
} = require('./codec')

const CHANNEL_HS = 'FML|HS'
const CHANNEL_MP = 'FML|MP'

const DISC = {
  SERVER_HELLO: 0,
  CLIENT_HELLO: 1,
  MOD_LIST: 2,
  MOD_ID_DATA: 3,
  ACK: 255
}

const PHASE = {
  HELLO: 1,
  WAITING_SERVER_DATA: 2,
  WAITING_SERVER_COMPLETE: 3,
  PENDING_COMPLETE: 4,
  COMPLETE: 5
}

// modularui2：GT 机器的 GUI 走这个通道。客户端不 REGISTER 的话，FML 的
// NetworkDispatcher 根本不会把载荷发过来（GT 机器就永远打不开）。
const DEFAULT_CHANNELS = [CHANNEL_HS, 'FML', CHANNEL_MP, 'FORGE', 'modularui2', 'BQ_NET_CHAN']

// ---------- 编码 ----------

function encodeClientHello (protocolVersion) {
  return Buffer.from([DISC.CLIENT_HELLO, protocolVersion])
}

function encodeAck (phase) {
  return Buffer.from([DISC.ACK, phase & 0xff])
}

function encodeModList (mods) {
  const parts = [Buffer.from([DISC.MOD_LIST]), writeVarInt(mods.length)]
  for (const mod of mods) {
    parts.push(writeString(mod.modid ?? mod.modId ?? mod.name))
    parts.push(writeString(mod.version ?? ''))
  }
  return Buffer.concat(parts)
}

function encodeServerHello (protocolVersion, dimension) {
  const head = Buffer.alloc(2)
  head[0] = DISC.SERVER_HELLO
  head[1] = protocolVersion
  if (protocolVersion > 1) {
    const dim = Buffer.alloc(4)
    dim.writeInt32BE(dimension ?? 0, 0)
    return Buffer.concat([head, dim])
  }
  return head
}

// 只用于测试/模拟服务端：按 Forge 1.7.10 的 ModIdData 格式编码
// 注意：方块/物品类型是作为字符串的**首字符**（\x01 方块 / \x02 物品）写进去的，
// 不是单独的字节——这一点和 wiki 的文字描述对不上，以真实服务器抓包为准。
function encodeModIdData (entries, blockSubstitutions = [], itemSubstitutions = []) {
  const parts = [Buffer.from([DISC.MOD_ID_DATA]), writeVarInt(entries.length)]
  for (const e of entries) {
    parts.push(writeString(String.fromCharCode(e.type) + e.name))
    parts.push(writeVarInt(e.id))
  }
  parts.push(writeVarInt(blockSubstitutions.length))
  for (const s of blockSubstitutions) parts.push(writeString(s))
  parts.push(writeVarInt(itemSubstitutions.length))
  for (const s of itemSubstitutions) parts.push(writeString(s))
  return Buffer.concat(parts)
}

// 把一条逻辑包切成 FML|MP 分片（第一片是头，后面每片带序号）
function splitMultipart (channel, payload, maxPartSize = 30000) {
  const parts = Math.max(1, Math.ceil(payload.length / maxPartSize))
  const head = [writeString(channel), Buffer.from([parts])]
  const length = Buffer.alloc(4)
  length.writeInt32BE(payload.length, 0)
  head.push(length)
  const packets = [Buffer.concat(head)]
  for (let i = 0; i < parts; i++) {
    const slice = payload.subarray(i * maxPartSize, Math.min(payload.length, (i + 1) * maxPartSize))
    packets.push(Buffer.concat([Buffer.from([i]), slice]))
  }
  return packets
}

// ---------- 解码 ----------

function parseModList (buf) {
  let off = 1 // 跳过 discriminator
  const count = readVarInt(buf, off)
  off += count.size
  const mods = []
  for (let i = 0; i < count.value; i++) {
    const id = readString(buf, off)
    off += id.size
    const version = readString(buf, off)
    off += version.size
    mods.push({ modid: id.value, version: version.value })
  }
  return mods
}

function parseModIdData (buf) {
  let off = 1 // 跳过 discriminator
  const count = readVarInt(buf, off)
  off += count.size
  const entries = []
  for (let i = 0; i < count.value; i++) {
    const len = readVarInt(buf, off)
    off += len.size
    const end = off + len.value
    if (end > buf.length) throw new Error(`ModIdData: 第 ${i} 条名字越界（需要 ${end}，只有 ${buf.length}）`)
    const type = buf[off]
    const name = buf.toString('utf8', off + 1, end)
    off = end
    const id = readVarInt(buf, off)
    off += id.size
    entries.push({ type, name, id: id.value })
  }
  const block = readStringArray(buf, off)
  const item = readStringArray(buf, block.offset)
  return {
    entries,
    blockSubstitutions: block.values,
    itemSubstitutions: item.values,
    bytesConsumed: item.offset
  }
}

function readStringArray (buf, offset) {
  const count = readVarInt(buf, offset)
  let off = offset + count.size
  const values = []
  for (let i = 0; i < count.value; i++) {
    const s = readString(buf, off)
    off += s.size
    values.push(s.value)
  }
  return { values, offset: off }
}

// ---------- 状态机 ----------

class FmlHandshake extends EventEmitter {
  constructor (client, options = {}) {
    super()
    this.client = client
    this.clientMods = options.mods ?? []
    this.channels = new Set([...DEFAULT_CHANNELS, ...(options.channels ?? [])])
    this.protocolVersion = 2
    this.serverProtocolVersion = null
    this.serverDimension = null
    this.serverMods = null
    this.phase = null
    this.registry = {
      blocks: new Map(),
      items: new Map(),
      blockSubstitutions: [],
      itemSubstitutions: []
    }
    this._multipart = null
    this._log = options.log ?? (() => {})
  }

  attach () {
    this.client.on('custom_payload', packet => this._onPayload(packet.channel, packet.data))
    return this
  }

  // ---------- 收包 ----------

  _onPayload (channel, data) {
    if (channel === CHANNEL_MP) return this._onMultipart(data)
    if (channel === 'REGISTER') {
      for (const name of splitChannels(data)) this.channels.add(name)
      this.emit('register', splitChannels(data))
      return
    }
    if (channel === CHANNEL_HS) return this._onHandshakePacket(data)
    this.emit('unknownChannel', { channel, data })
  }

  _onMultipart (data) {
    let off = 0
    if (!this._multipart) {
      const channel = readString(data, 0)
      off = channel.size
      const parts = data[off++]
      const length = data.readInt32BE(off)
      off += 4
      this._multipart = { channel: channel.value, parts, length, chunks: new Array(parts).fill(null), received: 0 }
    }
    if (off >= data.length) return // 只有包头

    const index = data[off++]
    const chunk = data.subarray(off)
    const mp = this._multipart
    if (index >= mp.parts) throw new Error(`FML|MP 分片序号越界: ${index}/${mp.parts}`)
    if (mp.chunks[index] === null) {
      mp.chunks[index] = chunk
      mp.received++
    }
    if (mp.received < mp.parts) return

    const payload = Buffer.concat(mp.chunks)
    const innerChannel = mp.channel
    this._multipart = null
    this.emit('multipartComplete', { channel: innerChannel, length: payload.length })
    this._onPayload(innerChannel, payload)
  }

  _onHandshakePacket (data) {
    const discriminator = data[0]
    switch (discriminator) {
      case DISC.SERVER_HELLO: {
        this.serverProtocolVersion = data[1]
        this.serverDimension = this.serverProtocolVersion > 1 ? data.readInt32BE(2) : null
        this.emit('serverHello', { protocolVersion: this.serverProtocolVersion, dimension: this.serverDimension })
        return this._onServerHello()
      }
      case DISC.CLIENT_HELLO:
        this.emit('clientHello', { protocolVersion: data[1] })
        return
      case DISC.MOD_LIST: {
        this.serverMods = parseModList(data)
        this.emit('serverModList', this.serverMods)
        return this._onServerModList()
      }
      case DISC.MOD_ID_DATA: {
        this.emit('registryRaw', { data })
        let parsed
        try {
          parsed = parseModIdData(data)
        } catch (e) {
          this.emit('registryParseError', e)
          return
        }
        for (const entry of parsed.entries) {
          if (entry.type === 1) this.registry.blocks.set(entry.id, entry.name)
          else if (entry.type === 2) this.registry.items.set(entry.id, entry.name)
        }
        if (parsed.bytesConsumed !== data.length) {
          this.emit('registryTrailing', { consumed: parsed.bytesConsumed, total: data.length })
        }
        this.registry.blockSubstitutions = parsed.blockSubstitutions
        this.registry.itemSubstitutions = parsed.itemSubstitutions
        this.emit('registry', parsed)
        return this._onRegistryData()
      }
      case DISC.ACK:
        return this._onServerAck(data[1])
      default:
        this._log(`FML|HS 未知 discriminator ${discriminator}`)
    }
  }

  // ---------- 状态迁移 ----------

  _onServerHello () {
    this.phase = PHASE.HELLO
    this._writeChannel('REGISTER', joinChannels([...this.channels]))
    this._writeHs(encodeClientHello(this.protocolVersion))
    this._writeHs(encodeModList(this.clientMods))
    this.emit('sentClientHello', { channels: [...this.channels], mods: this.clientMods.length })
  }

  _onServerModList () {
    const ours = new Set(this.clientMods.map(m => `${m.modid ?? m.modId}@${m.version ?? ''}`))
    const missing = []
    const mismatched = []
    for (const mod of this.serverMods) {
      const key = `${mod.modid}@${mod.version}`
      if (!ours.has(key)) {
        // 同 modid 但版本不同也算不一致
        const sameId = this.clientMods.find(m => (m.modid ?? m.modId) === mod.modid)
        if (!sameId) missing.push(key)
        else mismatched.push(`${key} (client ${sameId.version})`)
      }
    }
    this.emit('modListChecked', { missing, mismatched, serverCount: this.serverMods.length })
    if (missing.length) this._log(`服务器有 ${missing.length} 个 mod 客户端没有（前 5 个：${missing.slice(0, 5).join(', ')}）`)

    this._writeHs(encodeAck(PHASE.WAITING_SERVER_DATA))
    this.phase = PHASE.WAITING_SERVER_DATA
  }

  _onRegistryData () {
    this._writeHs(encodeAck(PHASE.WAITING_SERVER_COMPLETE))
    this.phase = PHASE.WAITING_SERVER_COMPLETE
    this.emit('registryAcked', { blocks: this.registry.blocks.size, items: this.registry.items.size })
  }

  _onServerAck (phase) {
    this.emit('serverAck', { phase, clientPhase: this.phase })
    if (phase === 2 && this.phase === PHASE.WAITING_SERVER_COMPLETE) {
      this._writeHs(encodeAck(PHASE.PENDING_COMPLETE))
      this.phase = PHASE.PENDING_COMPLETE
      return
    }
    if (phase === 3 && this.phase === PHASE.PENDING_COMPLETE) {
      this._writeHs(encodeAck(PHASE.COMPLETE))
      this.phase = PHASE.COMPLETE
      this.emit('complete', {
        blocks: this.registry.blocks.size,
        items: this.registry.items.size,
        mods: this.serverMods?.length ?? 0
      })
    }
  }

  // ---------- 发包 ----------

  _writeHs (payload) {
    this._writeChannel(CHANNEL_HS, payload)
  }

  _writeChannel (channel, payload) {
    this.client.write('custom_payload', { channel, data: payload })
  }
}

module.exports = {
  FmlHandshake,
  DISC,
  PHASE,
  DEFAULT_CHANNELS,
  encodeClientHello,
  encodeAck,
  encodeModList,
  encodeModIdData,
  encodeServerHello,
  parseModList,
  parseModIdData,
  splitMultipart
}
