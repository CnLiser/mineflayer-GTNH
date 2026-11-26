# mineflayer-GTNH 项目规划

> 目标：用 Node.js + minecraft-protocol 造一个"能连上并能操作 GregTech: New Horizons"的 mineflayer。
> GTNH = Minecraft **1.7.10** + Forge + 300+ 模组，协议号 **5**。
> 本文件是规划稿，所有"实测"结论都来自本机 `G:\java\minecraft` 下的两个上游仓库 + npm 上的 prismarine 套件。
> **要接手的先读 [`docs/MEMORY.md`](docs/MEMORY.md)**：那一份是现状快照（环境、架构、补丁表、
> 已踩平的坑、里程碑、待办）；本文件里带 ⬜ 的旧条目可能已经被后者追上。

---

## 1. 侦察结论（先看清地形）

| 环节 | 现状 | 依据 |
|---|---|---|
| 协议数据 | ✅ minecraft-data 3.119.0 带 1.7.10（protocol 5） | 176 blocks / 303 items / 46 entities / 40 biomes；`minecraft-data('1.7')` 也会落到 1.7.10 |
| 包名归一化 | ✅ 1.7 与 1.8 共用同一套包名 | 1.7 play 有 65 个 S→C、24 个 C→S，名字与 1.8 一致（`map_chunk`、`entity_metadata`、`block_place`…） |
| 版本特征 `supportFeature` | ❌ 1.7.10 全部返回 `false` | `features.json` 的版本区间最早从 `1.8` 开始；mineflayer 全靠它分支 |
| 区块 | ❌ prismarine-chunk 1.41.0 无 1.7 实现 | `chunk('1.7.10')` → `No chunk implementation for pc 1.7` |
| 聊天 / 方块 / 物理 | ✅ prismarine-chat、prismarine-block 支持 1.7.10 | 实测可构造 |
| mineflayer 包依赖 | ⚠️ 97 个监听包名中 **38** 个 1.7 不存在；34 个写出包名中 **13** 个不存在 | 脚本比对 `bot._client.on/write`，其中 10 个是客户端伪事件（`connect`/`error`/`end`/`state`…），其余是真缺口 |
| FML 握手 | ❗必须自己实现，且 1.7 与 1.8+ 不同 | 地址要加 `\0FML\0`；握手在 Login Success 之后；1.7 用 **ModIdData** 而非 RegistryData；1.7 的 custom_payload 长度是 **i16**（<32KB），大注册表必然走 **FML\|MP** 分片 |

**结论**：路是通的，但"能连上"和"能干活"之间隔着三块硬骨头 —— FML 协议、1.7.10 的特征/数据补齐、区块与插件移植。任何声称"改两行就能跑 GTNH"的方案都不成立。

---

## 2. 范围分层（先定边界，别一次吞下 GTNH）

| 层级 | 能力 | 验收 |
|---|---|---|
| **T0 连通** | 完成 FML 握手进入游戏，收到 JoinGame / 聊天 / 玩家列表 | 控制台打印坐标、维度、服务器 ModList 条数 |
| **T1 感知（第一版目标）** | 区块、方块、实体、玩家、背包、聊天解析；GTNH 方块/物品名字正确 | 能 `bot.blockAt(pos)` 报出脚下方块名，能列出附近实体与背包 |
| **T2 基本动作** | 移动/看向（物理）、挖掘、放置、用物品、开箱子、背包点击、合成（原版） | 脚本：走到树前 → 挖 3×3 原木 → 进背包 |
| **T3 GTNH 特性** | GT 机器 GUI 与槽位、线缆/覆盖板、矿辞（ore dict）、GTNH 自定义维度、AE2/IC2 基础交互、NEI 式配方查询 | 脚本：打开一台 GT 机器并读出输入/输出槽 |
| **T4 应用层** | pathfinder 集成、任务脚本、长期运行 | 依赖 T2/T3 |

推荐节奏：**先把 T1 做扎实**（能读世界是一切自动化的前提），T2 紧跟着做，T3 按需逐模块推进。

---

## 3. 架构选型

### 3.1 为什么不是"薄插件层"

理论上可以 `createBot({ client })` 塞一个自己建的 nmp client + 自定义 registry，不 fork mineflayer。但实测数据说明行不通：

- mineflayer 有 125 处 `bot._client.on(...)`、46 个内部插件，全部按 `supportFeature` 分支；
- 1.7.10 缺 38 个包名，`blocks` / `entities` / `inventory` / `physics` 都要改分支；
- `lib/loader.js` 里 `require('prismarine-registry')(version)` 是数据注入的唯一口子，不 fork 就只能猴子补丁。

**结论：vendored fork**。把 mineflayer 4.39.0 的 `lib/` 复制进本项目，逐处打 `// GTNH-PATCH:` 标记，保留 `upstream` 远端用于将来 rebase。这样数据注入、包名适配、区块实现都能"正当地"改。

### 3.2 目录结构

```
mineflayer-GTNH/
├─ PLAN.md
├─ package.json                 # 私有 workspace 根
├─ packages/
│  ├─ gtnh-data/                # GTNH registry 覆盖层（minecraft-data 结构）
│  │  ├─ data/pc/1.7.10-gtnh/{blocks,items,entities,features,version}.json
│  │  ├─ index.js               # vanilla 1.7.10 + overlay 合并加载
│  │  └─ tools/
│  │     ├─ scan-modpack.js     # 扫 mods/*.jar：mcmod.info、assets/*/lang
│  │     ├─ dump-fml-ids.js     # 连服跑 FML 握手，导出 ModIdData（id↔name）
│  │     ├─ build-data.js       # 合成最终数据文件
│  │     └─ sidecar-mod/        # 可选：1.7.10 Forge 边车 mod，导出 hardness/碰撞箱
│  ├─ protocol-fml/             # FML 客户端插件（nmp 之上）
│  │  └─ src/{handshake,modid,multipart,ping,channels}.js
│  ├─ prismarine-chunk-1.7/     # 1.7.10 区块实现（fork prismarine-chunk，加 src/pc/1.7）
│  └─ mineflayer-fork/          # 主包：vendored mineflayer + 1.7.10 适配（旧手写包已归档到 archive/mineflayer-gtnh）
│     └─ lib/…
├─ test/
│  ├─ mock-fml-server.js        # 用 nmp createServer 模拟 Forge 握手（离线可跑）
│  ├─ fixtures/                 # 抓包回放
│  └─ live/                     # 真机 GTNH 冒烟
└─ docs/                        # 抓包记录、结论沉淀
```

技术约束：Node ≥ 22（本机 v24.21.0）、CommonJS（mineflayer 是 CJS）、`standard` 风格（沿用上游 lint）。

---

## 4. 数据层：GTNH registry 覆盖层

### 4.1 需要什么

1.7.10 的 minecraft-data 只有原版数据（176 方块 / 303 物品），GTNH 的模组方块动辄数千。要补齐到 mineflayer 能用的程度：

| 数据 | 用途 | 来源 |
|---|---|---|
| 方块/物品的 **数字 ID ↔ 注册名** | 解包、渲染、`blockAt` | **服务器 FML ModIdData**（权威、免猜） |
| 显示名（中/英） | 聊天、日志、产物识别 | 整合包 jar 里的 `assets/*/lang/*.lang` |
| 硬度、碰撞箱、材质、亮度、掉落 | 物理、寻路、挖掘耗时 | 原版：minecraft-data；模组：边车 mod 导出，缺失时用保守默认值 |
| 物品堆叠数、耐久 | 背包逻辑 | `items.json` |
| 实体类型 id/宽高 | 实体跟踪 | ModIdData(实体无) + 原版 + 模组 jar 扫描 |
| 维度 id | 切换世界（GTNH 有暮色、太空等多维度） | 服务器 JoinGame/Respawn 观察 + 配置 |
| 特征表（features） | mineflayer 分支 | **手写 1.7.10 版**（见 6.1） |

### 4.2 采集流水线（离线 + 一次性）

```
GTNH 整合包目录
   │
   ├─(1) scan-modpack.js ──→ modlist.json（modid/version）+ lang 词典
   │
   ├─(2) 连服 dump-fml-ids.js ──→ ids.json（block/item 名字 ↔ 数字 ID）
   │         └ 可重复：每个 GTNH 版本跑一次，结果入 data/
   │
   ├─(3) sidecar-mod（可选）──→ props.json（hardness/bbox/light/drops）
   │
   └─(4) build-data.js ──→ data/pc/1.7.10-gtnh/*.json
```

关键点：**ModIdData 是免猜的 ID 真相**。服务器在握手时会把整张 `name → id` 表推给客户端（block 前缀 `01`、item 前缀 `02`），我们收下来即可，不需要对着 jar 逆向数字。
代价是它只在连上服务器时可得，所以流水线是"先连一次、落盘、以后离线用"。

### 4.3 版本化

GTNH 每个大版本（2.5.x / 2.6.x / 2.7.x / 2.8.x）的 mod 列表与 ID 分配都可能变。数据目录按 GTNH 版本分：`data/pc/1.7.10-gtnh-<gtnhVersion>/`，`gtnh-data` 用配置项选版本，避免"连 A 服的数据去解析 B 服"。

---

## 5. 协议层：FML 客户端（1.7.10）

### 5.1 连接前

1. 服务器列表 ping 会带 `modinfo.modList` —— **先 ping 拿到服务器 mod 列表**（也用于判断是不是 Forge 服）。
2. 握手包 `set_protocol` 的 `serverHost` 末尾拼 `\0FML\0`（nmp 已有 `client.tagHost` / `options.fakeHost` 钩子，确认可用）。
3. `protocolVersion = 5`，`version = '1.7.10'`。

### 5.2 握手状态机（在 Login Success 之后、JoinGame 之前）

```
S→C  custom_payload(REGISTER: FML|HS, FML, FML|MP, FORGE)
S→C  FML|HS  ServerHello(0, protoVer)
C→S  REGISTER 同样的通道
C→S  FML|HS  ClientHello(1, protoVer)
C→S  FML|HS  ModList(2)            ← 回服务器自己的 mod 列表（回声策略）
S→C  FML|HS  ModList(2)            ← 校验点，不一致就被踢
C→S  FML|HS  HandshakeAck(-1, 2)   WAITINGSERVERDATA
S→C  FML|HS  ModIdData(3) × N      ← 1.7 专属：block/item 数字 ID 表
C→S  FML|HS  HandshakeAck(-1, 3)
S→C  FML|HS  HandshakeAck(-1, 2)
C→S  FML|HS  HandshakeAck(-1, 4)
S→C  FML|HS  HandshakeAck(-1, 3)
C→S  FML|HS  HandshakeAck(-1, 5)   COMPLETE
S→C  JoinGame(login)
```

要点：

1. **ModIdData 解析**：`Mapping length`(varint) → 每条 `name`(带 `\x01`=block / `\x02`=item 前缀) + `id`(varint)，随后 `blockSubstitutions` / `itemSubstitutions` 两段字符串数组。
2. **FML|MP 分片必须重组**：1.7 的 custom_payload 长度字段是 i16，注册表数据远超 32KB，Forge 一定切分（`FML|MP`：channel、parts、length，再按序号拼）。这是最容易踩的坑。
3. **ModList 回声**：把服务器 ping/ModList 里的列表原样发回去，等价于"客户端装了同样的 mod"。风险是某些 mod 有客户端专属校验，先按回声做，踢人再针对性处理。
4. **通道注册**：把服务器 REGISTER 里广播的通道都注册上（只是声明，不必实现），提高兼容性。
5. **不回应未知包**：GTNH 各种 mod 的 S→C 包默认丢弃并记录，出现踢人再逐个实现。

### 5.3 与 nmp 的结合方式

`protocol-fml` 作为 nmp 的 client 插件（`client.on('packet', ...)` + `client.write`），不侵入 nmp 源码；只有"握手地址加后缀"和"FML|MP 重组"需要在 client 侧早期挂钩。若 nmp 的 `tagHost` 钩子不够用，再 patch nmp（同样 patch 管理）。

---

## 6. mineflayer 1.7.10 移植清单

### 6.1 特征表（✅ 已完成）

`packages/gtnh-data/src/features.js`：以 1.8.9 取值为基线显式写出 **171** 项全部 feature（与
minecraft-data 的 `features.json` 键集合完全一致），再用 `OVERRIDES_FALSE` 修正 6 项 1.7 与 1.8
确有差异的判定。`bot.supports(name)` 走这张表；`supportsVanilla` 保留原版口径。

下面的表格是最初的初版判断，保留作对照：

| feature | 1.7.10 | 说明 |
|---|---|---|
| `blockMetadata` | **true** | 1.7 是 id+metadata，无全局状态表 |
| `dimensionIsAnInt` | **true** | |
| `fixedPointPosition` | **true** | 坐标是 1/32 定点 |
| `blockPlaceHasHeldItem` | **true** | `block_place` 带手持物品 |
| `transactionPacketExists` | **true** | `transaction` 存在，但语义是 1.8 前 |
| `doesntHaveOffHandSlot` | **true** | 无副手 |
| `itemsAreAlsoBlocks` | **true** | |
| `customChannelMCPrefixed` | **true** | `MC\|` 前缀 |
| `title*` / `boss_bar` / `playerlist_header` / `resource_pack` | **false** | 1.8+ 才有 |

这张表要逐条对着 mineflayer 的用法核对，是最"细活"但也最省事的环节——写对了，很多插件自动走对分支。

### 6.2 按模块的改动

| 模块 | 1.7.10 差异 | 处理 |
|---|---|---|
| `lib/loader.js` | 注册表来自 `prismarine-registry(version)` | 改为 `require('gtnh-data')` 加载合并数据 |
| `blocks.js` | 无 `update_light`、`chunk_batch_*`、`unload_chunk`；`map_chunk` 格式不同 | 加 1.7 分支；`map_chunk_bulk` 也要处理；依赖 6.3 的区块实现 |
| `entities.js` | `entity_destroy`（非 `destroy_entity`）、`update_attributes`、无 `damage_event`/`set_passengers`/`sync_entity_position` | 映射包名，缺失功能降级 |
| `inventory.js` / `window` | 1.7 无 `set_slot` 事务语义、无 `open_horse_window`、无 `set_cooldown` | 走 1.8 前分支；点击协议单独验证 |
| `digging.js` / `block_place` 系 | `block_dig`、`block_place` 字段不同（含 cursor） | 按 1.7 字段发送 |
| `chat.js` | 1.7 聊天是 JSON + 旧前缀解析 | 基本可用，校验 `prismarine-chat` 输出 |
| `tablist.js` | 只有 `player_info`，无 header/footer | 关闭 header/footer 功能 |
| `title.js` / `boss_bar.js` / `resource_pack.js` | 1.7 不存在 | 插件加载时跳过（`loadInternalPlugins` 白名单） |
| `sound.js` | 1.7 是字符串音效名（`named_sound_effect`），无数字 id | 加 1.7 分支 |
| `team.js` / `scoreboard.js` | 1.7 只有 `scoreboard_team`（名字不同） | 映射 |
| `physics.js` | 依赖方块碰撞箱质量 | 先跑通，再靠 4.1 的边车数据精修 |

### 6.3 区块（必须自己写）

prismarine-chunk 没有 1.7 实现。1.7.10 的 `S21PacketChunkData` 解压后结构：

```
int dataSize
每个 section(按 primaryBitMap):
  byte[4096] 方块 id 低 8 位
  nibble[2048] metadata
  （若 addBitMap）nibble[2048] id 高 4 位
每个 section: nibble[2048] 方块光
（若主世界）每个 section: nibble[2048] 天空光
（groundUp 时）byte[256] 生物群系
```

做法：fork prismarine-chunk，照 `src/pc/1.8/` 的 `chunk.js` / `section.js` 加一份 `src/pc/1.7/`，在 dispatch 表注册 `1.7`。工作量不大（~300 行），但要配 `map_chunk_bulk` 的 header 解析。

---

## 7. 里程碑

| 里程碑 | 内容 | 验收标准 | 估时 |
|---|---|---|---|
| **M0 骨架** ✅ | workspace、依赖、`mock-fml-server`、FML 状态机骨架 | 离线 mock 服上完成完整握手并打出 ModIdData 统计 | 2–3 天 |
| **M1 连上 GTNH** ✅ | 真机握手、ModList 回声、MP 重组、ModIdData 落盘 | 日志出现 JoinGame、坐标、维度、聊天；不因握手被踢 | 3–5 天 |
| **M2 感知** ✅ | 1.7 区块 ✅、注册表 ✅、实体 ✅、背包 ✅（46 槽 / 4 字节 id / window_click）、feat 表 ✅（171 项） | `bot.blockAt` 正确、附近实体与玩家可见、背包可读写 | 5–8 天 |
| **M3 动作** ✅ | bot 骨架 ✅（连接/世界/实体/玩家/聊天/背包点击）；physics ✅、dig ✅、place ✅、移动包线序 ✅ | 脚本跑通"走到树前→挖 3×3 原木→进背包" | 5–8 天 |
| **M4 GTNH 特性** | GT 机器 GUI、矿辞、自定义维度、配方 | 窗口层 ✅（箱子/工作台/熔炉实测）；GT 机器 GUI ✅（ModularUI2 隐式开窗，41 槽实测）；机器槽物品取出/放入 ✅（shift 点击 + 拿放点击，服务器真相校验）；控件流 ✅（ModularUI2 PacketSyncHandler，powerSwitch/hasError/电路/物品槽 实测）；合成 ✅；熔炉 ✅；丢弃 ✅；吃食物 ✅；矿辞/配方 ✅（agent 导出：矿辞 56279 / 合成 10233 / 熔炉 9683 / GT RecipeMap 175689 / 非 GT mod 配方 8906：Thaumcraft·Forestry·Railcraft·TConstruct·Botania·BloodMagic·IC2·AE2·EnderIO·Galacticraft·Witchery·Avaritia 135（9x9）·HarvestCraft 118（切菜板/锅/陷阱带权重）·WitchingGadgets 56（地狱高炉/纺车）·Et Futurum 9（锻造台）·GalaxySpace 32（火箭 T1..T8）·Binnie 350（培养器 160/蜜蜂突变 153/花突变 37）（含火盆/酿造仪式/浇筑台 1088·浇筑盆 16·工具组装 53））；多维度 ✅（单测）；TConstruct 静态数据 ✅ / 造镐造锤 ✅（Part Builder→Tool Station/Forge，锤 AoE 实测）（熔炼温度 956 / 燃料 4 / 工具材料 184 · 弓 180 · 箭 180） | 进行中 |
| **M4.5 vendored fork** 🚧 | `packages/mineflayer-fork`：上游 mineflayer 4.39 复制 + GTNH 补丁（loader/blocks/world/physics/entities/inventory/game/movement） | 登录→生成→`blockAt` ✅、聊天 ✅、走路 4.32 格/秒 ✅、挖掘 ✅（创造模式）、背包 46 槽 ✅；方块/物品名 ✅（FML 注册表，Map 修正）、GT 机器 GUI ✅（ModularUI2）、机器槽物品双向搬动 ✅（machine-item-smoke 冒烟）、生存挖掘 ✅、攻击 ✅、使用物品 ✅、合成 ✅、熔炉 ✅、丢弃 ✅、吃食物 ✅ | 进行中 |
| **M5 应用** | pathfinder、任务脚本 | 示例机器人长期运行 | 依赖前序 |

（估时按有经验的单人开发、测试环境随时可用计。）

---

## 8. 测试策略

1. **离线**：`mock-fml-server.js` 用 nmp `createServer('1.7.10')` 实现一个假 Forge 服（按规范发 ServerHello/ModList/ModIdData，含 MP 分片），CI 可跑。
2. **半真**：vanilla 1.7.10 + Forge 最小服（本机有 Java 8），验证握手实现不是"只对 mock 有效"。
3. **抓包回放**：写一个 nmp 代理，把真 GTNH 会话录成 fixture，回归时回放，避免每次都要开服。
4. **真机冒烟**：`test/live/` 只跑 T1/T2 的最小断言。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| ModList 校验/踢人 | 连不上 | 回声服务器列表；兜底：让服务器关 mod 校验，或用真实客户端 mod 列表 |
| GTNH 某 mod 在 join 时必须回包 | 卡在半途 | 抓包定位，逐个通道实现 |
| 1.7 metadata 模型 vs 新版 stateId | 大改点，波及 blocks/physics/inventory | 用 `blockMetadata` 特征集中收敛，避免散落判断 |
| 缺硬度/碰撞箱 | 物理不准、寻路穿模 | 边车 mod 导出；缺失用保守默认值并记录 |
| GTNH 版本漂移 | 数据错位 | 数据按版本分目录 |
| 1.7.10 服务端需要 Java 8 | 测试环境准备 | 本机已有 jdk1.8.0_151；GTNH 2.7+ 客户端用 Java 21 |
| 上游 mineflayer 演进 | rebase 成本 | 记录 `GTNH-PATCH` 清单，定期同步 |

---

## 10. 需要你确认/提供

1. **整合包位置与版本**：`mods/` 所在目录、GTNH 版本号（2.5.x / 2.6.x / 2.7.x / 2.8.x？）。
2. **测试服**：是单机开 LAN，还是有独立 GTNH 服务器？地址、online-mode、是否有 AuthMe/白名单。
3. **边车 mod**：能否往 `mods/` 丢一个我写的 jar（用于导出方块硬度/碰撞箱）？还是只能"纯客户端"？
4. **范围**：是否按"先 T1 感知、再 T2 动作"的节奏推进？T3 的 GT 机器交互是否本期就要。
