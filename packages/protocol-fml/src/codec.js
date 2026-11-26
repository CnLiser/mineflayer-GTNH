'use strict'

/*
 * Forge 1.7.10 用到的几个原始类型读写。
 * 字符串是 varint 长度 + UTF-8（Forge 的 ByteBufUtils.writeUTF8String）。
 */

function readVarInt (buf, offset = 0) {
  let value = 0
  let shift = 0
  let size = 0
  while (true) {
    if (offset + size >= buf.length) throw new Error('readVarInt: out of bounds')
    const byte = buf[offset + size++]
    value += (byte & 0x7f) * 2 ** shift
    if ((byte & 0x80) === 0) return { value, size }
    shift += 7
    if (shift > 35) throw new Error('readVarInt: too long')
  }
}

function writeVarInt (value) {
  const bytes = []
  let v = value
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    bytes.push(byte)
  } while (v !== 0)
  return Buffer.from(bytes)
}

function readString (buf, offset = 0) {
  const { value: length, size } = readVarInt(buf, offset)
  const start = offset + size
  if (start + length > buf.length) throw new Error('readString: out of bounds')
  return { value: buf.toString('utf8', start, start + length), size: size + length }
}

function writeString (value) {
  const body = Buffer.from(value, 'utf8')
  return Buffer.concat([writeVarInt(body.length), body])
}

// 读一串以 \0 分隔的通道名（REGISTER 包体）
function splitChannels (buf) {
  return buf.toString('utf8').split('\u0000').filter(Boolean)
}

function joinChannels (channels) {
  return Buffer.from(channels.join('\u0000') + '\u0000', 'utf8')
}

/*
 * Forge 的 varshort（ByteBufUtils.readVarShort）：
 *   <128        → 1 字节
 *   <32768      → 2 字节（与普通 short 字节序一致）
 *   更大        → 3 字节：前两字节高位置 1，第三字节存高 7 位
 * 1.7.10 的 S→C custom_payload 实际用的是 varshort（minecraft-data 写的是 i16），
 * 于是 >32KB 的包（GTNH 的 ModIdData 就是）会被读错。
 */
function readVarShort (buf, offset = 0) {
  if (offset + 2 > buf.length) {
    if (offset + 1 > buf.length) throw new Error('readVarShort: out of bounds')
    return { value: buf[offset], size: 1 }
  }
  const short = (buf[offset] << 8) | buf[offset + 1]
  if (short & 0x8000) {
    if (offset + 3 > buf.length) throw new Error('readVarShort: out of bounds')
    return { value: (short & 0x7fff) | (buf[offset + 2] << 15), size: 3 }
  }
  return { value: short, size: 2 }
}

/*
 * 从 custom_payload 的 data（已按 restBuffer 读完）里剥掉长度前缀。
 * 长度前缀宽度有 1/2/3 三种可能，用"声明的长度是否正好等于剩余字节"来判定，
 * 判不出来时退回 2 字节（1.7.10 小包实际就是 2 字节）。
 */
function stripVarShortPayload (buf) {
  for (const size of [2, 3, 1]) {
    if (buf.length < size) continue
    let value
    if (size === 1) value = buf[0]
    else if (size === 2) value = (buf[0] << 8) | buf[1]
    else value = ((buf[0] << 8) | buf[1]) & 0x7fff | (buf[2] << 15)
    if (value === buf.length - size) return buf.subarray(size)
  }
  return buf.subarray(Math.min(2, buf.length))
}

module.exports = {
  readVarInt,
  writeVarInt,
  readString,
  writeString,
  splitChannels,
  joinChannels,
  readVarShort,
  stripVarShortPayload
}
