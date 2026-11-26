// GTNH 物品工具的薄封装。
//
// GTNH-PATCH 的原因：1.7.10 线上 slot 的 NBT 之后还有一个 u8（本项目里叫
// gtnhFlag）。**读写两个方向都写 count**（x1→01、x2→02、x64→40）。
//
// 早期一度以为「写 window_click 时必须是 0」，那是被假拒绝误导了：
// 1.7 的 transaction 旗标在 clickedItem 比对不一致时会回 accepted=false，
// 而点击其实照常执行（详见 docs/FINDINGS.md 第十九节）。用 flag=0 反而会让
// 服务端槽里的物品与我们对不上。
//
// 附带发现：set_creative_slot 的尾字节也被服务端当成 count 用，
// 所以 `itemCount: 1, gtnhFlag: 64` 能造出 64 个（绕过「创意模式 count 恒为 1」）。
//
// 这里给 prismarine-item 的 toNotch 补一层：blockId >= 0 时补 gtnhFlag = itemCount。
// 所有插件都应该用 `require('../gtnh/items')(bot)` 拿 Item，而不是直接
// `require('prismarine-item')(bot.registry)`。

module.exports = function itemFactory (bot) {
  const Item = require('prismarine-item')(bot.registry)
  if (Item.__gtnhPatched) return Item

  const toNotch = Item.toNotch
  Item.toNotch = function (item, ...rest) {
    const notch = toNotch.call(this, item, ...rest)
    if (notch && typeof notch.blockId === 'number' && notch.blockId >= 0) {
      notch.gtnhFlag = notch.itemCount
    }
    return notch
  }
  Item.__gtnhPatched = true
  return Item
}
