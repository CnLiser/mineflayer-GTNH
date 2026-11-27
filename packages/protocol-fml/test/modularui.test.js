'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const {
  parsePacket,
  decodeSyncValue,
  collectSync
} = require('../src/gtnh/modularui')

// 下面这些 hex 都是从本地服真实抓包（data/raw/mui2-payloads.jsonl）里抄的，
// 场景是打开一台 GT 合金炉（basicmachine.alloysmelter.tier.02）的 GUI。
const OPEN_GUI = '0301000c67726567746563683a6d746503214e13'
const SYNC_POWER = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e30320d706f7765725377697463683a3000020001'
const SYNC_CIRCUIT = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e30321367686f737443697263756974496e6465783a30000600ffffffff0f'
const SYNC_PLAYER = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e303208706c617965723a30000e000000001861010000ffff010100'
const SYNC_AUTOSYNC = '0b002162617369636d616368696e652e616c6c6f79736d656c7465722e746965722e30322d6175746f5f73796e633a62617369636d616368696e652e616c6c6f79736d656c7465722e746965722e30323a30000900fff8000000000000'

test('openGui: windowId / networkId / factory / blockPos', () => {
  const msg = parsePacket(Buffer.from(OPEN_GUI, 'hex'))
  assert.strictEqual(msg.id, 3)
  assert.strictEqual(msg.name, 'openGui')
  assert.strictEqual(msg.windowId, 1)
  assert.strictEqual(msg.networkId, 0)
  assert.strictEqual(msg.factory, 'gregtech:mte')
  assert.deepStrictEqual(msg.blockPos, { x: 33, y: 78, z: 19 })
})

test('syncHandler: 头部字段与布尔值', () => {
  const msg = parsePacket(Buffer.from(SYNC_POWER, 'hex'))
  assert.strictEqual(msg.name, 'syncHandler')
  assert.strictEqual(msg.networkId, 0)
  assert.strictEqual(msg.panel, 'basicmachine.alloysmelter.tier.02')
  assert.strictEqual(msg.key, 'powerSwitch:0')
  assert.strictEqual(msg.action, false)
  assert.strictEqual(msg.data.toString('hex'), '0001')
  assert.deepStrictEqual(decodeSyncValue(msg.key, msg.data), { tag: 0, kind: 'bool', value: true })
})

test('syncHandler: varint 负数（ghostCircuitIndex = -1）', () => {
  const msg = parsePacket(Buffer.from(SYNC_CIRCUIT, 'hex'))
  assert.strictEqual(msg.key, 'ghostCircuitIndex:0')
  assert.deepStrictEqual(decodeSyncValue(msg.key, msg.data), { tag: 0, kind: 'int', value: -1 })
})

test('syncHandler: 物品槽（questbook）', () => {
  const msg = parsePacket(Buffer.from(SYNC_PLAYER, 'hex'))
  assert.strictEqual(msg.key, 'player:0')
  const value = decodeSyncValue(msg.key, msg.data)
  assert.strictEqual(value.kind, 'item')
  assert.strictEqual(value.value.readOnly, false)
  assert.strictEqual(value.value.enabled, true)
  assert.strictEqual(value.value.item.blockId, 6241)
  assert.strictEqual(value.value.item.itemCount, 1)
  assert.strictEqual(value.value.item.itemDamage, 0)
  assert.strictEqual(value.value.item.nbt, null)
  assert.strictEqual(value.value.item.extra, 1) // 实测等于 count
})

test('syncHandler: auto_sync 是 double（GT 进度条，空转 0/0 = NaN）', () => {
  const msg = parsePacket(Buffer.from(SYNC_AUTOSYNC, 'hex'))
  const value = decodeSyncValue(msg.key, msg.data)
  assert.strictEqual(value.tag, 0)
  assert.strictEqual(value.kind, 'double')
  assert.ok(Number.isNaN(value.value))
})

test('syncHandler: auto_sync 在跑机器上是 [0,1] 的 double', () => {
  const buf = Buffer.from('00' + '0000000000000000', 'hex') // tag 0 + double 0.0
  const value = decodeSyncValue('auto_sync:some.panel:0', buf)
  assert.deepStrictEqual(value, { tag: 0, kind: 'double', value: 0 })

  const half = Buffer.alloc(9)
  half.writeUInt8(0, 0)
  half.writeDoubleBE(0.5, 1)
  assert.deepStrictEqual(decodeSyncValue('auto_sync:some.panel:0', half), { tag: 0, kind: 'double', value: 0.5 })
})

test('syncHandler: 8 字节 long（能量）', () => {
  const buf = Buffer.alloc(9)
  buf.writeUInt8(0, 0)
  buf.writeBigInt64BE(8192n, 1)
  assert.deepStrictEqual(decodeSyncValue('energy:0', buf), { tag: 0, kind: 'long', value: 8192 })
})

test('collectSync: 按面板聚合同一批同步值', () => {
  const messages = [SYNC_POWER, SYNC_CIRCUIT, SYNC_PLAYER, SYNC_AUTOSYNC]
    .map(hex => parsePacket(Buffer.from(hex, 'hex')))
  const panels = collectSync(messages)
  const panel = panels['basicmachine.alloysmelter.tier.02']
  assert.ok(panel)
  assert.strictEqual(panel['powerSwitch:0'].value, true)
  assert.strictEqual(panel['ghostCircuitIndex:0'].value, -1)
  assert.strictEqual(panel['player:0'].value.item.blockId, 6241)
})

test('未知包 id 不抛错', () => {
  const msg = parsePacket(Buffer.from('02aabb', 'hex'))
  assert.strictEqual(msg.name, 'syncConfig')
  assert.strictEqual(msg.raw.toString('hex'), 'aabb')
})

test('截断的载荷要抛错而不是静默返回垃圾', () => {
  assert.throws(() => parsePacket(Buffer.from('0b00', 'hex')))
  assert.throws(() => parsePacket(Buffer.alloc(0)))
})

// --- 写路径（C→S 编码）。S→C 的 id 见上，C2S 的 id 由 registerBoth 先 S2C 后 C2S 推出。
const {
  encodeSyncHandler,
  encodeCloseGui,
  encodeWidgetAction,
  C2S_IDS
} = require('../src/gtnh/modularui')

test('C2S id 是 S2C id + 1', () => {
  assert.strictEqual(C2S_IDS.syncConfig, 2)
  assert.strictEqual(C2S_IDS.openGui, 4)
  assert.strictEqual(C2S_IDS.reopenGui, 6)
  assert.strictEqual(C2S_IDS.closeGui, 8)
  assert.strictEqual(C2S_IDS.closeAllGui, 10)
  assert.strictEqual(C2S_IDS.syncHandler, 12)
})

test('encodeSyncHandler 与抓到的 S→C 同款包逐字节一致（除 id）', () => {
  const out = encodeSyncHandler({
    networkId: 0,
    panel: 'basicmachine.alloysmelter.tier.02',
    key: 'powerSwitch:0',
    value: true,
    type: 'bool'
  })
  // 把 id 从 12 改成 11 就是真实抓包的 SYNC_POWER
  const asServer = Buffer.from(out)
  asServer[0] = 11
  assert.strictEqual(asServer.toString('hex'), SYNC_POWER)
})

test('encodeSyncHandler 编出来的包能被 parsePacket 读回去', () => {
  const out = encodeSyncHandler({ networkId: 3, panel: 'p', key: 'k', value: 42, type: 'int' })
  const msg = parsePacket(out)
  assert.strictEqual(msg.name, 'syncHandler')
  assert.strictEqual(msg.networkId, 3)
  assert.strictEqual(msg.panel, 'p')
  assert.strictEqual(msg.key, 'k')
  assert.strictEqual(msg.action, false)
})

test('encodeCloseGui / encodeWidgetAction 的头部', () => {
  const close = encodeCloseGui({ networkId: 2 })
  assert.strictEqual(close[0], C2S_IDS.closeGui)
  assert.strictEqual(close[1], 2)

  const act = encodeWidgetAction({ networkId: 1, panel: 'p', key: 'button:0', payload: Buffer.from([1, 2, 3]) })
  assert.strictEqual(act[0], C2S_IDS.syncHandler)
  assert.strictEqual(act[1], 1)
})
