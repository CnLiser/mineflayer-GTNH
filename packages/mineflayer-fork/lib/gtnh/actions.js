// 1.7.10 的动作包差异，集中在这里，方便单测。

/**
 * GTNH-PATCH: 1.7.10 的 `arm_animation` 是 `{ entityId, animation }`，
 * 没有 `hand` 字段（`hand` 是 1.9+ 的概念）。缺 entityId 时 protodef 会写 0，
 * 客户端看到的是「实体 0 挥手臂」——等于没有动画。
 *
 * @returns {object} 直接交给 `client.write('arm_animation', params)` 的参数
 */
function armAnimationParams (bot, hand = 0, showHand = true) {
  const params = {}
  if (showHand) params.hand = hand
  if (bot.version === '1.7.10') {
    params.entityId = bot.entity?.id ?? 0
    params.animation = 0 // 0 = 挥主手
  }
  return params
}

/**
 * 1.7.10 用 `block_place` 表达「使用手上的物品」（没有独立的 use_item 包）：
 * 坐标 -1/-1/-1、面 255、光标 0。`position_ibi` 的 y 是 u8，所以 -1 要写成 255。
 */
function useItemPlaceParams (heldItem) {
  return {
    location: { x: -1, y: 255, z: -1 },
    direction: -1,
    heldItem,
    cursorX: 0,
    cursorY: 0,
    cursorZ: 0
  }
}

module.exports = { armAnimationParams, useItemPlaceParams }
