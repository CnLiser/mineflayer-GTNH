# GT 单方块机器：从零到出产物

> 关联：[[gregtech]] [[modularui2]]

照着这份记忆走，就能让 bot 用一台「单方块机器」（GregTech 的 `gregtech:gt.blockmachines`）做出东西。
每一步都是在实机上验过的，坑也标了。

## 一句话流程

```
走到机器 2 格内 → openBlock → 认 panel → 往 slot 2 放料、slot 3 放模/电路
→ bot.muiSet(powerSwitch, true) → 看 auto_sync:<panel>:0 从 NaN 变成 0.x
→ 产物落 slot 4 → 点它、点背包空槽取件
```

## 1. 打开 GUI：≤2 格、中间是空气

`bot.openBlock(block)` 只在这三个条件同时满足时成功（否则 `windowOpen did not fire within timeout of 20000ms`）：

1. 眼到方块中心 **≤ 2 格**（`reach + 0.6` 以内更稳）
2. 中间**没有方块**（`bot.canSeeBlock` 为真）
3. 玩家**头顶两格是空气**（这一条最容易被忽略：机器上方有方块时，即使贴脸也打不开）

```js
// machinecraft.js 里的 approachForGui 就是干这个的：绕机器 8 方向 × dy∈{0,-1,1} 找一个能开窗的站位
const { approachForGui } = require('mineflayer-fork/lib/gtnh/machinecraft')
await approachForGui(bot, bot.blockAt(pos))   // 失败会返回 false
await bot.openBlock(bot.blockAt(pos))
```

**坑**：点过九宫格（剪线钳/扳手）之后立刻开窗会失败，把潜行状态刷一遍
（`setControlState('sneak', true)` → 300ms → `false` → 600ms）或者换个 bot 连接再开。

## 2. 槽位：0 存储 / 1 充放电 / 2 输入 / 3 特殊 / 4 起输出

这是 `MTEBasicMachine` 的窗口布局（`inventoryStart` 之前的那些槽），**不是**字节码里
`getInputSlot()` 等方法的返回值（那些是物品数组索引，相差 5）。

| 槽 | 用途 | 例子 |
| --- | --- | --- |
| 0 | 存储槽 | 放什么都行，机器不用它；**别把料放这里** |
| 1 | 充放电槽 | 电池 `metaitem.01:32518`、红石（`minecraft:redstone`） |
| **2** | **输入槽** | 铁锭 `metaitem.01:11019` |
| **3** | **特殊槽** | 压模机的模 `TConstruct:metalPattern:2`、电路板 |
| 4 起 | 输出槽 | 产物 `TGregworks:tGregToolPartPickaxeHead:1500` |

代码常量：`packages/mineflayer-fork/lib/gtnh/machinecraft.js` 的
```js
const MACHINE_SLOTS = { power: 1, input: 2, special: 3, out: 4, inputs: [2] }
```

## 3. 通电：发电机 + 导线 + 剪线钳

GTNH 里机器**默认没有电**，要三样东西：

1. **发电机**（太阳能 `basicgenerator.solarpanel.01`、蒸汽机等）
2. **导线**（`gregtech:gt.blockmachines`，方块 meta 8..11 是规格；物品 `3003:1240` 裸线、`3003:1246` 绝缘线）
3. **剪线钳**（`gregtech:gt.metatool.01`，damage **26**）把导线和机器、导线和发电机连起来

**导线不会自动连**——必须用剪线钳右键。连接是**面到面**的：导线的某一面 ↔ 相邻方块的某一面。

**判据**（最可靠）：开机器 GUI 看 `panelState['auto_sync:<panel>:0']`
- 键**不存在** → 机器没电
- 键存在、`kind:'double'`、`value:null`（= NaN）→ **有电、空转**（配方不对或没料）
- 键存在、`0 ≤ value ≤ 1` → **正在跑**

⚠️ 太阳能 `storedEU` 满电（`000000000004e200` = 320000）**不能**当判据：机器不耗电时它本来就是满的。

## 4. 扳手和剪线钳都是「九宫格」

对着方块 shift+右键（剪线钳是直接右键也可以），屏幕上会出现一个 3×3 的九宫格叠加层，
**右键某个格子**才是真正下指令。点**面中心**等于点**中心格**，**什么都不改**——
之前「调了没反应」全是这个原因。

```js
// power.js
const GRID = {
  left:   [2, 8],    right: [14, 8],
  up:     [8, 2],    down:  [8, 14],
  back:   [14, 14],  center:[8, 8]
}
// 用法：useOn(bot, pos, face, { sneak: true, cursor: GRID.left })
```

方向**以玩家视角为准**：面朝方块时，屏幕左边 = 玩家的左，屏幕上方 = 上。

三种操作：

| 工具 | 操作 | 效果 |
| --- | --- | --- |
| 扳手（`metatool.01:16`） | shift+右键机器，点九宫格左/右/上/下 | 把机器的**输出面**调到那一侧（默认 = 放置时面朝的方向） |
| 扳手 | shift+右键发电机，点九宫格 | 调**发电机的朝向**，朝向即电力输出方向 |
| **空手** | shift+右键机器 | 调机器**朝向**（东南西北） |
| 剪线钳（`metatool.01:26`） | 右键导线，点九宫格对应格 | 连接导线与相邻机器/导线 |

**规则**：机器的**输出面不能接电**（输出面是往外送东西的）。默认输出面朝玩家放置时的方向，
用扳手调过之后只能在上/下之间切。所以接线时不要挡住机器的接电面。

## 5. 放料与取件：clickWindow 的参数别写反

```js
clickWindow(slot, mouseButton, mode)
// 左键拿整叠： (slot, 0, 0)
// 右键放 1 个： (slot, 1, 0)     ← 放料就是这个
// shift 转移：  (slot, 0, 1)
```

**坑**：`(slot, 0, 1)` 是 shift 点击，在 MUI2 窗口上**静默无效**（不报错、物品不动）。
之前一直写错这个，导致「料永远放不进去」。

三步放料：
```js
await bot.clickWindow(src, 0, 0)     // 从背包拿起整叠
await sleep(300)
await bot.clickWindow(dest, 1, 0)    // 右键往目标槽放 1 个
await sleep(300)
await bot.clickWindow(src, 0, 0)     // 剩下的放回原槽
```

玩家背包在窗口里从 `w.inventoryStart` 开始，**快捷栏在最前面**（`inventoryStart + 0` 就是快捷栏第 0 格），
不是 `36 + inventoryStart`（那会越界）。

取件：点产物槽 → 点背包第一个空槽。

## 6. 开机

```js
const panel = bot.modularPanels()[0]          // 'basicmachine.extruder.tier.01'
bot.muiSet(panel, 'powerSwitch', true)        // 开机
bot.muiToggle(panel, 'powerSwitch')           // 取反
```

`powerSwitch` 在 `panelState` 里是 `powerSwitch:0`，但 `muiSet` 可以直接写短名。
改完**关窗再开**才能读到服务端的新值（服务端不会把改过的值推回来）。

## 7. 一条命令跑完整套

```js
const r = await bot.machineCraft({
  item: 'TGregworks:tGregToolPartPickaxeHead', meta: 1500,
  at: new Vec3(33, 78, 19),
  timeoutMs: 90000
})
// → { ok: true, crafted: 2, panel: 'basicmachine.extruder.tier.01', tried: [] }
```

它内部做的事：扫附近机器 → 找产出这个 item 的 GT 配方 → 校验电压（`canRun`）→
按 `MACHINE_SLOTS` 把模放 3、料放 2 → 开机 → 轮询输出槽 → 取件 → 关窗。
失败时 `tried` 里逐条写原因（含机器槽快照）。

## 8. 坑清单（踩过的）

- 机器 GUI 打不开：90% 是「头顶有方块」或「超过 2 格」，不是网络问题
- 料放进 slot 0：那是存储槽，机器不认
- `clickWindow(slot, 0, 1)`：shift 点击，在 MUI2 上静默无效
- 点九宫格面中心：等于中心格，什么都不改
- `storedEU` 满电 ≠ 没连上
- `prog: value null` + `kind double` = NaN = 有电空转；**键不存在**才是没电
- `creative.setInventorySlot` 只在创造模式有效，生存模式静默失败
- 机器的「朝向」和「输出面」是两回事：空手 shift+右键调朝向，扳手 shift+右键调输出面
