# 接手手册（冷启动 10 分钟）

> 给「刚开的新会话」看：先读这一页，再按需读 `docs/MEMORY.md`（工程快照）、`docs/FINDINGS.md`（34 节实证）、`docs/API.md`（`bot.*` 速查）、`PLAN.md`（路线）。
> mod 记忆在仓库内 `docs/memory/`（22 张卡片，跟代码一起提交）；同一份内容的活副本在场景记忆目录
> `G:/deepseek/workbench/引擎数据/.dsh/场景记忆/我的世界/项目记忆/mineflayer-GTNH.md`（只有 DSH 环境能读）。

---

## 0. 一句话现状

能连 **GTNH 2.9.0（MC 1.7.10）** 的 mineflayer fork：连服 → 区块/世界 → 物理 → 挖/放/攻击/用物品/吃/丢弃 → 箱子/工作台/熔炉/GT 机器 GUI → 合成/熔炉 → 配方数据（矿辞 + 原版 + GT 175689 + 17 mod 8906 + TiC 静态表 + 实体 148）→ **GT 压模机全链路**（放机器 → 太阳能供电 → 投料 → 电压校验 → 取件）。
**251 个测试全过**，13 个冒烟脚本（12 联机 + 1 离线）。

## 1. 十分钟自检（照抄）

```bash
cd G:/java/minecraft/mineflayer-GTNH

npm test                                   # 期望 4 个 workspace 全 fail 0，共 251 个

# 本地 GTNH 服务端是否在跑（不在就启动，见 §5）
node packages/protocol-fml/tools/ping.js 127.0.0.1 54615   # 期望 GT:New Horizons 2.9.0 / 296 mods

# 离线冒烟（不需要服务端，最快确认数据链路）
npm --workspace mineflayer-fork run recipes-smoke

# 联机冒烟（需要服务端 + 游戏内没人在同一位置）
npm --workspace mineflayer-fork run fork-smoke

# 机器冒烟（会自己搭场景：tp 拉区块 → 铺石头地面 → 放置机器 → 打开 GUI）
node packages/mineflayer-fork/tools/mui-smoke.js 127.0.0.1 54615 --auto
node packages/mineflayer-fork/tools/machine-smoke.js 127.0.0.1 54615 --auto
node packages/mineflayer-fork/tools/machine-item-smoke.js 127.0.0.1 54615 --auto
```

全绿说明环境和记忆都对得上，可以开工。

## 2. 现场状态（会变，随时以自己探测为准）

| 东西 | 位置 / 值 |
| --- | --- |
| 本地服 | `G:\mc\GTNH2.9.0-server`，端口 **54615**，`online-mode=false` |
| RCON | `25575` / 密码 `jbk5ovf0gqru2znmdhs4`（工具：`node packages/protocol-fml/tools/rcon.js "list"`） |
| 服务进程 | `javaw`（启动脚本 `startserver-java9.sh`，外圈 while 自动重启，冷启动 2–4 分钟） |
| 用户手放的进阶合金炉 | `(33, 78, 19)`，`gregtech:gt.blockmachines` meta=1，模板 `basicmachine.alloysmelter.tier.02`，41 槽 |
| bot 自建的冶炼炉 | 壳 x/z 40..44、y=80..83；控制器 `(42,81,40)`、储罐 `(43,81,40)`、排液口 `(41,81,40)`、水龙头 `(41,81,39)`、浇筑台 `(41,80,39)` |
| bot 名 | 冒烟脚本各自取名（`forkBot`/`machBot`/`extA`…），互不冲突即可 |
| 世界位置 | 出生点约 `(2.5, 77, -9.5)`；`spawn-protection=1`（半径 16 内挖不动） |

**重要**：这些世界状态是「上一次会话留下的」，可能被重建/拆除。**先探测再动手**（`bot.blockAt` / `bot.blockEntities`），不要假设还在。

## 3. 代码地图

```
packages/
├── protocol-fml/          # 地基：FML 握手 + 1.7.10 线格式补丁（GTNH_*_PACKETS）
│   ├── src/index.js       # createFmlClient / mergeCustomPackets / 所有 GTNH_*_PACKETS
│   ├── src/gtnh/chunkapi.js   # S21/S22/S23/S26 解码
│   └── src/gtnh/modularui.js  # ModularUI2 控件流解码
├── prismarine-chunk-1.7/  # 自己写的区块/世界（上游没有 1.7 实现）
├── gtnh-data/             # 数据：注册表 / 矿辞 / 配方 / TiC / 机器表 / 实体 / 挖掘工具表(harvest+gt-tools)
│   └── tools/jmx/         # Java agent 探针（见 §4）
├── mineflayer-fork/       # **主力**：vendored mineflayer 4.39 + lib/gtnh/* 补丁
│   ├── lib/loader.js      # 建连、注册表注入、各 attach* 挂载点
│   ├── lib/gtnh/{world,physics,physics-tick,blockshape,entities,items,actions,modularui,recipes,tconstruct,smeltery,gtmachine,chat,mods,reconnect,pathfinder,mining,harvest}.js
│   └── tools/*.js         # 13 个冒烟脚本（12 联机 + recipes-smoke 离线）
```

```
archive/
└── mineflayer-gtnh/       # **旧的手写 Bot**，已归档；只作历史参考，别再往里加东西
```

## 4. 三条常见扩展路径

**A. 发现某个包解析失败 / 线格式不对** → 在 `protocol-fml/src/index.js` 加 `GTNH_XXX_PACKETS`：
1. 抓真实帧（本机 `.probe/tcpproxy2.js --listen 54616 --target 54615 --out data/raw/x.jsonl`，用户连 54616 操作；
   `.probe/` 不入库，没有这个脚本就照 FINDINGS §14 的 nmp 代理思路自己写一个）；
2. 用 `javap -c` 读服务端 mixin / 类确认字段序；
3. 定义 `gtnh_xxx` 容器 + 字符串别名 `packet_xxx: 'gtnh_xxx'`（**必须用别名**，lodash.merge 会按下标合并数组）；
4. 加进 `mergeCustomPackets(...)`，写真实帧做 fixture 的测试。

**B. 加一台 GT 机器** → `lib/gtnh/gtmachine.js`（tier 表 / `canRun` / `findExtruderRecipes` / 窗口槽映射）+ `smeltery.js` 里 `readCastingBlock` 这类「读 TE → 判断状态」的写法。
槽位映射两套：**TiC 容器主背包在前，GT 容器快捷栏紧接机器槽**（`gtnWindowSlots`）。

**C. 加一个 mod 的配方** → 复用 agent 流程（§5）：`ProbeInv` 找字段 → 写 `DumpModsNN` → 跑 `build-mod-recipes.js` 归一化 → `src/mod-recipes.js` 查询 → 补测试 + 卡片。

## 5. Java agent 速查（导出内存数据用）

```bash
export JAVA_HOME=/g/java/jdk/jdk-21.0.7          # JDK 21 只用来编译/attach，服务端自己跑 Java 8/21 都行
PID=$(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='javaw.exe'\").ProcessId" | tr -d '\r')

cd packages/gtnh-data/tools/jmx                   # 仓库自带 Attach 器 AgentMain（不依赖 .probe/）
$JAVA_HOME/bin/javac -encoding UTF-8 -d build src/AgentMain.java src/DumpModsNN.java
printf 'Manifest-Version: 1.0\nAgent-Class: DumpModsNN\n\n' > mfNN.txt
$JAVA_HOME/bin/jar cfm modsNN.jar mfNN.txt -C build .

# attach：<pid> <agent jar 绝对路径> <agent 自己的 args>
java -cp build AgentMain $PID "G:/java/minecraft/mineflayer-GTNH/packages/gtnh-data/tools/jmx/modsNN.jar" "<outFile>"
```

四条铁律：**换类名、换 jar 名、绝对路径、outFile 写 `G:/...`**（写 `/tmp` 会静默落空）；
attach 失败只会报 `Agent JAR loaded but agent failed to initialize`，必须在 agent 的 `agentmain` 里 try/catch 把堆栈写到 `<outFile>.err`。

agent 的参数格式各版不同（`DumpModsNN` 是 `"<out>"` 或 `"<out>|<jar>|<regex>"`，`ProbeScan*` 是 `"<out>@@<jar1;jar2>@@<正则>"`）——
**先看那个类的 `run()` 怎么切 args**，别照抄别的探针。

## 6. 陷阱 Top 10（详细见 FINDINGS 对应节）

1. **物品 slot**：`id i32 + count i8 + damage i16 + nbt + flag u8`（flag 在最后，写包时 = count）——§10。
2. **玩家窗口 46 槽**（backhand 副手），槽位换算是所有点击 bug 的根源——§10。
3. **`transaction accepted=false` 不代表没执行**（GTNH 配方产出与 minecraft-data 不一致时会假拒绝）——§19。
4. **GT 机器 GUI 不走 `open_window`**，走 `modularui2` 通道；窗口由我们的「隐式窗口」兜底——§16。
5. **`modularui2` 通道必须先向 FML 注册**，否则服务器一帧都不发——§17。
6. **`block_place` 的 cursor 必须落在被点面上**（+x→cursorX=16 等），否则静默丢弃——§29。
7. **1.7 的 `/setblock` 没有 `replace`**；RCON `setblock` 只在区块已加载时生效——§29。
8. **RCON `tp` 不会给新位置发区块**：要「tp → 断开 → 重登」——§29 前的区块排查。
9. **GT 容器/TiC 容器右键**：带 `onBlockActivated` 的方块要 `sneak` 才走 `onItemUse`——§29。
10. **`/gamemode` 不通知已登录客户端**：生存判定要重连（或接受旧值）——§18。

## 7. 别读什么

- `.probe/` 有 **347 个脚本**，全是历史排查，命名混乱 —— 只按需 `grep`，不要通读；
- `node_modules/`、上游 `../mineflayer`、`../node-minecraft-protocol`（只读参考，未改）；
- **git 仓库已初始化**（2026-11-26，`main` 分支，411 个文件 / 12MB）：remote = `https://github.com/CnLiser/mineflayer-GTNH.git`。
  `node_modules/`、`/data/`、`/.probe/`、`packages/gtnh-data/data/raw/`、`packages/protocol-fml/data/raw/*.jsonl` 已忽略。
  流程：`git diff` 看改动 → 小步提交；**别把大 dump 或 `.probe` 提交进来**。

## 8. 交接检查表（改完东西再走）

- [ ] `npm test` 全绿，测试数写进 §〇
- [ ] 新增/修改的协议格式写进 `docs/FINDINGS.md` 新一节
- [ ] 新增 API 写进 `README.md` 与场景记忆卡片
- [ ] 场景记忆（`项目记忆/mineflayer-GTNH.md` 与卡片）同步，跑 `node 工具\场景记忆.mjs check --场景 我的世界`
