# mineflayer-GTNH

**A mineflayer fork that actually works on GT: New Horizons (Minecraft 1.7.10 + Forge).**

[![test](https://github.com/CnLiser/mineflayer-GTNH/actions/workflows/test.yml/badge.svg)](https://github.com/CnLiser/mineflayer-GTNH/actions/workflows/test.yml)
[![tests](https://img.shields.io/badge/tests-213%20passing-brightgreen)](#测试)
[![node](https://img.shields.io/badge/node-%E2%89%A522-informational)](https://nodejs.org)
[![MC](https://img.shields.io/badge/minecraft-1.7.10-blue)](#)
[![GTNH](https://img.shields.io/badge/GTNH-2.9.0-orange)](#)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

> 上游 mineflayer 依赖大量 1.8+ 的协议、区块与方块状态实现，**1.7.10 上一个都跑不起来**。
> 本项目从协议层重建：FML 握手、ChunkAPI/EndlessIDs 的加宽 id、4 字节物品 id、ModularUI2 机器界面，
> 再把上游 mineflayer 整份 vendor 进来打补丁，所以 `bot.dig` / `bot.chat` / `bot.blockAt` 这些老 API 照旧能用。

---

## 能做什么

| 层 | 能力 | 状态 |
| --- | --- | --- |
| 连接 | FML 握手（`\0FML\0` + ModList 回声 + ModIdData 500KB 单包）、离线/在线服 | ✅ |
| 世界 | 区块 S21/S26（含 ChunkAPI manager 容器）、方块变更、24 位方块 id、光照、生物群系 | ✅ 289 列实测 |
| 实体 | 生成/移动/装备（type 是 **i16**）、玩家列表、聊天 JSON 组件渲染（GTNH 语言文件） | ✅ |
| 物理 | 自写 1.7 物理：重力/碰撞/台阶/跳跃/疾跑，`stance` 线序修正 | ✅ 4.32 格/秒 |
| 动作 | 挖（生存/创造）、放、攻击、用物品、丢弃、吃、合成、熔炉 | ✅ 8 个冒烟脚本 |
| 背包 | 46 槽（Backhand 副手）、4 字节物品 id + 尾字节、`window_click` 点击、光标同步 | ✅ |
| 容器 | 箱子/工作台/熔炉/任意 mod 容器窗口；**GT 机器 GUI 走 ModularUI2 隐式开窗** | ✅ |
| GT 机器 | 控件流解析（`powerSwitch`/`hasError`/`ghostCircuitIndex`…）、投料、取件、**压模机全链路** | ✅ |
| 数据 | 矿辞 56279、原版合成 10233、熔炉 9683、**GT RecipeMap 175689**、17 个 mod 8906、TiC 静态表、实体类型 148 | ✅ |

## 快速开始

```bash
git clone https://github.com/CnLiser/mineflayer-GTNH.git
cd mineflayer-GTNH
npm install
npm test                              # 213 个测试，4 个 workspace 全绿
```

需要一个 **GTNH 2.9.0 服务端**（`online-mode=false` 最省事）：

```bash
# 1) 拉服务器的 mod 列表（FML 握手要回声，少一个 mod 就会被踢）
node packages/protocol-fml/tools/ping.js 127.0.0.1 54615

# 2) 离线冒烟：不连服也能验数据链路
npm --workspace mineflayer-fork run recipes-smoke

# 3) 联机冒烟：登录 → 走路 → 挖掘 → 背包
npm --workspace mineflayer-fork run fork-smoke
```

最小可用脚本：

```js
const { createBot, loadServerMods } = require('mineflayer-fork')

const bot = createBot({
  host: '127.0.0.1', port: 54615, username: 'gtnh-bot',
  mods: loadServerMods(),          // 必须回声服务器 mod 列表
  hideErrors: true
})

bot.once('spawn', async () => {
  console.log('生成于', bot.entity.position)
  console.log('脚下是', bot.blockAt(bot.entity.position.offset(0, -1, 0)).name)

  bot.setControlState('forward', true)        // 走
  await bot.dig(bot.blockAt(bot.entity.position.offset(1, -1, 0)))
  bot.chat('hello from node')
})

// GT 机器：右键开窗后，服务器把面板控件值推下来
bot.on('modularSync', ({ panel, key, value }) => console.log(panel, key, value))
bot.panelState('basicmachine.alloysmelter.tier.02')
```

## 仓库结构

```
packages/
├── protocol-fml/           # 地基：FML 握手 + 1.7.10 线格式补丁（GTNH_*_PACKETS）
├── prismarine-chunk-1.7/   # 1.7 区块/世界（上游没有 1.7 实现，自己写）
├── gtnh-data/              # 注册表 / 矿辞 / 配方 / TiC / 机器表 + 数据构建脚本
└── mineflayer-fork/        # ★ 主力：vendored mineflayer 4.39 + lib/gtnh/* 补丁

archive/
└── mineflayer-gtnh/        # 旧的手写 Bot，已归档（只在 .probe/ 历史脚本里被引用）
```

`docs/` 四份文档，按接手顺序读：

| 文档 | 内容 |
| --- | --- |
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | **冷启动 10 分钟**：自检命令 / 现场状态 / 代码地图 / 扩展路径 / agent 速查 / 陷阱 Top10 |
| [`docs/MEMORY.md`](docs/MEMORY.md) | 工程快照：架构、补丁表、踩平的坑（现象→真因→修法）、里程碑、还差什么 |
| [`docs/FINDINGS.md`](docs/FINDINGS.md) | **34 节实证记录**：每个协议格式的字节级论证、对照实验、死路 |
| [`docs/memory/`](docs/memory/) | **22 张 mod 卡片**：每个 mod 的 id / 操作路径 / 线格式 / 已实现 API / 坑 |
| [`docs/API.md`](docs/API.md) | `bot.*` 扩展 API 速查（GTNH 加的那些方法） |
| [`PLAN.md`](PLAN.md) | 路线：分层 T0–T4、里程碑 M0–M5、风险 |

## 数据从哪来

运行期数据全部由**你自己那份 GTNH 整合包 + 本地服务端**导出，仓库里只放转换后的小体积文件：

```bash
# 注册表（id ↔ 名字，按服务器各存一份）
node packages/protocol-fml/tools/dump-registry.js 127.0.0.1 54615

# 矿辞 / 原版合成 / 熔炉（Java agent 读服务端内存，见 docs/HANDOVER.md §5）
npm --workspace gtnh-data run build-recipes
npm --workspace gtnh-data run build-mod-recipes    # 17 个 mod 的 8906 条
npm --workspace gtnh-data run build-tconstruct     # TiC 熔炼/材料/燃料
```

GT RecipeMap（175689 条）、TiC 静态表、非 GT mod 配方都以 JSON/JSONL(.gz) 形式内联，离线可查：

```js
bot.oresOf('ingotIron')                 // 矿辞 → 物品列表
bot.gtnhRecipesFor(265)                 // 原版合成
bot.gtRecipesForOutput(7639, 2610)      // GT 机器配方（按产物）
bot.tconstructMaterial('manyullyn')     // TiC 材料（耐久/速度/采掘等级）
bot.modRecipesFor(6079)                 // 非 GT mod 配方（Botania 符文等）
bot.modRecipesForSpecies('Arid')        // 蜜蜂/花突变（Binnie，产物或亲本命中）
```

## 已知限制

- **物理**：碰撞盒靠 `lib/gtnh/blockshape.js` 按注册名 + metadata 补（半砖 0.5 / 台阶 0.5 或上半 /
  栅栏·墙 1.5 / 地毯 1/16 / 雪层按层数）；没进表或形状特殊的方块（活板门、楼梯转角）仍按整块；
- **实体**：148 个实体 id（98 个来自 mod）由 `data/entities.json` 提供名字，但表里没有碰撞箱，
  mod 实体一律按 0.6×1.8 算；服务器用未 spawn 的 id 发 metadata 时 bot 会建一个空实体（上游行为，`name` 为空）；
- **MUI2**：进度条值在机器空转时是 `NaN`（0/0），按 `NaN != NaN` 每 tick 都推；要全量快照就对同一方块再右键一次；
- **真服（online-mode）**：协议上支持（`encryption_begin` 已接），但只用离线服验证过；
- **动作**：射箭 / 钓鱼未做。

## 许可

[MIT](LICENSE)。本项目是 [mineflayer](https://github.com/PrismarineJS/mineflayer)（MIT，Copyright © 2015 Andrew Kelley）的衍生作品，
`packages/mineflayer-fork/lib/**` 为其整份拷贝，补丁处均带 `GTNH-PATCH` 注释；依赖与数据来源见 [NOTICE](NOTICE)。

与 Mojang、Microsoft、GT: New Horizons 团队均无隶属关系，仅供学习与自动化研究使用。
