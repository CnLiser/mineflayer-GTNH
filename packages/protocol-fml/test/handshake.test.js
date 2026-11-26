'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { EventEmitter } = require('events')

const {
  FmlHandshake,
  PHASE,
  encodeServerHello,
  encodeModList,
  encodeModIdData,
  splitMultipart
} = require('../src/handshake')
const { writeString, readVarInt } = require('../src/codec')

class FakeClient extends EventEmitter {
  constructor () {
    super()
    this.written = []
  }

  write (name, data) {
    this.written.push({ name, ...data })
  }

  hsPackets () {
    return this.written.filter(p => p.channel === 'FML|HS').map(p => p.data)
  }
}

function ackPhases (client) {
  return client.hsPackets().filter(d => d[0] === 255).map(d => d[1])
}

test('codec: varint 往返', () => {
  for (const n of [0, 1, 127, 128, 255, 300, 4096, 32767, 2 ** 20]) {
    const buf = require('../src/codec').writeVarInt(n)
    const { value, size } = readVarInt(buf, 0)
    assert.strictEqual(value, n)
    assert.strictEqual(size, buf.length)
  }
})

test('codec: 字符串往返（含中文）', () => {
  const buf = writeString('tile.gregtech.machine 中文')
  const { readString } = require('../src/codec')
  const { value } = readString(buf, 0)
  assert.strictEqual(value, 'tile.gregtech.machine 中文')
})

test('codec: varshort 三种宽度（<128 / <32768 / 更大）', () => {
  const { readVarShort, stripVarShortPayload } = require('../src/codec')

  // 1 字节
  const one = Buffer.concat([Buffer.from([0x7b]), Buffer.alloc(0x7b, 0x41)])
  assert.strictEqual(stripVarShortPayload(one).length, 0x7b, '1 字节前缀')

  // 2 字节
  const two = Buffer.concat([Buffer.from([0x12, 0x34]), Buffer.alloc(0x1234, 0x41)])
  assert.deepStrictEqual(readVarShort(two, 0), { value: 0x1234, size: 2 })
  assert.strictEqual(stripVarShortPayload(two).length, 0x1234)

  // 3 字节：500316 = (500316 & 0x7fff) | 0x8000 作前两字节，第三字节 500316 >> 15
  const value = 500316
  const head = Buffer.from([((value & 0x7fff) >> 8) | 0x80, (value & 0x7fff) & 0xff, value >> 15])
  const three = Buffer.concat([head, Buffer.alloc(value, 0x41)])
  assert.deepStrictEqual(readVarShort(three, 0), { value, size: 3 })
  assert.strictEqual(stripVarShortPayload(three).length, value)
})

test('完整 1.7.10 握手：ServerHello → ModList → ModIdData(分片) → ACK 链', () => {
  const client = new FakeClient()
  const mods = [
    { modid: 'mcp', version: '9.05' },
    { modid: 'FML', version: '7.10.99.99' },
    { modid: 'Forge', version: '10.13.4.1614' }
  ]
  const fml = new FmlHandshake(client, { mods }).attach()

  const events = []
  fml.on('complete', e => events.push(e))

  // 1. 服务器先广播通道
  client.emit('custom_payload', { channel: 'REGISTER', data: Buffer.from('FML|HS\u0000FML\u0000FML|MP\u0000FORGE\u0000') })
  assert.deepStrictEqual(fml.channels.size >= 4, true)

  // 2. ServerHello(proto 2, dim 0)
  client.emit('custom_payload', { channel: 'FML|HS', data: encodeServerHello(2, 0) })

  const afterHello = client.hsPackets()
  assert.strictEqual(afterHello.length, 2, '应发 ClientHello + ModList')
  assert.deepStrictEqual([...afterHello[0]], [1, 2], 'ClientHello: disc 1, proto 2')
  assert.strictEqual(afterHello[1][0], 2, 'ModList: disc 2')
  const register = client.written.filter(p => p.channel === 'REGISTER')
  assert.strictEqual(register.length, 1)
  assert.ok(register[0].data.toString('utf8').includes('FML|HS'))

  // 3. 服务器 ModList
  client.emit('custom_payload', { channel: 'FML|HS', data: encodeModList(mods) })
  assert.deepStrictEqual(ackPhases(client), [PHASE.WAITING_SERVER_DATA])

  // 4. ModIdData：造 5000 条，强制走 FML|MP 分片
  const entries = []
  for (let i = 0; i < 3000; i++) entries.push({ type: 1, name: `gregtech:machine_${i}`, id: 1000 + i })
  for (let i = 0; i < 2000; i++) entries.push({ type: 2, name: `gregtech:item_${i}`, id: 2000 + i })
  const modIdData = encodeModIdData(entries, ['minecraft:stone'], ['minecraft:stick'])
  const packets = splitMultipart('FML|HS', modIdData, 30000)
  assert.ok(packets.length > 1, '应该被切成多片')

  for (const p of packets) client.emit('custom_payload', { channel: 'FML|MP', data: p })

  assert.strictEqual(fml.registry.blocks.size, 3000)
  assert.strictEqual(fml.registry.items.size, 2000)
  assert.deepStrictEqual(fml.registry.blockSubstitutions, ['minecraft:stone'])
  assert.deepStrictEqual(ackPhases(client), [PHASE.WAITING_SERVER_DATA, PHASE.WAITING_SERVER_COMPLETE])

  // 5. 服务器 ACK 链
  client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from([255, 2]) })
  assert.strictEqual(fml.phase, PHASE.PENDING_COMPLETE)
  client.emit('custom_payload', { channel: 'FML|HS', data: Buffer.from([255, 3]) })

  assert.strictEqual(fml.phase, PHASE.COMPLETE)
  assert.strictEqual(events.length, 1)
  assert.strictEqual(events[0].blocks, 3000)
  assert.deepStrictEqual(ackPhases(client), [
    PHASE.WAITING_SERVER_DATA,
    PHASE.WAITING_SERVER_COMPLETE,
    PHASE.PENDING_COMPLETE,
    PHASE.COMPLETE
  ])
})

test('ModList 校验：服务器多出的 mod 会被记为缺失', () => {
  const client = new FakeClient()
  const fml = new FmlHandshake(client, { mods: [{ modid: 'a', version: '1' }] }).attach()
  const checked = []
  fml.on('modListChecked', e => checked.push(e))

  client.emit('custom_payload', { channel: 'FML|HS', data: encodeServerHello(2, 0) })
  client.emit('custom_payload', {
    channel: 'FML|HS',
    data: encodeModList([{ modid: 'a', version: '1' }, { modid: 'b', version: '2' }])
  })

  assert.strictEqual(checked.length, 1)
  assert.deepStrictEqual(checked[0].missing, ['b@2'])
  assert.deepStrictEqual(checked[0].mismatched, [])
})
