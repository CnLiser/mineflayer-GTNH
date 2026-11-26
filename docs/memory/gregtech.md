# GregTech（GT5U/GTNH 核心）

> 电力、机器、材料、配方都归它；GT 机器的 GUI 走 ModularUI2（[[modularui2]]），不是原版 open_window。

## id / 方块
| 东西 | id |
| --- | --- |
| 机器方块 | `gregtech:gt.blockmachines` = **3003**（damage 区分种类） |
| 压模机 LV/MV/HV/EV/IV | 3003:**281/282/283/284/285** |
| GT 材料物品 | `gregtech:gt.metaitem.01` = **7639**（11000 + materialId，铁锭 = 11019） |
| 挤出模具 | 7639:32350(Plate) / 32351(Rod) / 32352(Bolt) / 32353(Ring) / 32354(Cell) / 32355(Ingot) |
| 变压器 | 3003:20（LV_ULV）… 27（UV_ZPM） |
| 能量仓 / 无线能量仓 | 3003:40..48 / 3003:206+ |
| 太阳能板 | 3003:2729(ULV) / **2733(LV)** / 2734(MV) … |

## 操作路径（已跑通）
1. **放机器**：手持机器物品点目标方块的面 —— `cursor` 必须落在被点面（+x→cursorX=16、−x→0、+z→cursorZ=16、−z→0、顶面 cursorY=16），站在同高 ≤4 格、脚下有实心地板。
2. **供电**：紧邻放一块 LV 太阳能板即可（实测 45 秒出 8 件）。**GT 线缆不会自动连接**，要用剪线钳右键对应面控制连接。
3. **开 GUI**：右键机器 → 走 MUI2，窗口 = 机器槽 + 36 玩家槽。
4. **槽序（BasicMachine）**：`0/1 = 输入+形状`、`2/3 = 第二组输入+形状`、`4 = 输出`。

## 线格式 / 容器
- GT 容器的窗口布局：**快捷栏紧接机器槽之后**，主背包在后。`inventoryStart=5` 时 → 快捷栏 0 = 窗口 5，主背包 9 = 窗口 14（TiC 是主背包在前，见 [[tconstruct]]）。
- GT 配方数据：`gt-recipes.jsonl.gz`（175689 条），字段 `{map, eu, dur, in, out, fin, fout}`。

## 已实现 API
- `lib/gtnh/gtmachine.js`：`canRun(recipe, tier)`（机器档位 ≥ 配方档位）、`recipeTier(eu)`、`machineInfo(meta)`、`findExtruderRecipes(gtRecipes, {output,input,shape})`、`gtnWindowSlots(window)`、`readMachineSlots(window, info)`。
- `lib/gtnh/modularui.js`：GUI / 控件流（见 [[modularui2]]）。
- `packages/gtnh-data/src/gt-recipes.js`：`forMap/forOutput/forInput/forFluid`。
- 冒烟：`npm run extruder-smoke`。

## 坑
- 机器 GUI **没有 open_window**，窗口是我们按 MUI2 兜底建的。
- MUI2 transaction **恒 accepted=false**，但点击照常执行 → 不能当失败。
- MUI2 窗口里点**玩家槽**服务器完全不响应 → 取东西用 shift 点击。
- **GT 机器淋雨会起火爆炸**。
- GTNH 清空了 IC2/AE2 的大部分机器配方（见 [[ic2]] / [[ae2]]），金属加工路线以 GT 机器为准。

## 关联
- → [[tconstruct]]：`TConstruct:metalPattern` 是挤出机模具；产出的 `TGregworks:*` 部件回 TiC 工具站组装。
- → [[modularui2]]：所有 GT 机器 GUI 与控件同步。
- → [[chunkapi-endlessids]]：`gregtech:clientmeta` 是区块 manager 之一。
