'use strict'

/*
 * 1.7.10 的 feature 表。
 *
 * minecraft-data 的 features.json 最早的版本区间是 1.8，所以 `supportFeature()` 对 1.7.10
 * 一律返回 false —— mineflayer 里几十个 `supportFeature(...)` 分支会全部走错。
 * 这张表以 1.8.9 的取值为基线（1.7 与 1.8 的线格式几乎一样），
 * 再把 1.7 与 1.8 确有差异的项覆盖掉（见 OVERRIDES_FALSE）。
 */

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  FEATURES_1_7_10,
  GTNH_FEATURES,
  GTNH_OVERRIDES,
  supports,
  supportsVanilla,
  featureValue,
  listFeatures,
  OVERRIDES_FALSE
} = require('../src/features')

const protocol = require('minecraft-data/minecraft-data/data/pc/1.7/protocol.json')
const featureFile = require('minecraft-data/minecraft-data/data/pc/common/features.json')

test('表里覆盖了 minecraft-data 的所有 feature', () => {
  const expected = featureFile.map((f) => f.name).sort()
  assert.deepEqual(listFeatures(), expected)
})

test('值是 boolean 或已知的枚举值', () => {
  const enums = {
    metadataIxOfItem: 8,
    fishingBiteDelayMaxTicks: 900,
    nbtNameForEnchant: 'ench',
    typeOfValueForEnchantLevel: 'short',
    whereDurabilityIsSerialized: 'metadata'
  }
  for (const [name, value] of Object.entries(FEATURES_1_7_10)) {
    if (name in enums) assert.equal(value, enums[name], name)
    else assert.equal(typeof value, 'boolean', `${name} 应该是 boolean`)
  }
})

test('1.7 是 metadata 模型，不是 block state', () => {
  assert.equal(featureValue('blockMetadata'), true)
  assert.equal(featureValue('usesBlockStates'), false)
  assert.equal(featureValue('stateIdUsed'), false)
  assert.equal(featureValue('blockStateId'), false)
  assert.equal(featureValue('setBlockUsesMetadataNumber'), true)
})

test('block_place 带 heldItem，光标是 i8（和协议定义对得上）', () => {
  const fields = protocol.play.toServer.types.packet_block_place[1]
  const byName = Object.fromEntries(fields.map((f) => [f.name, f.type]))
  assert.equal(byName.heldItem, 'slot')
  assert.deepEqual([byName.cursorX, byName.cursorY, byName.cursorZ], ['i8', 'i8', 'i8'])

  assert.equal(supports('blockPlaceHasHeldItem'), true)
  assert.equal(supports('blockPlaceHasIntCursor'), false)
  assert.equal(supports('blockPlaceHasHandAndIntCursor'), false)
  assert.equal(supports('blockPlaceHasHandAndFloatCursor'), false)
  assert.equal(supports('useItemWithBlockPlace'), true)
  assert.equal(supports('useItemWithOwnPacket'), false)
})

test('1.7.10 没有 title 系列包', () => {
  const hasTitle = Object.keys(protocol.play.toClient.types).some((n) => /^packet_title/.test(n))
  assert.equal(hasTitle, false)
  assert.equal(supports('titleUsesLegacyPackets'), false)
  assert.equal(supports('titleUsesNewPackets'), false)
})

test('有 transaction 包（窗口点击回执）', () => {
  assert.ok(protocol.play.toClient.types.packet_transaction)
  assert.equal(supports('transactionPacketExists'), true)
  assert.equal(supports('noAckOnCreateSetSlotPacket'), false)
})

test('位置相关：定点数、每 tick 上报、无 bitflags', () => {
  const move = protocol.play.toClient.types.packet_rel_entity_move[1]
  assert.deepEqual(move.map((f) => f.type), ['i32', 'i8', 'i8', 'i8'])

  assert.equal(supports('fixedPointPosition'), true)
  assert.equal(supports('fixedPointDelta'), true)
  assert.equal(supports('fixedPointDelta128'), false)
  assert.equal(supports('doublePosition'), false)
  assert.equal(supports('positionPacketHasBitflags'), false)
  assert.equal(supports('positionUpdateSentEveryTick'), true)
  assert.equal(supports('teleportUsesOwnPacket'), false)
  assert.equal(supports('teleportUsesPositionPacket'), true)
})

test('1.7 的世界高度还是 256，也没有 Elytra', () => {
  assert.equal(supports('tallWorld'), false)
  assert.equal(supports('hasElytraFlying'), false)
  assert.equal(supportsVanilla('doesntHaveOffHandSlot'), true) // GTNH 被 backhand 改掉，见下一个用例
  assert.equal(supports('doesntHaveOffHandSlot'), false)
  assert.equal(supports('doesntHaveChestType'), true)
})

test('物品 id 与方块 id 同一套编号，耐久在 metadata/damage 里', () => {
  assert.equal(supports('itemSerializationUsesBlockId'), true)
  assert.equal(supports('itemsAreAlsoBlocks'), true)
  assert.equal(supports('itemsAreNotBlocks'), false)
  assert.equal(supports('theFlattening'), false)
  assert.equal(featureValue('whereDurabilityIsSerialized'), 'metadata')
  assert.equal(featureValue('typeOfValueForEnchantLevel'), 'short')
})

test('被覆盖掉的 6 项确实是 false', () => {
  assert.equal(OVERRIDES_FALSE.length, 6)
  for (const name of OVERRIDES_FALSE) {
    assert.equal(featureValue(name), false, name)
    // 1.8.9 上这些是 true，否则覆盖就没意义了
    assert.equal(require('minecraft-data')('1.8.9').supportFeature(name), true, `${name} 在 1.8.9 应该是 true`)
  }
})

test('supports() 对未知 feature 返回 false，不抛异常', () => {
  assert.equal(supports('no_such_feature'), false)
  assert.equal(featureValue('no_such_feature'), undefined)
})

test('GTNH 覆盖：backhand 有副手槽，原版判定仍然是 true', () => {
  assert.equal(supportsVanilla('doesntHaveOffHandSlot'), true)
  assert.equal(supports('doesntHaveOffHandSlot'), false)
  assert.equal(GTNH_OVERRIDES.doesntHaveOffHandSlot, false)
  // 只有这一项被改，其它保持原版判定
  const changed = Object.keys(GTNH_FEATURES).filter((k) => GTNH_FEATURES[k] !== FEATURES_1_7_10[k])
  assert.deepEqual(changed, ['doesntHaveOffHandSlot'])
})
