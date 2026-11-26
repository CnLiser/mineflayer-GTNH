'use strict'

/*
 * 1.7.10 的 feature 表。
 *
 * minecraft-data 的 features.json 里最早的版本区间是 1.8，对 1.7.10 一律返回 false，
 * mineflayer 里大量 supportFeature(...) 分支会因此全部走错。这张表以 1.8.9 的取值为基线
 * （1.7 与 1.8 的线格式高度相似），再把 1.7 与 1.8 确有差异的项覆盖掉，覆盖项见下方注释。
 */

// 1.8.9 为 true、但 1.7.10 不成立
const OVERRIDES_FALSE = [
  'blockPlaceHasIntCursor', // 1.7 的 cursorX/Y/Z 是 i8，1.8 才变成 i32
  'indexesVillagerRecipes', // 1.7 的交易包没有 recipe 索引
  'booksUseStoredEnchantments', // 成书附魔是 1.8 的变动
  'clientUpdateBookIdWhenSign', // 1.7 没有书与笔
  'editBookIsPluginChannel', // 同上，完全没有编辑书的包
  'titleUsesLegacyPackets' // 1.7.10 没有 title/subtitle/times 系列包
]

const FEATURES_1_7_10 = {
  'acknowledgePlayerDigging': false,
  'actionIdUsed': true,
  'allEntityEquipmentInOne': false,
  'anvilNameLengthIsFifty': false,
  'armAnimationBeforeUse': true,
  'attachStackEntity': true,
  'attackUsesOwnPacket': false,
  'attributeSnakeCase': false,
  'biomesSentSeparately': false,
  'blockMetadata': true,
  'blockPlaceHasHandAndFloatCursor': false,
  'blockPlaceHasHandAndIntCursor': false,
  'blockPlaceHasHeldItem': true,
  'blockPlaceHasInsideBlock': false,
  'blockPlaceHasIntCursor': false,
  'blockSchemeIsFlat': false,
  'blockStateId': false,
  'booksUseStoredEnchantments': false,
  'chainedChatWithHashing': false,
  'chatCommandsQueuedToMainThread': false,
  'chatGlobalIndexAndChecksum': false,
  'chatPacketsUseNbtComponents': false,
  'chatTypeIsHolder': false,
  'clientUpdateBookIdWhenSign': false,
  'clientboundChatHasSender': false,
  'clientsideChatFormatting': false,
  'consolidatedEntitySpawnPacket': false,
  'creativeSleepNearMobs': false,
  'customChannelIdentifier': false,
  'customChannelMCPrefixed': true,
  'difficultySentSeparately': false,
  'dimensionDataInCodec': false,
  'dimensionDataIsAvailable': false,
  'dimensionIsAString': false,
  'dimensionIsAWorld': false,
  'dimensionIsAnInt': true,
  'doesntHaveChestType': true,
  'doesntHaveOffHandSlot': true,
  'doublePosition': false,
  'editBookIsPluginChannel': false,
  'editBookPacketUsesNbt': false,
  'effectAreMinecraftPrefixed': true,
  'effectAreNotPrefixed': false,
  'effectNamesMatchRegistryName': false,
  'enchantmentsComponentIsFlat': false,
  'enderCrystalNameEndsInErNoCaps': false,
  'enderCrystalNameNoCapsWithUnderscore': false,
  'entityCamelCase': true,
  'entityMCPrefixed': false,
  'entityMetadataHasLong': false,
  'entityMetadataSentSeparately': false,
  'entityNameLowerCaseNoUnderscore': false,
  'entityNameUpperCaseNoUnderscore': true,
  'entitySnakeCase': false,
  'entityTeleportHasRelativeFlags': false,
  'entityVelocityIsLpVec3': false,
  'explicitMaxDurability': false,
  'fireworkMetadataOptVarInt8': false,
  'fireworkMetadataOptVarInt9': false,
  'fireworkMetadataVarInt7': false,
  'fireworkNamePlural': false,
  'fireworkNameSingular': false,
  'fishingBiteDelayMaxTicks': 900,
  'fishingBobberCorrectlyNamed': false,
  'fixedPointDelta': true,
  'fixedPointDelta128': false,
  'fixedPointPosition': true,
  'furnaceNbtUsesSnakeCase': false,
  'gameRuleUsesResourceLocation': false,
  'hasAttackCooldown': false,
  'hasBundlePacket': false,
  'hasConfigurationState': false,
  'hasDataCommand': false,
  'hasEditBookPacket': false,
  'hasElytraFlying': false,
  'hasExecuteCommand': false,
  'hasItemCommand': false,
  'indexesVillagerRecipes': false,
  'itemLoreIsAString': false,
  'itemSerializationAllowsPresent': false,
  'itemSerializationUsesBlockId': true,
  'itemSerializationWillOnlyUsePresent': false,
  'itemsAreAlsoBlocks': true,
  'itemsAreNotBlocks': false,
  'itemsWithComponents': false,
  'lessCharsInChat': true,
  'lightSentSeparately': false,
  'mcDataHasEntityMetadata': false,
  'metadataIxOfItem': 8,
  'mobSpawner': true,
  'multiBlockChangeHasTrustEdges': false,
  'multiSidedSigns': false,
  'multiTypeSigns': false,
  'nbtNameForEnchant': 'ench',
  'nbtOnMetadata': true,
  'netherUpdateInventoryWindows': false,
  'newLightingDataFormat': false,
  'newPlayerInputPacket': false,
  'noAckOnCreateSetSlotPacket': false,
  'noteBlockNameIsNoteBlock': false,
  'oneBlockForSeveralVariations': true,
  'playerInfoActionIsBitfield': false,
  'playsoundUsesResourceLocation': false,
  'positionPacketHasBitflags': false,
  'positionUpdateSentEveryTick': true,
  'profileKeySignatureV2': false,
  'quickMoveClickSendsEmptyItem': false,
  'registryDataIsMandatory': false,
  'removedNamedSoundEffectPacket': false,
  'replaceItemSlotIsPrefixed': true,
  'resourcePackUsesHash': true,
  'resourcePackUsesUUID': false,
  'respawnIsActionId': false,
  'respawnIsPayload': true,
  'saveDurabilityAsDamage': false,
  'segmentedRegistryCodecData': false,
  'selectingTradeMovesItems': false,
  'sendStringifiedSignText': true,
  'sendsClientTickEndPacket': false,
  'sendsPlayerLoadedPacket': false,
  'seperateSignedChatCommandPacket': false,
  'setBlockUsesMetadataNumber': true,
  'setPassengerStackEntity': false,
  'setSlotAsTransaction': false,
  'shieldSlot': false,
  'signatureEncryption': false,
  'signedChat': false,
  'sneakUsesEntityAction': true,
  'spawnEggsHaveSpawnedEntityInName': false,
  'spawnEggsUseEntityTagInNbt': false,
  'spawnEggsUseInternalIdInNbt': true,
  'spawnPositionIsGlobal': false,
  'spawnRespawnWorldDataField': false,
  'spawner': false,
  'stateIdUsed': false,
  'tabCompleteHasAToolTip': false,
  'tabCompleteHasNoToolTip': true,
  'tallWorld': false,
  'teamUsesChatComponents': false,
  'teamUsesScoreboard': true,
  'teleportUsesOwnPacket': false,
  'teleportUsesPositionPacket': true,
  'theFlattening': false,
  'theShulkerBoxes': false,
  'titleUsesLegacyPackets': false,
  'titleUsesNewPackets': false,
  'transactionPacketExists': true,
  'typeOfValueForEnchantLevel': 'short',
  'unifiedPlayerAndEntitySpawnPacket': false,
  'unloadChunkByEmptyChunk': true,
  'unloadChunkDirect': false,
  'updateViewPosition': false,
  'updatedParticlesPacket': false,
  'useChatSessions': false,
  'useEntityHasLocation': false,
  'useItemWithBlockPlace': true,
  'useItemWithOwnPacket': false,
  'useMCItemName': true,
  'useMCTrList': true,
  'useMCTrSel': true,
  'usesAdvCdm': true,
  'usesAdvCmd': false,
  'usesBlockStates': false,
  'usesLoginPacket': false,
  'usesMultiblock3DChunkCoords': false,
  'usesMultiblockSingleLong': false,
  'usesOldSoundPacket': true,
  'usesPalettedChunks': false,
  'usetraderlist': false,
  'village&pillageInventoryWindows': false,
  'whereDurabilityIsSerialized': 'metadata',
}

/*
 * 线格式是原版 1.7.10，但 GTNH 的 mod 会改掉一部分「能力」：
 *  - backhand-1.8.18.jar 加了副手槽，玩家窗口是 46 格（实测 window_items count=46）
 * 所以 bot 默认用 GTNH_FEATURES，需要原版判定时用 supportsVanilla。
 */
const GTNH_OVERRIDES = {
  doesntHaveOffHandSlot: false
}

const GTNH_FEATURES = { ...FEATURES_1_7_10, ...GTNH_OVERRIDES }

function supportsVanilla (feature) {
  return FEATURES_1_7_10[feature] === true
}

function supports (feature) {
  return GTNH_FEATURES[feature] === true
}

function featureValue (feature) {
  // GTNH 的覆盖也要反映在值查询里：mineflayer 的 bot.supportFeature 走这条
  // （它要拿到 'metadata' / 8 这类值，不能只走布尔版），漏掉覆盖的话
  // doesntHaveOffHandSlot 会被当成 true，副手槽和装备栏都按 5 项算。
  if (feature in GTNH_OVERRIDES) return GTNH_OVERRIDES[feature]
  return FEATURES_1_7_10[feature]
}

function listFeatures () {
  return Object.keys(FEATURES_1_7_10).sort()
}

module.exports = {
  FEATURES_1_7_10,
  GTNH_OVERRIDES,
  GTNH_FEATURES,
  OVERRIDES_FALSE,
  supports,
  supportsVanilla,
  featureValue,
  listFeatures
}
