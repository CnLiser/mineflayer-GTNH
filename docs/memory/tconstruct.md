# Tinkers' Construct（TiC）

> 工具制造 + 冶炼 + 浇筑；GT 的金属工具部件（TGregworks）也靠它的图案。

## 方块 meta
| 方块 | id | meta |
| --- | --- | --- |
| ToolStationBlock | **522** | 0=Tool Station、1..4=Part Builder（朝向）、5=Pattern Chest、10..13=Stencil Table、14=Casting Table |
| ToolForgeBlock | **523** | 0 = Tool Forge |
| CraftingStation | **524** | — |
| Smeltery | **564** | 0=控制器、1=排液口、2=焦黑砖 |
| LavaTank（焦黑储罐） | **566** | 0 |
| SearedBlock | **568** | 0=浇筑台、1=水龙头、2=浇筑盆 |

## 物品 / 图案
- 部件：`pickaxeHead 4503`、`toolRod 4501`、`binding 4506`、`hammerHead 4523`、`toughRod 4508`、`heavyPlate 4509`、`shovelHead 4504`。
- 图案：`woodPattern 4480`、`metalPattern 4526`、`blankPattern 4478`。
- **pattern meta**：0 blank、1 rod、**2 pickaxe**、3 shovel、4 axe、5 swordblade、**9 binding**、**14 largerod**、**16 largeplate**、**21 hammerhead**、25 arrowhead。
- 工具配方：`pickaxe = pickaxeHead + toolRod + binding`；`hammer = hammerHead + toughRod + heavyPlate + heavyPlate`（4 件，只能 Tool Forge）。
- 材料 id：Wood 0 / Stone 1 / Iron 2 / Flint 3 / Cactus 4 / Bone 5 / Obsidian 6 / Netherrack 7 / Slime 8 / Paper 9 / Cobalt 10…

## 操作路径（全部跑通）
- **部件台**：窗口 44 槽、`invStart=8`；**槽 0 = pattern，槽 2 = 材料，产物在 4/5**。产物**不实时同步**，必须关窗重开才读得到。金属部件不能在部件台削（要浇筑）。
- **工具站**：窗口 40 槽、`invStart=4`；**必须点顶面开窗**（`direction:1, cursorY:16`），槽 `1/2/3 = head/handle/accessory`、`0 = 输出`。
- **Tool Forge**：41 槽、`invStart=5`，槽 1..4 = 四个部件。
- **冶炼炉**：底面整片实心焦黑砖 + 每层外圈砖环 + 内部空气 + **控制器同层至少一个焦黑储罐**。
  - **控制器/水龙头朝向只能靠玩家放置写入**（TE 的 Direction，setblock 出来是 0 → 永不扫描结构）。
  - 控制器：朝炉内方向点，开窗槽数 = 内部方块数 + 36（**36 = 无效**）。
  - 水龙头：必须与排液口**同高相邻**、`Direction` 指向排液口，向下倒进脚下那格；放置时要 **sneak + 点排液口**（否则被 `onBlockActivated` 吃掉）。
- **熔炼**：每格只收 1 件（`getInventoryStackLimit()=1`），并行熔所有加热格 → 吞吐 = 内部格数；铁 144mb/锭，9 件约 90 秒。
- **浇筑台**（meta 0）：放铸模 + 点水龙头 → 冷却后点台取件（铁镐头 144mb/件）。
- **浇筑盆（meta 2）在本整合包被禁用**：能收物品铸模，但拒绝液体（用户确认）。

## 数据 / API
- 数据：`packages/gtnh-data/data/tconstruct/tconstruct.json`（材料 184 / 熔炼温度 956 / 燃料 4 / 弓 180 / 箭 180）；`data/recipes/mod-recipes.json` 里 tconstruct 2131 条（含浇筑 1104、工具组装 53）。
- `lib/gtnh/tconstruct.js`：`tconstructToolInfo(tool)`（从 `InfiTool` NBT 读 head/handle/harvestLevel/durability/speed）、`tconDigTime(block, tool)`。
- `lib/gtnh/smeltery.js`：`readSmeltery/smelteryAmount/readCastingBlock/readTank/insertIntoSmeltery/pourFaucet/placeFaucet`。
- 冒烟：`tool-mine-smoke`（锤 7754ms vs 镐 10755ms）、`smeltery-smoke`。

## 坑
- `SmelteryLogic` 的 `direction` 默认 0，`checkValidPlacement()` 的 switch 只处理 2/3/4/5。
- **Stone（material 1）造工具返回 null** —— TiC/GTNH 固有缺陷，不是我们的问题。
- 改炉体任何一格都会让结构失效并**清空已熔金属**。
- GT 挤出机的模具是 `metalPattern`（本 mod），不是 GT 的 `Shape_Extruder_*`。

## 关联
- → [[gregtech]]：金属工具部件走 GT 压模机（模具 = metalPattern），产出 TGregworks 部件。
- → [[backhand]]：玩家窗口 46 槽影响所有窗口槽位换算。
- → [[modularui2]]：TiC 方块也不发 open_window，靠同一套隐式窗口兜底。
