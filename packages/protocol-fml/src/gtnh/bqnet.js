'use strict'

/*
 * BetterQuesting 的客户端通道 `BQ_NET_CHAN`（FML SimpleImpl）。
 *
 * BQ 的「提交任务」按钮不是窗口点击——它发的是自己的 custom_payload：
 *
 *   custom_payload { channel: 'BQ_NET_CHAN', data: [uint8 type=0][uint16 BE 长度][gzip(...)] }
 *
 * gzip 里是一个「分片 NBT」，多个包按 index 拼起来才是完整 payload：
 *
 *   { size: int, end: byte, index: int, data: byte[] }
 *
 * data 是 gzip(payload) 的一个切片（每片最多 PART_SIZE 字节），size 是拼接后
 * 的总长度，end=1 表示最后一片。payload 自己也是 NBT，第一个字段是 handler 的
 * ResourceLocation：
 *
 *   { ID: 'betterquesting:quest_action', action: int, questIDs: [{ questIDHigh: int[2], questIDLow: int[2] }] }
 *
 * action：0 = 提交、1 = 探测（刷可见任务）、2 = 强制选奖励。
 *
 * 这是从服务端发给客户端的 main_sync / cache_sync 包反推出来的（抓包样本
 * `00 00 84 1f 8b 08 ...`：type=0、长度 132、后面就是 gzip 流），GTNH 的 BQ 和
 * 上游 3.8 用同一套。
 */

const zlib = require('zlib')
const nbt = require('prismarine-nbt')

const CHANNEL = 'BQ_NET_CHAN'
// 一片最多 20480 字节（SimpleImpl 的包体上限 32767，留余量给 NBT 结构）
const PART_SIZE = 20480
const ACTION = { CLAIM: 0, DETECT: 1, CLAIM_FORCE_CHOICE: 2 }
const PAYLOAD_ID = 'betterquesting:quest_action'

function uuidBytes (uuid) {
  const hex = String(uuid).replace(/-/g, '')
  if (hex.length !== 32) throw new Error(`不是合法 UUID：${uuid}`)
  return Buffer.from(hex, 'hex')
}

// 两个 BE int 装一个 64 位：BQ 的 UuidConverter 就是这么拆的
function qwordToInts (buf, off) {
  return [buf.readInt32BE(off), buf.readInt32BE(off + 4)]
}

/** UUID 字符串 → BQ NBT 里的 `{ questIDHigh: int[2], questIDLow: int[2] }` */
function uuidToNbt (uuid) {
  const b = uuidBytes(uuid)
  return {
    questIDHigh: qwordToInts(b, 0),
    questIDLow: qwordToInts(b, 8)
  }
}

/** 反过来：BQ NBT 的四个 int → UUID 字符串 */
function nbtToUuid (v) {
  const b = Buffer.alloc(16)
  // 解析出来的可能是纯数组，也可能是 { type:'intArray', value:[...] }（服务端的包就是后者）
  const ints = (x) => (Array.isArray(x) ? x : (x && x.value) || [0, 0])
  const put = (x, off) => {
    const a = ints(x)
    b.writeInt32BE(a[0] | 0, off)
    b.writeInt32BE(a[1] | 0, off + 4)
  }
  put(v.questIDHigh, 0)
  put(v.questIDLow, 8)
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

// prismarine-nbt 的 byteArray 写的是有符号 byte，负数是 128..255 的补码
function signedByteArray (buf) {
  const out = []
  for (const v of buf) out.push((v << 24) >> 24)
  return out
}

/**
 * 把一个 payload 对象编成 NBT，再切片成若干 custom_payload 的 data。
 * 返回 Buffer[]，按 index 顺序。
 *
 *   encodePackets({ action: 0, questIds: ['...uuid...'] })
 */
function encodePackets (payload, opts = {}) {
  const partSize = opts.partSize ?? PART_SIZE
  // 所有字段都要是 { type, value } —— 裸字符串/数字会被 writeUncompressed 写坏
  const body = {
    ID: nbt.string(PAYLOAD_ID),
    action: nbt.int(payload.action | 0),
    // nbt.list 要的是 { type, value }，且元素必须是 comp().value（不能带 name/value 外壳）
    questIDs: {
      type: 'list',
      value: {
        type: 'compound',
        value: (payload.questIds || []).map((u) => {
          const q = uuidToNbt(u)
          return nbt.comp({
            questIDHigh: nbt.intArray(q.questIDHigh),
            questIDLow: nbt.intArray(q.questIDLow)
          }).value
        })
      }
    }
  }
  const raw = nbt.writeUncompressed(nbt.comp(body), 'big')
  const gz = zlib.gzipSync(raw)
  const parts = []
  const total = Math.max(1, Math.ceil(gz.length / partSize))
  for (let i = 0; i < total; i++) {
    const slice = gz.subarray(i * partSize, (i + 1) * partSize)
    const tag = nbt.comp({
      size: nbt.int(gz.length),
      end: nbt.byte(i === total - 1 ? 1 : 0),
      index: nbt.int(i),
      data: nbt.byteArray(signedByteArray(slice))
    })
    const partNbt = nbt.writeUncompressed(tag, 'big')
    const head = Buffer.alloc(3)
    head.writeUInt8(0, 0) // SimpleImpl 的 discriminator：0
    head.writeUInt16BE(partNbt.length, 1)
    parts.push(Buffer.concat([head, partNbt]))
  }
  return parts
}

/** 编一个 quest_action 包（提交/探测） */
function encodeQuestAction (questIds, action = ACTION.CLAIM, opts) {
  return encodePackets({ action, questIds }, opts)
}

/** 解一个 custom_payload 的 data → { type, length, tag } */
async function decodePacket (data) {
  const buf = Buffer.from(data)
  const type = buf.readUInt8(0)
  const length = buf.readUInt16BE(1)
  const parsed = await nbt.parse(buf.subarray(3), 'big')
  // parse 的结果是 { name, type, value }，字段都在 value 里
  const tag = (parsed.parsed ?? parsed).value
  return { type, length, tag }
}

/** 把若干分片拼回完整 payload（顺序无关，按 index 排） */
async function joinPackets (datas) {
  const parts = []
  for (const d of datas) parts.push(await decodePacket(d))
  if (!parts.length) return null
  const total = parts[0].tag.size.value
  parts.sort((a, b) => a.tag.index.value - b.tag.index.value)
  const chunks = []
  for (const p of parts) chunks.push(Buffer.from(Array.from(p.tag.data.value, (v) => v & 0xff)))
  const gz = Buffer.concat(chunks)
  const raw = zlib.gunzipSync(gz)
  // size 记的是 gzip 流的总长度（切片拼起来应该等于它）
  if (gz.length !== total) throw new Error(`分片拼起来长度不对：${gz.length} != ${total}`)
  const parsed = await nbt.parse(raw, 'big')
  return { payload: (parsed.parsed ?? parsed).value, raw, compressed: gz.length }
}

module.exports = {
  CHANNEL,
  PART_SIZE,
  ACTION,
  PAYLOAD_ID,
  uuidToNbt,
  nbtToUuid,
  encodePackets,
  encodeQuestAction,
  decodePacket,
  joinPackets
}
