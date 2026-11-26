> 权威记忆在场景记忆目录：`G:/deepseek/workbench/引擎数据/.dsh/场景记忆/我的世界/项目记忆/mineflayer-GTNH.md`（枢纽），同目录 `mineflayer-GTNH/` 下是 16 张 mod 卡片。本文是工程快照镜像。
> **冷启动先读**：`docs/HANDOVER.md`（自检命令 / 现场状态 / 代码地图 / 扩展路径 / agent 速查 / 陷阱 Top10）。

# 项目记忆（交接状态）

> 这份文件是给「下一次接手的人 / 我自己重开上下文」看的现状快照：目标、环境、
> 架构、已经踩平的坑、还差什么。细节论证在 `docs/FINDINGS.md`，路线在 `PLAN.md`。
> 最后更新：2026-11-26。按 mod 拆成记忆网：每个 mod 一张卡片在 `docs/memory/`，本文是枢纽（索引 + 关联图 + 协议地基）。

---

## 0. 记忆网（按 mod 隔离）

> 每个 mod 一张卡片放在 `docs/memory/<mod>.md`，卡片里 `→ [[x]]` 是跨 mod 关联标记。
> **读法**：先查下面的索引 → 进卡片看「操作路径 / 线格式 / 已实现 API / 坑」→ 顺关联跳去耦合的 mod。
> 与具体 mod 无关的「协议地基」（FML 握手、位置包、登录包、nmp 库坑）在本文 §3/§4，所有卡片都依赖它。

### 索引

| mod | 卡片 | 一句话 | 主要关联 |
| --- | --- | --- | --- |
| GregTech | [gregtech](memory/gregtech.md) | 电力/机器/材料/配方；GUI 走 MUI2 | → [tconstruct](memory/tconstruct.md)（模具）、[modularui2](memory/modularui2.md) |
| Tinkers' Construct | [tconstruct](memory/tconstruct.md) | 工具制造 + 冶炼 + 浇筑 | → gregtech（TGregworks 部件）、[backhand](memory/backhand.md) |
| ModularUI2 | [modularui2](memory/modularui2.md) | GT 机器 GUI 框架（无 open_window） | → gregtech、tconstruct |
| ChunkAPI+EndlessIDs | [chunkapi-endlessids](memory/chunkapi-endlessids.md) | 区块/方块/物品 id 加宽 | → gregtech（clientmeta） |
| Backhand | [backhand](memory/backhand.md) | 副手槽 → 玩家窗口 46 槽 | → tconstruct、gregtech |
| Hodgepodge | [hodgepodge](memory/hodgepodge.md) | 登录包 +4 字节、stance 校验 | → chunkapi-endlessids |
| Thaumcraft | [thaumcraft](memory/thaumcraft.md) | 奥术/注魔/坩埚 2180 条 | — |
| Forestry | [forestry](memory/forestry.md) | 木工/离心 1280 条 | — |
| Railcraft | [railcraft](memory/railcraft.md) | 滚压/焦炉/高炉 346 条 | — |
| Botania | [botania](memory/botania.md) | 符文/魔力灌注 304 条 | — |
| Blood Magic | [bloodmagic](memory/bloodmagic.md) | 炼金/祭坛/绑定 162 条 | — |
| AE2 | [ae2](memory/ae2.md) | 压印 12 条，研磨 0 条 | → gregtech（替代） |
| EnderIO | [enderio](memory/enderio.md) | SAG 磨粉等 1689 条 | — |
| IC2 | [ic2](memory/ic2.md) | 机器配方几乎被清空（3 条） | → gregtech（替代） |
| Galacticraft | [galacticraft](memory/galacticraft.md) | 电路/压缩 14 条 | — |
| Witchery | [witchery](memory/witchery.md) | 蒸馏/坩埚/火盆/酿造 85 条 | — |

### 关联图（谁依赖谁）

```
protocol-fml（FML 握手 + 1.7.10 线格式补丁）
   │ 区块/物品/位置/登录
   ├── chunkapi-endlessids ──┬── gregtech（gregtech:clientmeta）
   │                         └── tconstruct（部件 id > 4095）
   ├── backhand（46 槽）─────┬── tconstruct（窗口槽换算）
   │                         └── gregtech（inventoryStart）
   ├── hodgepodge（登录 +4 字节 / stance）
   └── modularui2（GT 机器 GUI 通道）
          └── gregtech 机器 GUI ── 控件流（powerSwitch/能量/进度）
                 └── tconstruct 方块也用同一套隐式窗口兜底
```

### 跨 mod 的「影响面」（改一处要连带检查）

| 改动 | 波及 |
| --- | --- |
| `types.slot`（物品 i32 + 尾字节） | 背包、窗口、合成、熔炉、GT 机器投料、TiC 浇筑、MUI2 物品同步 |
| 玩家窗口 46 槽（backhand） | 所有窗口槽位换算、合成产物落点 |
| 玩家窗口主背包/快捷栏顺序 | **TiC 容器主背包在前，GT 容器快捷栏在前** —— 两种映射都要有 |
| `modularui2` 通道注册 | 不注册 → GT 机器 GUI 与控件流全无 |
| RCON `gamemode` | 1.7 不通知已登录客户端 → 生存/创造判定要重连或接受陈旧值 |

---

## 1. 目标

参照 mineflayer / minecraft-protocol，做一个**能连 GTNH（GregTech: New Horizons 2.9.0，
MC 1.7.10 + Forge 10.13.4.1614）的 mineflayer**。用户原话（m00060）：

> 「需要参照 mineflayer，使用 minecraft-protocol 制作一款能够支持 GTNH 的 mineflayer，
> 先规划一下整个项目，GTNH 整合包我本机有，你需要用到的时候在提供给你」

结论：薄插件层撑不住（mineflayer 监听的 97 个包里 38 个 1.7 不存在），走 **vendored fork**。

## 2. 环境

| 项 | 值 |
| --- | --- |
| 工作区 | `G:\java\minecraft\mineflayer-GTNH`（git 仓库，`main`，remote `CnLiser/mineflayer-GTNH`；`data/`、`.probe/`、`node_modules`、raw dump 已忽略） |
| 上游源码 | `G:\java\minecraft\node-minecraft-protocol`（v1.68.0）、`G:\java\minecraft\mineflayer`（v4.39.0） |
| 整合包（客户端） | `G:\mc\PrismLauncher-Windows-MinGW-w64-Portable-10.0.5\instances\GT_New_Horizons_2.9.0_Java_17-26_bak` |
| 本地服务端 | `G:\mc\GTNH2.9.0-server`（`server-port=54615`、`online-mode=false`、`level-type=rwg`、`spawn-protection=1`） |
| RCON | `127.0.0.1:25575`，密码 `jbk5ovf0gqru2znmdhs4`（工具会自动从 server.properties 读） |
| 公网服 | `frp-shy.com:54615`，**现在是 online-mode**（离线登录被拒，只能拿它 ping mod 列表） |
| 运行时 | Node v24.21.0、Java 21（`JAVA_HOME=/g/java/jdk/jdk-21.0.7`，javap 用） |
| 模组规模 | 296（本地服）/ 297（公网服）mods；注册表 4258 方块 / 11343 物品 |

服务端启动脚本 `startserver-java9.sh`（外层 while true 自动重启，`javaw` 常驻）。
**注意**：`server.properties` 的 RCON 与端口都可能被改，工具都从文件读。

## 3. 架构

```
packages/
  protocol-fml/          FML 握手 + 1.7.10 协议补丁（核心，所有包依赖它）
  prismarine-chunk-1.7/  1.7.10 区块/世界（24 位 id + 16 位 meta，ChunkStore）
  gtnh-data/             注册表 id↔名字、语言文件、1.7.10 feature 表
  mineflayer-fork/       ★ 上游 mineflayer 4.39 整份复制 + GTNH 补丁（主力）
archive/
  mineflayer-gtnh/       旧的手写 bot 门面（M0–M4 的验证载体），已归档，只作历史参考
```

`protocol-fml` 是地基：它把「原版 1.7.10 协议」与「GTNH 实际线上格式」的差异都吸收掉，
再以 `gtnh_*` 事件重发。补丁表（都在 `packages/protocol-fml/src/index.js`）：

| 补丁 | 覆盖的东西 | 说明 |
| --- | --- | --- |
| `GTNH_CUSTOM_PACKETS` | S→C `custom_payload` 改成 restBuffer | 1.7 的 S→C 长度是 **varshort** 不是 i16 |
| `CHUNKAPI_PACKETS` | map_chunk / map_chunk_bulk / block_change / multi_block_change | ChunkAPI 整包换格式，见 §4.2 |
| `GTNH_SLOT_PACKETS` | 根 `types.slot` | 物品 id **4 字节**，且尾部多 1 字节（§4.3） |
| `GTNH_MOVEMENT_PACKETS` | `packet_position` / `packet_position_look` | 字段顺序是 `x, y, stance, z`（§4.4） |
| `GTNH_LOGIN_PACKETS` | `packet_login` | 末尾多 4 字节 dimension id（§4.5） |
| `CHUNKAPI_PACKETS` 等 | `mergeCustomPackets(...)` | 合并根 `types`、`play.toClient`、`play.toServer` 三处 |

另外 `handshake.js` 默认注册 `modularui2` 通道（不注册 GT 机器 GUI 就没有数据，§4.6）。

`mineflayer-fork` 的 GTNH 补丁（都带 `GTNH-PATCH` 注释）：`lib/version.js`、
`lib/loader.js`（createFmlClient + 注册表灌入 + gtnh mui 挂载）、`lib/plugins/blocks.js`
（整份重写）、`lib/gtnh/{world,physics,physics-tick,modularui}.js`、`lib/plugins/physics.js`
（换替身 + stance）、`entities.js` / `inventory.js`（传 registry、光标补丁、隐式窗口）、
`game.js`（brand 通道）、`health.js`（spawn 兜底）。

## 4. 已经踩平的坑（速查：现象 → 真因 → 修法）

### 4.1 FML 握手
- 现象：连上就 `Mod rejections [FMLMod:gregtech{…}]` 被踢。
  → 真因：必须**原样回声**服务器的 mod 列表（297/296 条）。
  → 修法：`resolveMods()` 从 `data/raw/{local-,}server-modlist.json` 读；`ping.js` 默认只打印不落盘，要更新文件加 `--out`。
- 现象：`Chunk size is 500316 but only -23973 was read`。
  → 真因：1.7.10 S→C custom_payload 长度是 **varshort**。
  → 修法：只取 restBuffer，再 `stripVarShortPayload`（按「声明长度==剩余字节」判 1/2/3 字节）。

### 4.2 区块 / 方块（ChunkAPI + EndlessIDs）
- 真正改包的是 **ChunkAPI**（`chunkapi-1.7.10-0.8.4.jar`），EndlessIDs 只提供数据管理器。
- 容器格式：`int managerCount` 后每条 `int idLen + id(bytes) + int blobLen + blob`；
  **容器里的 int 是小端，manager blob 里的 int 是大端**（`ByteBuffer.slice()` 会重置成 BE）。
- 关键 manager：`endlessids:blockid` / `endlessids:metadata` / `endlessids:biome` /
  `minecraft:blocklight` / `minecraft:skylight` / `gregtech:clientmeta`（方块包 0 字节）。
- S26 `map_chunk_bulk` = `short count; int[count] sizes; int deflated; bool sky; zlib; count×{x,z,mask}`。
- 踩过的坑：区块坐标被当成方块坐标（289 列压成 4 个键）；12 位原版 id 高位丢失；
  `decodeChunkData(Buffer.alloc(4), 0)` 不报错（count=0 正好读完）。
- 结果：289 列 / 1757 非空段，最大 blockId 11298（远超原版 4095）。

### 4.3 物品（slot）——最坑的一条

```
blockId   : i32                 // 空槽只有这 4 字节
itemCount : i8
itemDamage: i16
nbtData   : compressedNbt       // short 长度 + gzip；null = ff ff
gtnhFlag  : u8                  // 恒等于 count（x1→01, x2→02, x64→40），来源未定位
```

- 玩家窗口是 **46 槽**（不是 45）：`backhand-1.8.18.jar` 加了副手槽（45 号）。
- 布局：0 输出 / 1-4 合成 / 5-8 装备 / 9-35 背包 / 36-44 快捷栏 / 45 副手。
- `/give` 在本地服**是坏的**（打印 `Given …` 但物品不进背包，`clear` 说没有物品）；
  `set_creative_slot` 可用但 **count 恒被归一成 1**（damage 保留）。
  → 所以冒烟测试统一用「进服送的 questbook（id 6241）」。

### 4.4 位置包：字段反序 + 被踢
- 现象：服务器日志 `had an illegal stance: -1.6200000000000045`，随后
  `lost connection: …key='hodgepodge.disconnect.illegal_stance'`。
- 真因：minecraft-data 的 `packet_position_look` 定义为 `x, stance, y, z`，
  **真实线序是 `x, y(脚底), stance(眼睛=脚底+1.62), z`**。
- 修法：`GTNH_MOVEMENT_PACKETS` 定义正确顺序；fork 发送前 `withStance()` 补字段。
- 配套：速度单位是**格/tick**（不除 20 会跑到 86 格/秒被拉回）；
  重力/阻力要在移动**之后**结算（否则跳跃只有 1.06 格）；
  撞墙要二分 14 次贴面（否则悬空/抖动）；出生点常嵌在方块里要顶出来。

### 4.5 登录包多 4 字节
- 现象：约 1/3 会话卡住不 spawn，`Chunk size is 17 but only 13 was read`。
- 真因：Hodgepodge 的 `MixinS01PacketJoinGame_FixDimensionID` 在包尾追加 `writeInt(dimension)`。
- 修法：`GTNH_LOGIN_PACKETS` 用 restBuffer 接 `dimensionId`，溢出时还原到 `dimension`。

### 4.6 GT 机器 GUI = ModularUI2（不走 open_window）
- 现象：右键机器，服务器不回 `open_window`，日志无异常。
- 真因 1：**客户端必须向 FML 注册 `modularui2` 通道**，否则服务器一个字节都不发。
- 真因 2：GUI 由 MUI2 自己的 `OpenGuiPacket` 建立（`windowId` 与随后 `window_items` 一致），
  容器内容仍走原版 `window_items` / `set_slot`。
- 修法：fork 的 `lib/gtnh/modularui.js` 里 `attachModularUI(bot)`；
  窗口层在 `window_items` 落到未知 id 时按 `slotCount - 36` 推算玩家背包起点开窗。
- 控件流：`PacketSyncHandler` = `varint networkId + string panel + string key + bool action + buffer value`，
  值以 `varint tag` 开头（`SYNC_VALUE=0` / `SYNC_ITEM=0`），bool 1 字节、int varint、
  8 字节 BE 分两种：`auto_sync:*` 是 `DoubleSyncValue`（进度，空转 NaN）、能量类是 long、
  物品槽 `bool + ItemStack + bool + bool`。实测能解出 `powerSwitch` / `hasError` / `powerfail` /
  `ghostCircuitIndex` / `player:0` / `auto_sync:*`。
- MUI2 容器的 transaction **恒回 accepted=false**，但点击照常执行 → 不能当失败处理。
- MUI2 窗口里点**玩家槽**服务器完全不响应 → 取东西只能用 shift 点击。

### 4.7 nmp / 库层面的坑
- `lodash.merge` 合并 `customPackets` 时**数组按下标逐项合并** → 必须用新类型或字符串别名。
- `createProtocol` 的缓存 key **不含 customPackets** → 测试不能用「新序列化器」验证原顺序，
  要 `fs.readFileSync` 直接读 `minecraft-data/.../protocol.json`。
- `registry.supportFeature` 要返回值不是布尔（`typeOfValueForEnchantLevel='short'`）。
- `FmlHandshake.registry.blocks/items` 是 **Map**，不是普通对象。
- gtnh 注册表灌进 `bot.registry.blocks` 会**污染** `mcData.blocks`（同一个对象）→
  `GTNHWorld` 用构造时的 `knownBlockIds` 快照判断是否原版方块。
- protodef 的识别失败会刷整屏堆栈 → fork 传 `hideErrors: true` + 过滤 `partialReadError`。
- `.probe/tcpproxy*.js` 端口占用会静默写旧文件；`rcon()` 传字符串曾被按字符拆成几十条命令。

## 5. 里程碑

| 里程碑 | 状态 |
| --- | --- |
| M0 骨架（workspace / 规划 / 工具） | ✅ |
| M1 连上 GTNH（FML 握手 + 登录 + 区块流） | ✅ |
| M2 感知（区块 / 注册表 / 实体 / 背包 / feature 表） | ✅ |
| M3 动作（物理 / 走路 / 跳跃 / 挖掘 / 放置） | ✅ |
| M4 GTNH 特性（窗口层 / GT 机器 GUI / 控件流 / 合成 / 熔炉 / 矿辞·配方） | ✅ |
| 动作层（挖掘 / 攻击 / 使用 / 合成 / 熔炉 / 丢弃 / 吃） | ✅ |
| M4.5 vendored fork | 🚧 登录→生成→世界→物理→挖掘→背包→窗口→机器 GUI→动作层全通（生存挖掘/攻击/用物品已验） |

**测试：全仓 190 个**（gtnh-data 56 / prismarine-chunk-1.7 7 / protocol-fml 48 /
mineflayer-fork 79），`npm test` 一把过；旧包的 32 个测试随归档退出 workspace，
能力等价地搬进了 fork（physics-tick 13 / chat 6 / support-feature 3 / inventory 5 / window 6）。

## 6. 冒烟工具

```bash
# protocol-fml
node packages/protocol-fml/tools/ping.js 127.0.0.1 54615          # 看服务端 mod 列表（不落盘）
node packages/protocol-fml/tools/dump-registry.js 127.0.0.1 54615 # 存注册表
node packages/protocol-fml/tools/world-smoke.js 127.0.0.1 54615 --seconds 22
node packages/protocol-fml/tools/rcon.js "list"                   # RCON 单条命令

# mineflayer-fork（主力）
npm --workspace mineflayer-fork run fork-smoke            # 走路/挖掘/背包
npm --workspace mineflayer-fork run machine-smoke         # GT 机器 GUI（41 槽）
npm --workspace mineflayer-fork run machine-item-smoke    # 机器槽物品取出/放入
npm --workspace mineflayer-fork run mui-smoke             # 机器状态（控件流）
npm --workspace mineflayer-fork run action-smoke          # 生存挖掘 / 攻击 / 使用物品
npm --workspace mineflayer-fork run extruder-smoke        # GT 压模机：放电+太阳能+投料+电压校验+取件
npm --workspace mineflayer-fork run craft-smoke           # 工作台合成
npm --workspace mineflayer-fork run furnace-smoke         # 熔炉
npm --workspace mineflayer-fork run drop-eat-smoke        # 丢弃 / 吃
npm --workspace mineflayer-fork run window-smoke          # 箱子窗口（rcon setblock chest → 右键 → 读槽位）
npm --workspace mineflayer-fork run smeltery-smoke        # TiC 冶炼炉
npm --workspace mineflayer-fork run tool-mine-smoke       # 工具挖掘
npm --workspace mineflayer-fork run recipes-smoke         # 离线：配方数据链路
```

`machine-*` / `mui-*` 都针对用户在 `(33, 78, 19)` 放的那台**进阶合金炉**
（`gregtech:gt.blockmachines`、meta=1、模板 `basicmachine.alloysmelter.tier.02`、41 槽）。

## 7. 还差什么 / 下一步候选

1. **NEI 其它 handler**：矿辞 + 原版合成/熔炉 + GT 的 175689 条 RecipeMap + 十一个 mod 的 8206 条配方（+ Galacticraft 14 / Witchery 85：蒸馏·坩埚·纺车·火盆·酿造仪式 / TConstruct 浇筑台 1088·浇筑盆 16·工具组装 53）已导出；IC2 与 AE2 研磨机的 0 条是 GTNH 真的清空了（见 FINDINGS §24）；单例列表与探测方法见 §25；TConstruct 的熔炼温度/燃料/工具材料见 §27
   （`docs/FINDINGS.md` §21/§22/§23）。
2. ~~MUI2 未解部分~~：已解——`auto_sync:<panel>:<n>` 是 MUI2
   `WidgetTree.collectSyncValues` 给「widget 自带 value」自动注册的 key；合金炉的 `:0`
   就是进度条（`GTProgressWidget.value(new DoubleSyncValue(this::getAsDouble))`，
   取 `mProgresstime / mMaxProgresstime`，空转 0/0 = NaN，即 `fff8000000000000`）。
   `NaN != NaN` 让它空转时每 tick 都算「变了」，所以进度**不是**只在变化时推
   （实测约 21 条/秒）；真正按变化推的是能量这类整数。要一份全量快照就对同一方块
   再右键一次：服务端重发 `openGui` + 全部 key（不发 `reopenGui` 包）。
   `decodeSyncValue` 现在按 key 把 8 字节分成 double（auto_sync）与 long（能量），
   详见 FINDINGS §17.4.1。
3. ~~生存模式挖掘~~：已验（`action-smoke`：沙子 750ms→实测 1135ms）。
4. **物理细节**：半砖/台阶按整块算，一格坎必须跳（1.7 数据没有真实碰撞盒高度）。
5. ~~动作补齐~~：使用物品 / 攻击 / 合成 / 熔炉 / 丢弃 / 吃 均已验（`action-smoke` / `craft-smoke` / `furnace-smoke` / `drop-eat-smoke`）。
6. ~~fork 收尾~~：已完成——`loadServerMods` / `formatMessage`（+ `messageToJSON`）搬到
   `lib/gtnh/{mods,chat}.js`，4 个 tool 改 require fork 门面，旧包的窗口/背包/物理/聊天/feature
   测试在 fork 里重建（`test/helpers/offline-bot.js` 让 46 个插件离线可跑），包里内容已 `git mv` 到
   `archive/mineflayer-gtnh/`（不在 `packages/*` 内，脱离 workspace）。

## 8. 记忆里容易忘的小事

- 用户给过的两个场景指令：本机 GTNH 服务端「可以操作这个场景启动、停止服务」（m00663/m00694）。
- 抓真实客户端流量只能靠 **TCP 代理**（`.probe/tcpproxy2.js`，端口 54616/54617/54619），
  nmp 登录后重建 splitter，在客户端内部挂钩子抓不全。
- 客户端侧抓包样本：`data/raw/{local-capture,real-click,mui2-payloads,slot-capture}.jsonl`。
- 打补丁时注意 bash 反引号会被当命令替换（曾把 PLAN.md 里的名字吞成 `✅（）`）。
- Windows 上 `timeout` 是 Windows 的 timeout.exe，不要用它包 node 命令。
