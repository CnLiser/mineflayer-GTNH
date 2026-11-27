# AGENTS.md

给在这个仓库里干活的 AI agent。人类读者看 [README.md](README.md)，冷启动看 [docs/HANDOVER.md](docs/HANDOVER.md)。

## 这是什么

GTNH（GregTech: New Horizons，MC 1.7.10 + Forge）的 mineflayer fork。
上游 mineflayer 在 1.7.10 上完全跑不起来，所以协议层是自己重建的：FML 握手、1.7 区块、
4 字节物品 id、ModularUI2 机器界面，再把 mineflayer 整份 vendor 进来打补丁。

**主力包是 `packages/mineflayer-fork/`**。`archive/mineflayer-gtnh/` 是旧的手写 bot，只读。

## 三条命令

```bash
npm install
npm test            # 294 个测试，4 个 workspace，全部离线，不需要服务端
npm --workspace mineflayer-fork run recipes-smoke   # 离线冒烟：数据链路
```

联机冒烟需要一个本地 GTNH 服务端（`127.0.0.1:54615`）：

```bash
node packages/protocol-fml/tools/ping.js 127.0.0.1 54615   # 先确认服务端在跑
npm --workspace mineflayer-fork run fork-smoke             # 登录→走路→挖掘→背包
npm run doctor                                             # 环境自检（缺什么一次说清）
```

## 铁律

1. **改完必须 `npm test` 全绿**（294 个）。测试都离线，不许新增「必须有服务端才能跑」的测试。
2. **新增协议格式 → `docs/FINDINGS.md` 加一节**（现象 / 字节级论证 / 怎么验证）。
   **新增 `bot.*` 方法 → 更新 `docs/API.md`**，否则下一个人找不到。
3. **数据文件不是手写的**：`packages/gtnh-data/data/**` 由 Java agent 从服务端内存导出再转换
   （见 HANDOVER §5）。`data/raw/` 被 gitignore，**不要提交大 dump**。
4. **别读 `.probe/`**（347 个历史排查脚本，命名混乱，按需 grep）。`archive/` 不要往里加东西。
5. **补丁都带 `GTNH-PATCH` 注释**，告诉读者这段和上游不一样、为什么。新增 agent 探针时
   **类名必须换**（JVM 缓存已加载的类），jar 路径必须绝对路径。

## 读文档顺序

| 顺序 | 文件 | 什么时候读 |
| --- | --- | --- |
| 1 | [docs/HANDOVER.md](docs/HANDOVER.md) | 接手第一页：自检 / 现场状态 / 代码地图 / 扩展路径 / 陷阱 Top10 |
| 2 | [docs/API.md](docs/API.md) | 写脚本前：`bot.*` 有哪些 GTNH 扩展方法 |
| 3 | [docs/MEMORY.md](docs/MEMORY.md) | 要改架构 / 找「这个坑以前踩过吗」 |
| 4 | `docs/memory/<mod>.md` | 处理具体 mod：id、操作路径、线格式、坑 |
| 5 | [docs/FINDINGS.md](docs/FINDINGS.md) | 协议细节、字节级证据、死路（别重复走） |
| 6 | [PLAN.md](PLAN.md) | 路线与里程碑 |

## 常见任务的入口

- **解析失败 / 线格式不对** → `packages/protocol-fml/src/index.js` 加 `GTNH_*_PACKETS`（HANDOVER §4A）
- **加一台 GT 机器** → `packages/mineflayer-fork/lib/gtnh/gtmachine.js`
- **加一个 mod 的配方** → `packages/gtnh-data/tools/jmx/src/DumpModsNN.java` → `tools/build-mod-recipes.js` → `src/mod-recipes.js`
- **物理 / 碰撞盒** → `lib/gtnh/physics-tick.js` + `lib/gtnh/blockshape.js`
- **实体名** → `lib/gtnh/entities.js`（数据来自 `gtnh-data/data/entities.json`）
- **GT 机器 GUI** → `lib/gtnh/modularui.js` + `protocol-fml/src/gtnh/modularui.js`

## 提交约定

小步提交，中文 commit message，类型前缀（`feat:` / `fix:` / `docs:` / `test:` / `refactor:`）。
改完文档记得同步数字（测试数、配方条数、脚本数）——**这些数字散在 README / HANDOVER / MEMORY 三处**，
不一致会误导下一个 agent。
