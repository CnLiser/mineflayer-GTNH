# 实机侦察记录（GTNH 2.9.0）

> 日期：2026-11-10　执行：AI
> 环境：`G:\mc\PrismLauncher-Windows-MinGW-w64-Portable-10.0.5\instances\GT_New_Horizons_2.9.0_Java_17-26_bak`
> 客户端：GTNH **2.9.0** / MC **1.7.10** / Forge **10.13.4.1614** / LWJGL3ify 3.0.42 / Java 25
> 服务器：`frp-shy.com:54615`（来自实例 `servers.dat`），offline-mode，地图 RWG，0/8 人

---

## 一、已经打通的部分

| 步骤 | 结果 |
|---|---|
| 状态 ping（1.7.10, protocol 5） | ✅ 返回 `GT:New Horizons 2.9.0`，`modinfo.modList` **297** 个 mod |
| 握手地址标记 `\0FML\0` | ✅ 服务器不再拒绝，直接 Login Success（离线模式，无加密） |
| FML 握手 ServerHello | ✅ `proto=2, dimension=0`（带 override dimension int） |
| ClientHello + ModList（回声 297） | ✅ 校验结果：服务器 297 / 缺失 **0** / 版本不符 **0** |
| ModIdData | ✅ 单包 **500305 字节**，解析出 **15601** 条（4258 方块 + 11343 物品） |
| ACK 链（2 → 3 → 4 → 5） | ✅ 全部走通 |
| JoinGame | ✅ `entityId=79558, gamemode=0, dimension=0, levelType=RWG` |

**结论：mineflayer-GTNH 的协议层已经能用纯 JS 连进 GTNH 2.9.0 服务器并拿到完整注册表。**

---

## 二、踩到并解决的两个协议坑（都写进了代码+测试）

1. **S→C `custom_payload` 的长度字段是 varshort，不是 i16**
   minecraft-data 的 1.7 协议里写的是 `buffer` + `i16`。GTNH 的注册表包 500KB，
   Forge 用 varshort 写长度（>32KB 时 3 字节，前两字节高位置 1），nmp 按 i16 读成
   **-23973**，于是整包错位，protodef 报 `Chunk size is 500316 but only -23973 was read`。
   → 解法：`customPackets` 把该包改成 `restBuffer`，拿到字节后自己按 varshort 剥前缀
   （`codec.stripVarShortPayload`，用"声明长度 == 剩余字节"判定 1/2/3 字节）。

2. **ModIdData 里方块/物品类型是字符串的首字符**（wiki 描述容易误解）
   实际字节：`03`(disc) `f1 79`(count=15601) `1f`(strLen) `02 'miscutils:...'`(首字符=2 表示物品)
   `c0 44`(id)。不是"先一个类型字节、再一个字符串"。
   → 解法：`parseModIdData` 按"字符串首字符 = 类型"解析。

> 另外：1.7.10 **没有**走 FML|MP 分片——整个 500KB 注册表就是一个包（外层 varint 长度）。
> MP 重组逻辑仍然实现并测过，留作后备。

---

## 三、还没解决（下一步的具体任务）

1. **JoinGame 包尾多 4 字节**：`Chunk size is 17 but only 13 was read`，
   说明服务器在 login 包里多发了 4 字节（可能是 RWG 或某个 coremod 追加的字段）。
   影响：坐标等字段本身读对了，但需要在 customPackets 里补字段，否则后续不能保证。

2. **EndlessIDs 改了方块变更包**（最硬的骨头）
   - 现象：大量 78 字节的帧，包 id 落在 `block_change(0x23)` / `multi_block_change(0x22)`
     上，但内容完全不是 vanilla 结构，里面有可读字符串 **"endlessids:blockitem"**。
   - 推测：EndlessIDs 把方块/物品 ID 扩展到 1.7.10 的 12/16 位限制之外，
     方块同步包改成了"注册名 + 数字 id"或 4 字节 id 的形式。
   - 需要：抓一个完整的 78 字节帧做结构分析，再对着 mod jar 反推字段。

3. **区块包**：`map_chunk` / `map_chunk_bulk` 大概率也被 RWG + EndlessIDs 改过，
   登录后没看到能正常解析的区块数据，等第 2 项解决后再验。

---

## 四、产物与代码

```
packages/gtnh-data/data/raw/gtnh-2.9.0/
  ├─ modlist.json     296 条（mcmod.info，client 侧）
  ├─ lang/en_US.json  73215 键（tile 11233 / item 13151）
  ├─ lang/zh_CN.json  49671 键
  └─ meta.json
packages/protocol-fml/
  ├─ src/{codec,handshake,index}.js
  ├─ tools/{ping,login-probe,join}.js
  ├─ test/handshake.test.js        5 个测试全过
  └─ data/raw/
      ├─ server-modlist.json       297 个（服务器权威列表，回声用）
      └─ fml-registry.json         15601 条 id↔注册名
```

复现命令：

```powershell
node packages/gtnh-data/tools/scan-modpack.js "G:\mc\...\GT_New_Horizons_2.9.0_Java_17-26_bak"
node packages/protocol-fml/tools/ping.js frp-shy.com 54615
node packages/protocol-fml/tools/join.js frp-shy.com 54615 --seconds 20
```

---

## 五、2026-11-23 复查：服务器转 online-mode（联机验证被堵）

| 项目 | 结果 |
|---|---|
| 状态 ping | ✅ 仍正常：`GT:New Horizons 2.9.0`、protocol 5、297 mods、0/8 人 |
| 登录 | ❌ 服务器已改为 **online-mode**：先 `encryption_begin`，离线登录被回 `Failed to verify username!` |
| capture.js 抓帧 | 只有 2 帧（RSA 公钥 172B + 断开原因 30B），`joined: false` |

→ 所有"连上真服再看"的验证方式暂时失效；此后只能做离线可验证的部分（格式解码 + 单测）。
PrismLauncher 里的 MSA 账号 access token 已过期（`exp` 早于当前时间约 18 小时），
要用真号登录得走 device-code 重新授权。

---

## 六、ChunkAPI：改区块/方块包的其实不是 EndlessIDs

关键发现：GTNH 的 `mods/` 里有 **`chunkapi-mc1.7.10-0.8.4.jar`**（FalsePattern 的 Chunk API）。
它用 Mixin `@Overwrite` 干掉了 S21/S22/S23/S26 的读写，EndlessIDs 只是往它里面
**注册数据管理器**（biome / blockid / metadata）。所以：

- 那批"78 字节帧"里的字符串就是 ChunkAPI 的 **manager id**（真实值见 6.2）；
- 别再去 EndlessIDs 的仓库找区块包 mixin，那里没有。

### 6.1 线的形状（**容器小端、manager blob 大端**）

这是最容易错的地方：`DataRegistryImpl.createSlice()` 用的是 `buffer.slice()`，
而 Java 的 `ByteBuffer.slice()` **不继承字节序，总是 BIG_ENDIAN**。于是：

- 容器（managerCount / idLen / blobLen）——小端；
- 每个 manager 自己的 blob 里的整数——大端。

**S21 map_chunk**（外层没变，变的是解压后的载荷）：

```
int x | int z | bool groundUp | short mask | int dataLength | int deflatedSize | zlib(dataLength 字节)
```

解压后（LITTLE_ENDIAN）：

```
int managerCount
repeat managerCount:
    int idLen; byte[idLen] id(UTF-8); int blobLen; byte[blobLen]
```

每个 manager 的 blob 由它自己定义。**未知 id 按 blobLen 跳过**（天然向前兼容）。

**S26 map_chunk_bulk**（GTNH 登录后发区块走的是它，不是 S21）：

```
short chunkCount
int[chunkCount] sizes         // 每列解压后字节数
int deflatedSize
bool skylight
byte[deflatedSize]            // 所有列的数据用同一个 zlib 流压缩
chunkCount × { int x; int z; unsigned short subChunkMask }
```

解压后按 `sizes` 依次切段，**每段就是 S21 的 manager 容器**（没有 x/z/mask 头）。

**S23 block_change**：

```
long packedPos                 // x 26 位 << 38 | y 12 位 << 26 | z 26 位
int  blockManagerCount
repeat: varint idLen; utf8 id; <该 manager 的定长数据>   // 无长度前缀，未知 manager 无法跳过
```

**S22 multi_block_change**：

```
int chunkX | int chunkZ | varint count
repeat count:
    short pos                  // (x&0xf)<<12 | (z&0xf)<<8 | (y&0xff)
    <与 S23 相同的 manager 容器>
```

### 6.2 已知 manager（以源码 javap/Java 为准）

| manager id | 区块 blob（S21/S26 每列） | 方块 blob（S23/S22） |
|---|---|---|
| `minecraft:blockid` | `short msbMask`；每个 mask 段 4096 字节 id 低 8 位，msbMask 该位=1 再 2048 半字节高位 | `short`（id & 0xFFF，2 字节） |
| `minecraft:metadata` | **无包头**；每个 mask 段 2048 半字节 | `byte`（& 0xF，1 字节） |
| `minecraft:blocklight` / `minecraft:skylight` | **无包头**；每个 mask 段 2048 半字节 | — |
| `minecraft:biome` | 256 字节 | — |
| `endlessids:blockid` | `int`（**大端**）mask，每段 2 bit；每段 B1(4096) + [B2Low(2048)] + [B2High(2048)] + [B3(4096)] | `int`（24 位 id，4 字节） |
| `endlessids:metadata` | `int`（**大端**）mask，每段 2 bit；每段 M1Low(2048) + [M1High(2048)] + [M2(4096)] | `short`（16 位，2 字节） |
| `endlessids:biome` | 512 字节（256 个大端 short） | — |
| `gregtech:clientmeta` | 每个已注册 tracker：`int count`（大端）+ count ×（`long pos` + `short meta`）；blob 用自身长度定界 | **一个字节都不写** |

要点：
- EndlessIDs 的 2 bit/段掩码的语义：block `0`=只有 B1、`1`=+B2Low、`2`=+B2High、`3`=+B3；
  meta `0`=只有 M1Low、`1`=+M1High、`2`/`3`=+M2。
- **哪几段有数据仍由包头的 section mask 决定**（`writeToBuffer` 里先判 `mask & (1<<i)`）。
- EndlessIDs 启动时 `disableDataManager("minecraft", "blockid"/"metadata"/"biome")`，
  所以 GTNH 的包上看到的是 `endlessids:*` 版本；本模块两套都实现了。
- `gregtech:clientmeta` 来自 `mods/gregtech-*.jar` 的 `gregtech/crossmod/chunkapi/ClientMetaManager`，
  `maxPacketSize = 655360`；正因为它在方块包里是空的，78 字节的 block_change 帧才能正好读完。

### 6.3 顺带确认的两件事

1. **1.7.10 的字符串是 varint 长度 + UTF-8**（不是 1.6 的 int+UTF-16）。
   证据：minecraft-data `data/pc/1.7/protocol.json` 里 `string` = `pstring` + `countType: varint`，
   而这套定义解析真实 GTNH 流量（FML 握手、通道名）一直是对的。
2. `custom_payload.data` 在官方数据里仍是 `i16` 长度——GTNH 必须覆盖成 varshort（已修）。

### 6.4 落地代码

`packages/protocol-fml/src/gtnh/chunkapi.js`：`decodeChunkPacket`（S21）、`decodeChunkData`
（只解 manager 容器，S26 复用）、`decodeMapChunkBulk`（S26）、`decodeBlockChange`、
`decodeMultiBlockChange`；段数组惰性分配（满配柱体 576KB，不能每块都摊开）；
未知 manager 在 S21/S26 里按长度跳过、在 S23/S22 里直接抛错（宁可报错也不要错位）。

`packages/protocol-fml/src/index.js`：`createFmlClient({ chunkapi: true })`（默认开）把四个包改成
`restBuffer`，解码后重新发事件：`gtnh_chunk` / `gtnh_chunk_bulk` / `gtnh_block_change` /
`gtnh_multi_block_change`，失败发 `gtnh_packet_error`（不吞异常也不断线）。

**踩坑（务必记住）**：nmp 合并 `customPackets` 用的是 `lodash.merge`，
**数组会按下标逐项合并**。所以把 `packet_map_chunk` 写成
`['container', [{name:'payload', type:'restBuffer'}]]` 只会替换第 0 个字段，
原版剩下 7 个字段仍留着，序列化时报
`TypeError [ERR_INVALID_ARG_TYPE]: SizeOf error for undefined`。
正确做法是**定义新类型 + 字符串别名**（merge 遇到字符串会整段替换）：

```js
types: {
  gtnh_gtnh_payload: ['container', [{ name: 'payload', type: 'restBuffer' }]],
  packet_map_chunk: 'gtnh_gtnh_payload',
  packet_map_chunk_bulk: 'gtnh_gtnh_payload',
  packet_block_change: 'gtnh_gtnh_payload',
  packet_multi_block_change: 'gtnh_gtnh_payload'
}
```

好处：事件名仍是原版四个名字，上层不用改名。

### 6.5 仍未解

1. **JoinGame 包尾多 4 字节**（`Chunk size is 17 but only 13 was read`）仍未定位。
2. 偶发 `packet_entity_metadata` / `packet_tile_entity_data` 解析失败
   （`Read error ... undefined` / `zlib decompress failed: unexpected end of file`），
   目前不影响区块链路，待单独查。
3. 1.7.10 的 `PluginMessage` 里 block manager id 长度用 varint 还是定长 int 仍未逐字节证实
   （现有帧里 id 都短于 128，两种解释一致）。

## 七、2026-11-23：本机 GTNH 服务端联调（真机跑通）

环境：`G:\mc\GTNH2.9.0-server`（GTNH 2.9.0 / Forge 10.13.4.1614），
`online-mode=false`，`server-ip=127.0.0.1`，**`server-port=54615`**（与公网服同端口，客户端配置不用改）。
启动脚本 `startserver-java9.sh`（外层 `while true` 自动重启），RCON 25575。

结果：

| 包 | 帧数 | 结论 |
|---|---|---|
| `map_chunk` (0x21) | 0 | GTNH 不发单块柱包 |
| `map_chunk_bulk` (0x26) | 58 | **289 列全部解码成功**，每列 6 个 manager |
| `block_change` (0x23) | 342 | 342/342 严格读完，零多余字节 |
| `multi_block_change` (0x22) | 173 | 173/173 同上 |

manager 命中：`endlessids:biome` / `endlessids:blockid` / `endlessids:metadata` /
`minecraft:blocklight` / `minecraft:skylight` / `gregtech:clientmeta`（各 289 列）。

数据合理性：最大 blockId **11298**（>4095，说明 24 位 id 真的解出来了）、
最大 metadata 30949、skylight 最大 15、blocklight 最大 15、基岩 id 7 恰好在 y=0 的 256 个方块。

工具（都在 `packages/protocol-fml/tools/`）：

- `capture.js`：把 splitter 的每一帧落盘 JSONL + 统计（12517 帧/30 秒，joined=true）；
- `join-smoke.js`：登录后统计 gtnh_* 事件、manager、最大 id/光照，出错则 exit 1；
- `packet-diag.js`：按包名统计解析失败（用 nmp 的 `client.on('error')` + `hideErrors: true`）。

结论：T1「读世界」的协议底座已经通了——区块、方块变更、光照、生物群系都能从真实
GTNH 服务器里解出来。下一步是把这些数据变成 mineflayer 能用的世界对象。

## 八、2026-11-23：世界层落地（区块 → 可查询的方块）

新增 `packages/prismarine-chunk-1.7`：上游 prismarine-chunk 没有 1.7 实现，
而 1.7.10 的方块数组是定长直存（没有 1.8+ 的调色板），所以单独做了一个最小实现。

- `ChunkSection`：`Uint32Array(4096)` 存 24 位 id、`Uint16Array(4096)` 存 16 位 metadata、
  光照按「一字节一个值」存（解码器本来就把半字节展开了）；光照与段数组都是惰性分配。
- `ChunkColumn`：16 段 + 256 个 16 位生物群系；`stateId = blockId * 65536 + metadata`
  （原版 `(id<<4)|meta` 装不下 GTNH 的 24/16 位）；`setFromDecoded()` 直接吃协议层的输出；
  `dump()/load()` 供世界缓存用。
- `ChunkStore`：按区块坐标存柱体，`getBlock({x,y,z})` **未加载返回 null**（不假装是空气），
  方块变更只更新已加载的柱体。

坐标坑：**线上包头里的 x/z 是区块坐标**（S21/S26 都是），解码器统一换算成方块坐标并在
`chunk.chunkX/chunkZ` 保留原值；`ChunkStore` 按区块坐标建键。不这么折算，289 列会被
除以 16 压成 4 个键。

注册表（`packages/gtnh-data`）：
- `ModRegistry`：服务器 FML ModIdData 的 id → 名字表，`tools/dump-registry.js` 按服务器各抓一份
  （公网服 297 mods / 本地服 296 mods，id 分配不同，**不能混用**）；
- `Lang`：整合包 jar 里的 en_US（73215 键）/ zh_CN（49671 键），中文本地化优先。

验收（`node tools/world-smoke.js 127.0.0.1 54615 --seconds 22`）：

```
柱体: 289（非空段 1757/1757）
bulk 帧 58 / 方块变更 54 / 批量方块 247
最大 blockId 11298 / metadata 30949 / skylight 15 / blocklight 15
脚下 (3, 73, 8): id=0 minecraft:air（空气） meta=0 biome=92 sky=15 light=0
该列最高非空气方块: y=72 id=12 minecraft:sand（沙子） meta=1 ...
y=0: id=7 minecraft:bedrock（基岩）
```

也就是说：**从 GTNH 服务器收到的区块，已经能按世界坐标查到方块 id、metadata、光照、
生物群系，并且翻译成「沙子 / 基岩」这样的名字**。T1 的协议+世界底座到此闭合。

测试：`gtnh-data` 4 个、`prismarine-chunk-1.7` 7 个、`protocol-fml` 20 个，共 31 个全过。

## 九、2026-11-23：bot 层（`packages/mineflayer-gtnh`）

在协议层 + 世界层之上包了一层 mineflayer 风格的 API：

```js
const { createBot } = require('mineflayer-gtnh')
const bot = await createBot({ host, port, username })
bot.on('chat', ({ text }) => console.log(text))
console.log(bot.blockNameAt(bot.entity.position.offset(0, -1, 0)))
```

- 事件：`login / spawn / move / health / time / chat / entitySpawn / entityGone /
  playerJoined / playerLeft / chunk / blockUpdate / kicked / end`。
- API：`bot.entity.position`、`bot.blockAt(pos)`、`bot.blockNameAt(pos)`（带 GTNH 中英文名）、
  `bot.entities` / `bot.players` / `bot.entitiesNear()` / `bot.nearestEntity()`、
  `bot.chat(msg)`、`bot.look(yaw, pitch)`、`bot.quit()`。
- **握手必须回声服务器的 mod 列表**：不给 `mods` 时服务器回
  `Mod rejections [FMLMod:gregtech{5.09.54.265}, ...]` 直接踢。`loadServerMods()` 默认读
  `packages/protocol-fml/data/raw/{local-server-modlist,server-modlist}.json`（ping.js 落盘的）。
- 聊天是 JSON 组件，`translate` 键基本是 GTNH 自己的（`dreamcraft.*` / `yamcore.*` /
  `serverutilities.*`），minecraft-data 的语言表里没有 → `src/chat.js` 用整合包的 lang 渲染，
  支持 `%s` / `%d` / `%1$s`。

实测（`node tools/smoke.js 127.0.0.1 54615 --seconds 18 --chat "hi from mineflayer-gtnh"`）：

```
[spawn] 出生点已同步
entityId: 7262  维度: 0
坐标: 7.50, 79.62, 0.50
生命: 20 饥饿: 20 等级: 0 / 第 2 天 23570 tick
区块: 58 次更新 / 世界 289 列；方块更新 356
脚下: BiomesOPlenty:foliage (id=892 meta=2) sky=15 light=0 biome=230
脚下方块之下: minecraft:grass (id=2 meta=0)
聊天: A magic bubble of protection appears... | 你还没有加入或创建组！[点击此处] 打开组GUI … |
      ----------------------------------------------------- | Welcome to GregTech: New Horizons 2.9.0
✓ bot 层通了
```

服务器日志同时确认：
```
[11:19:45] gtnh-bot[/127.0.0.1:50032] logged in with entity id 7262 at (7.5, 78.0, 0.5)
[11:19:45] gtnh-bot joined the game
[11:20:03] <gtnh-bot> hi from mineflayer-gtnh
[11:20:05] gtnh-bot lost connection: TextComponent{text='Disconnected'}
```
聊天能发出去、断线是干净的（不是被踢）。

**还没做**：物理（掉落/碰撞）、挖掘与放置、背包（window_items / set_slot 里 item id 是
EndlessIDs 的 4 字节 int）、实体类型映射、1.7.10 feature 表。

## 十、2026-11-23：背包层（`slot` 线格式 + 46 槽 + window_click）

### 10.1 物品不是原版 `slot`：4 字节 id + 尾字节 flag

EndlessIDs 的 `PacketBufferMixin` 把 `writeItemStackToBuffer` 整个 `@Overwrite` 了
（源码 `GTMEGA/EndlessIDs` 的 `mixins/common/blockitem/common/PacketBufferMixin.java`）：
空栈写 `writeInt(-1)`，有物品写 `writeInt(itemId) + writeByte(count) + writeShort(damage) + NBT`。
源码是 9 字节，但**线上抓到的一直是 10 字节**——多出来的 1 字节在 NBT 之后：

```
blockId   : i32
if blockId >= 0:
  itemCount : i8
  itemDamage: i16
  nbtData   : compressedNbt   // short 长度 + gzip；null = ff ff
  gtnhFlag  : u8              // 实测恒为 1，空槽没有
```

抓包佐证（`data/raw/proxy*.jsonl`）：

| 帧 | 字节 | 说明 |
| --- | --- | --- |
| 进服送 questbook | `2f 00 0024 00001861 01 0000 ffff 01` | id **6241**、count 1、damage 0、NBT null、flag 1 |
| 空光标 | `2f ff ffffffff` | 只有 `i32(-1)` |
| 僵尸拿弓（无 NBT） | `04 <entity> 0000 00000105 01 0000 ffff 01` | id 261 = `minecraft:bow` |
| 僵尸拿命名物品（有 NBT） | `... 00000105 01 0000 0031 1f8b… 01` | `0031`=49 是 NBT 长度，gzip 紧跟其后，flag 在最后 |

`gtnhFlag` 的来源还没定位（EndlessIDs 源码里没有），但它恒定且位置固定，
就按不透明字节透传。**位置在 NBT 之后**，不是 id 之后——这点走过弯路：早期按
`id+count+damage+nbtLen+nbt+flag` 手工走位时把 flag 当成 id 后的字节，导致 17/66 字节的
`entity_equipment` 帧全错位。

### 10.2 玩家窗口是 46 个槽位

`backhand-1.8.18.jar` 在玩家容器里加了副手槽（`xonin/backhand/api/core/BackhandSlot`），
所以 `window_items` 的 `count` 是 **46** 而不是 45，45 号槽是副手。
槽位布局：0 输出 / 1-4 合成 / 5-8 装备 / 9-35 背包 / 36-44 快捷栏 / 45 副手。

### 10.3 window_click 能写

`packet_window_click` 的 `item` 字段就是 clickedItem（点之前光标上的物品），
用上面那套 10 字节格式写，服务器会回 `transaction {action, accepted}`：

```
[transaction] {"windowId":0,"action":1,"accepted":true}
[set_slot]    {"windowId":0,"slot":37,"item":{"blockId":6241,"itemCount":1,"itemDamage":0,"gtnhFlag":1}}
```

坑：服务器对光标（`set_slot windowId=-1`）的同步是**懒的**，点完 600ms 内收不到，
要等下一次点击才 flush。所以 bot 侧 `pickUp`/`placeAt` 先乐观更新本地光标和槽位，
服务器回包再覆盖。

### 10.4 本服的 `/give` 是坏的（踩坑）

`/give <player> minecraft:dirt 64` 打印 `Given [Dirt] * 64`，但随后 `clear` 只清掉 1 件
（进服送的 questbook）——**物品根本没进背包**，也不是同步问题（`clear` 会立刻触发
`set_slot` 清空）。op + creative 下也一样；`summon Item` + 拾取也不生效。
所以背包冒烟测试不能用 `/give`，改成用「进服时服务器主动送的 questbook」当样本。

### 10.5 creative slot 会把 count 归一成 1

`set_creative_slot` 写 `{blockId:264,itemCount:64,itemDamage:7,gtnhFlag:1}`，
服务器接受（放进了槽位、damage 7 原样保留），但**回包的 count 永远是 1**。
目前拿不到 count > 1 的线上样本，`gtnhFlag` 是否是 count 高位无法验证；
实际读真实物品（127 帧 entity_equipment + questbook）都是 flag=1。

### 10.6 验收

```
$ node packages/mineflayer-gtnh/tools/inventory-smoke.js 127.0.0.1 54615 --username invBot2
window_items：46 个槽位
槽位 36: Quest Book / questbook:ItemQuestBook  id=6241 数量=1 damage=0 flag=1
=== 搬运：槽位 36 → 37 ===
光标：id=6241
槽位 36：已空；槽位 37：id=6241
搬回：槽位 36 id=6241
事务：2 次点击 / 1 次被接受
✓ 背包层通了（46 槽 + 4 字节物品 id + 尾字节 flag + window_click 读写）
```

测试：`packages/protocol-fml/test/slot.test.js`（6 个，用真实抓包帧当 fixture）
+ `packages/mineflayer-gtnh/test/inventory.test.js`（5 个，离线状态机）。

## 十一、2026-11-23：物理层（走路 / 跳跃 / 挖掘 / 放置）

### 11.1 位置包的第 2、3 个字段名是反的（会直接被踢）

minecraft-data 1.7 里 `packet_position_look` 定义成 `x, stance, y, z, ...`，
但真实线序（C04/C06）是 `x, y(脚底), stance(眼睛), z, ...`。当成 `stance` 发的后果：

```
[Server thread/WARN]: digBot had an illegal stance: -1.6200000000000045
[Server thread/INFO]: digBot lost connection: ...key='hodgepodge.disconnect.illegal_stance'
```

`-1.62` 恰好是 `stance - y` 的差。修法见 `packages/protocol-fml/src/index.js`
的 `GTNH_MOVEMENT_PACKETS`：自定义 `gtnh_position` / `gtnh_position_look`
（字段序 `x, y, stance, z`），再用字符串别名覆盖原包名。
**这个补丁是常开的**，不像 chunkapi/slots 可以关。

> 坑：nmp 的 `createProtocol` 只按 `state;direction;version` 缓存，
> **不含 customPackets**。所以「先建过带补丁的协议，再建一个 vanilla 的」拿到的还是补丁版；
> 单测里要验证原始定义得直接读 `protocol.json`。

服务端 S08 `position` 的 `y` 就是脚底，`stance` 是另一个字段 —— 不要再减 1.62。

### 11.2 单位：速度是「格/tick」，不是「格/秒」

`SPEED.walk` 必须写成 `4.317 / 20 ≈ 0.216`。忘了除 20 会跑到 86 格/秒，
服务器每秒把你拉回一次，表现为「原地不动 + 反复收到同一位置」。

### 11.3 重力结算顺序

原版是「先移动，再 `motionY = (motionY - 0.08) * 0.98`」。
顺序反过来跳跃高度会从 **1.25 格** 掉到 1.0 格左右。

### 11.4 出生点常常嵌在方块里

服务器给的 y 可能不是整数，第一 tick 就 `collides()`。
`tick()` 开头会先 `y += 0.1` 顶出来，否则任何方向都动不了。

### 11.5 碰撞箱：半砖 / 台阶 / 栅栏（2026-11-26 已修）

minecraft-data 1.7 的 `boundingBox` **所有方块**都是 `block`（只有 `empty`/`block` 两种），
连石头也一样——真正的形状数据（`shapes`）是 1.13 才有的。所以早期实现把半砖、
台阶、栅栏全当整块，0.5 格的台阶也必须跳。

修法分两层：

1. `packages/mineflayer-fork/lib/gtnh/blockshape.js`：按注册名 + metadata 补一张表
   （slab `meta & 8` 是双砖→整块、否则 0..0.5；stairs `meta & 8` 倒置→0.5..1、
   否则 0..0.5；fence/fence_gate/wall → 1.5；carpet → 1/16；snow_layer → 层数×1/8；
   另有 farmland/chest/bed/enchanting_table/cake/brewing_stand）。没进表的方块回落整块。
   将来数据里带 `shapes` 时优先用 `shapes`，这张表自然退役。
2. `physics-tick.js` 的碰撞检测从 `isSolid(x,y,z) → bool` 升级成
   `shapeAt(x,y,z) → AABB 数组`，逐盒与玩家 AABB 求交（`toBoxes` 同时吃
   prismarine-block 的 `[minX,minY,minZ,maxX,maxY,maxZ]` 数组格式与对象格式）。
   返回 `true`/`false` 仍按整块处理，老调用方不用改。

顺带修掉一个**一直没生效**的 bug：`tick()` 里先 `moveAxis(...)` 再判断
`state.velocity.x !== 0` 决定要不要上台阶，但 `moveAxis` 撞到东西时已经把
`velocity[axis]` 清零——条件永远为假，`stepUp` 从来没被调用过。现在先存一份
`vx`/`vz` 再调 `moveAxis`，成功上台阶后把速度还原。

实测（本地服，`setblock` 半砖平台）：走上 `minecraft:stone_slab` 时 y 从 89.0
抬到 89.5 且 `onGround` 保持 true，不用跳；1.5 格高的栅栏仍然拦得住
（抬 0.6 后玩家 AABB 64.6..66.4 与 64..65.5 重叠）。

### 11.6 挖掘 / 放置

```
block_dig  = status i8 + location {x i32, y u8, z i32} + face u8     // 12 字节
block_place= location + direction u8 + heldItem slot + cursor 3×i8
```

- **出生点附近挖不动**：`spawn-protection=1`（半径 16 格）。走远一点或让服主关掉。
- 创造模式给物品用 `set_creative_slot`，但服务器会把 count 归一成 1（见第十节）。

### 11.7 验收

```
$ node packages/mineflayer-gtnh/tools/move-smoke.js 127.0.0.1 54615 --tp "20 90 20"
已传送到 20 90 20
起点 (20.50, 90.01, 20.50)
走了 6.20 格 / 3s，峰值速度 4.32 格/秒（期望 4.32）
跳跃高度 1.25 格（期望 ≈ 1.25），落地：是
✓ 移动层通了

$ node packages/mineflayer-gtnh/tools/dig-smoke.js 127.0.0.1 54615 --tp "20 90 20"
目标 (20, 75, 20) = minecraft:grass (id=2 meta=0)
挖完：id=0（事件：收到 blockUpdate）
手持：id=1
放置：id=1（期望 1）
✓ 挖掘/放置层通了
```

> 出生点 (2.5, 81, -9.5) 附近是沙丘 + 坎，直接测「走」测到的是撞墙，
> 所以冒烟测试支持 `--tp`；`move-smoke` 主要看**峰值速度**而不是总位移。

测试：`packages/protocol-fml/test/movement.test.js`（4 个，字段顺序 + 字节偏移 + 往返）
+ `packages/mineflayer-fork/test/physics-tick.test.js`（13 个，落地/走路/疾跑/潜行/跳跃/撞墙/半砖/栅栏/台阶/掉出世界）
+ `packages/mineflayer-fork/test/blockshape.test.js`（6 个，半砖/双砖/台阶/栅栏/地毯/雪层/未知方块）。

---

## 12. 1.7.10 的 feature 表

minecraft-data 的 `data/pc/common/features.json` 一共 171 项，最早的版本区间是 `1.8`，
所以 `minecraft-data('1.7.10').supportFeature(x)` 对任何 feature 都返回 `false`。
mineflayer 里有 60+ 处 `supportFeature(...)` 分支（光 `positionPacketHasBitflags` 就 14 处），
这个函数在 1.7 上等于「永远走 else」，直接照搬会错得很隐蔽。

做法（`packages/gtnh-data/src/features.js`）：

1. 以 **1.8.9 的取值**为基线（1.7 与 1.8 的线格式几乎一致），显式写出全部 171 项，
   枚举型保留真值（`metadataIxOfItem = 8`、`fishingBiteDelayMaxTicks = 900`、
   `nbtNameForEnchant = 'ench'`、`typeOfValueForEnchantLevel = 'short'`、
   `whereDurabilityIsSerialized = 'metadata'`）；
2. 用 `OVERRIDES_FALSE` 修正 6 项 1.8.9 为 true、1.7.10 不成立的：

   | feature | 1.7.10 的真实情况 |
   | --- | --- |
   | `blockPlaceHasIntCursor` | 1.7 的光标是 i8（1.8 才是 int） |
   | `indexesVillagerRecipes` | 1.7 的村民交易不按索引 |
   | `booksUseStoredEnchantments` | 1.7 用 `ench` 而不是 stored enchantments |
   | `clientUpdateBookIdWhenSign` | 1.7 没有这个行为 |
   | `editBookIsPluginChannel` | 1.7 用 `MC|BEdit` 之类，不是 1.8 的通道 |
   | `titleUsesLegacyPackets` | **1.7.10 完全没有 title 系列包** |

3. 再加一层 GTNH 修正 `GTNH_OVERRIDES`：`doesntHaveOffHandSlot: false` ——
   `backhand-1.8.18.jar` 给玩家加了副手槽，玩家窗口是 46 格（实测 `window_items count=46`）。

导出：`supports(name)`（GTNH 口径，bot 用这个）、`supportsVanilla(name)`、`featureValue(name)`、
`listFeatures()`。`Bot` 上对应 `bot.supports()` / `bot.featureValue()` / `bot.features`。

测试（`packages/gtnh-data/test/features.test.js`，12 个）除了「键集合必须和 minecraft-data 一致」，
还用 `data/pc/1.7/protocol.json` 做交叉验证：`block_place` 必须有 `heldItem`、光标必须是
`i8/i8/i8`、没有 `packet_title`、有 `packet_transaction`、`rel_entity_move` 是 `i32,i8,i8,i8`。
一旦有人手滑把表改错，这几条会立刻红。

## 13. 2026-11-23：M4 窗口层（容器 GUI）

### 13.1 三个窗口包

```
packet_open_window   = { windowId u8, inventoryType u8, windowTitle string,
                         slotCount u8, useProvidedTitle bool,
                         entityId switch(inventoryType == 11 → i32) }
packet_close_window  = { windowId u8 }            // 双向
packet_window_items  = { windowId u8, items: array(i16 count) of slot }
packet_window_click  = { windowId i8, slot i16, mouseButton i8, action i16,
                         mode i8, item slot }     // 都是原版定义，没被 GTNH 改
```

`slot` 用的是第十节那套 GTNH 格式（`id i32 + count + damage + nbt + gtnhFlag`），
所以窗口里的物品和背包里的物品走同一套编解码，不需要额外的补丁。

### 13.2 实测（本地服）

| 容器 | inventoryType | title | 槽位 |
| --- | --- | --- | --- |
| 单个木箱 | 0 | `container.chest` | 27 |
| 双联木箱 | 0 | `container.chestDouble` | 54 |
| 工作台 | 1 | `Crafting` | 9 |
| 熔炉 | 2 | `container.furnace` | 3 |

工作台/熔炉的 `inventoryType` 是原版常量（1 / 2），说明 **mod 容器（GT 机器、箱子类）
同样走 `open_window`**，窗口层对 mod 是通用的——这也是做 M4 的前提。

`activateBlock` 发出的 `block_place`（24 字节）：

```
08 00000020 49 0000001e 01 00000001 01 0000 ffff 01 08 10 08
│  x=32      y=73 z=30    dir=1  id=1 c=1 damage=0 nbt=-1 flag=1 cursor 8/16/8
```

### 13.3 GT 机器为什么还打不开（已知结论）

- GT 机器全部塞在块 **3003 = `gregtech:gt.blockmachines`** 里，**块 meta 只有 0..15**
  且只表示朝向；机器种类来自 `TileEntity` 的 id，而 TE id 是放置时物品的
  `itemDamage` 决定的。
- 所以要想"放出一台指定机器"，得让 `itemDamage` 恰好是那台机器的 id；
  但 `set_creative_slot` 的服务端校验会拒掉大部分 id（服务端日志
  `tried to set an invalid carried item`），`/give` 在本服又是坏的（打印成功但不入库）。
- 已经放上去的（damage 16/17/18/19/20 → 块 meta 2/2/2/3/0）右键**没有** `open_window`
  回来，说明这些落下的是无 GUI 的机器（或控制器）。要真机验证 GT GUI，
  需要一台玩家自己放好的带界面机器（比如 GT 的箱子），再让 bot 右键。
- `setblock` 给 GT 方块时 data 上限 15，无法直接指定机器种类。

### 13.4 矿辞 / 配方数据

实例里没有任何可解析的导出：

- `saves/NEI/NEI.dat` 只有 17KB 的物品面板书签；
- `config/` 下没有 oredict / recipe dump；
- NEI 的这类数据只存在于客户端内存（或服务端注册表）。

结论：矿辞/配方要么让玩家在游戏里用 NEI 的「导出」功能生成 CSV，要么后续写一个
服务端插件/指令把 `OreDictionary` 和 `GameRegistry` 的配方表吐出来。目前 `gtnh-data`
先留接口，不臆造数据。

### 13.5 自定义维度

GTNH 里有 Galacticraft / 模组维度，换维度会 `respawn`。`bot.worlds` 按维度各存一份
`ChunkStore`，`respawn` 时清实体、切当前世界并发 `dimensionChange`。本服没有
`/dim` 之类的指令（只有机器/火箭能换维度），所以这条只能靠单测覆盖。

## 十四、2026-11-23：转 vendored mineflayer fork（`packages/mineflayer-fork`）

上游 mineflayer 4.39（v4.39.0）整份复制进工作区，逐处打 `GTNH-PATCH` 注释。目标是
让 `bot.dig` / `bot.chat` / `bot.blockAt` / `bot.inventory` 这些**上游 API** 直接可用，
而不是我们自己维护一套 Bot 类。

### 14.1 打了哪些补丁

| 文件 | 补丁 |
| --- | --- |
| `lib/version.js` | `testedVersions = ['1.7.10']` |
| `lib/loader.js` | 用 `protocol-fml` 的 `createFmlClient` 建连接；默认版本 `1.7.10`；`supportFeature` 走 `gtnh-data`；建 registry 后覆盖 `bot.registry.supportFeature` |
| `lib/plugins/blocks.js` | 整份重写：世界用 `lib/gtnh/world.js`，监听 `gtnh_chunk` / `gtnh_chunk_bulk` / `gtnh_block_change` / `gtnh_multi_block_change` |
| `lib/gtnh/world.js` | 新增：`GTNHWorld`（基于 `prismarine-chunk-1.7` 的 `ChunkStore`） |
| `lib/gtnh/physics.js` | 新增：`prismarine-physics` 的 1.7.10 替身（`Physics` / `PlayerState`） |
| `lib/gtnh/physics-tick.js` | 新增：与 `packages/mineflayer-gtnh/src/physics.js` 同源的物理 tick |
| `lib/plugins/physics.js` | 发位置包时补 `stance = y + 1.62`（1.7.10 的 C04/C06 线序） |
| `lib/plugins/entities.js` | `prismarine-entity` / `prismarine-item` 传 `bot.registry`；`player_info` 兼容 1.7 单条格式，用 `offlineUUID()` 合成 uuid |
| `lib/plugins/inventory.js` | `prismarine-windows` 传 `bot.registry` |
| `lib/plugins/game.js` | brand 通道保留 `['string', []]`（1.7 上是 pstring） |
| `packages/protocol-fml/src/index.js` | `createFmlClient` 传 `validateChannelProtocol: false` |

### 14.2 四个非显然的坑

1. **`registry.supportFeature` 必须返回值，不是布尔**。
   `prismarine-item` 靠它取 `typeOfValueForEnchantLevel`（要 `'short'`）与
   `nbtNameForEnchant`（要 `'ench'`）。一开始接的是 `gtnh-data` 的 `supports()`（只给布尔），
   于是 `bot.dig()` 抛
   `Don't know how to get the enchants from an item on this mc version`。
2. **物理替身里方法不能脱 `this`**。
   `const getBlock = world.getBlock` 这种写法在去取 `this.store` 时抛
   `Cannot read properties of undefined (reading 'store')`，而 mineflayer 每 tick 把异常
   吞掉 → 表现是「完全不落地、走路极慢」，极难从现象反推。
3. **`simulatePlayer(...).apply(bot)` 必须真的写回实体**。
   `onGround` 不回写时它永远是 `false`，地面加速度 blend 从 0.6 掉到 0.02，
   走路只有 0.6 格/秒（看起来像被服务器拽住）。
4. **发位置包要自己补 `stance`**。mineflayer 的 `lastSent` 里没有这个字段，
   而我们的 `gtnh_position(_look)` 类型按真实线序要 `x, y, stance, z`，
   缺字段会静默不发包。

### 14.3 验收（`npm run fork-smoke`）

```
✓ 生成于 (20.5, 76.0273967804658, 16.30000046170915) version 1.7.10
  传送后 (20.5, 77.0000038564561, 20.5) onGround true
✓ blockAt unknown:3324 id=3324 bb=block
✓ 聊天已发送
✓ 走路：峰值 4.32 格/秒，位移 4.32 格
✓ 挖掘 unknown:922 用时 66 ms；现在是 air
✓ 背包 46 槽，非空 0 个
✓ fork 冒烟通过
```

### 14.4 还没解决的

- **方块/物品名**：id > 4095 的 GTNH 方块显示成 `unknown:3324`。`GTNHWorld.nameOf`
  接口已在，但没有把 `bot._client.fml.registry` 接上；物品同理（`unknown`）。
  下一步在 `loader.js` 的 fml `complete` 之后把注册表灌进 `bot.registry.blocks/items`。
- **生存模式挖掘**：创造模式 66ms 就完成；生存模式依赖服务器发 `block_change` 确认，
  冒烟里还没跑通（超时），需要再验。
- 挖掘/放置的 `block_dig` 里 mineflayer 会多传一个 `sequence` 字段，1.7 协议没有这个
  字段，目前靠 protodef 忽略多余字段才没炸，后续应去掉。

## 十五、登录包多 4 字节：GTNH 的维度 id（修掉"偶发不 spawn"）

**现象**：fork 起来以后，大约三分之一的会话卡在登录——`login` 包解析出来了，但永远收不到 `position`，`bot` 不 spawn，服务器那边明明显示 joined。

**日志**：
```
Chunk size is 17 but only 13 was read ; partial packet : {"name":"login", ... "levelType":"RWG"}
```

**原因**：Hodgepodge 的 `MixinS01PacketJoinGame_FixDimensionID` 在 `S01PacketJoinGame.write` 末尾追加 `writeInt(dimensionID)`（读端判断 `readableBytes() >= 4` 才读）。所以 GTNH 的登录包是 17 字节，minecraft-data 的定义只认 13 字节。解析失败一次本身无害（帧有长度前缀，不会错位），但偶尔会打断 mineflayer 的登录状态机，`position` 就再也没被处理。

**修法**（`packages/protocol-fml/src/index.js` 的 `GTNH_LOGIN_PACKETS`）：
```js
gtnh_login: ['container', [
  ...原版 6 个字段,            // entityId i32 / gameMode u8 / dimension i8 /
                               // difficulty u8 / maxPlayers u8 / levelType string
  { name: 'dimensionId', type: 'restBuffer' }  // 0 或 4 字节
]]
```
- 用 `restBuffer` 而不是 `['buffer', { count: 'restBuffer' }]`：后者在 play.toClient 作用域里报 `restBuffer is not defined`。
- `createFmlClient` 的 `emit` 拦截里把 4 字节 `dimensionId` 解成 int 写回 `packet.dimension`（GTNH 的维度 id 是 int，`dimension` 字段仍是 i8，装不下）。

**验证**：`test/login.test.js` 3 个用例（17 字节全读完 / 13 字节原版 / int 300 不被截断）；连服 10 次 spawn 全成功。

**顺带**：`resolveMods()` 让 `createFmlClient` 在没传 `mods` 时，从 `data/raw/*-modlist.json` 按 host:port 自动找一份（否则 forge 服直接 Mod rejections 踢人）；`tools/rcon.js` 修了「传字符串会被按字符拆成 30 条命令」的 bug。

## 十六、2026-11-24：GT 机器 GUI 走 ModularUI2（`open_window` 根本不会来）

用 `.probe/tcpproxy2.js` 抓真实客户端（用户连 54616 右键 (33,78,19) 的进阶合金炉）：
整份抓包 **`open_window`(0x2d) 出现 0 次**，但窗口照开，物品照同步。

### 我们的点击和服务器的应答

- 我们的 `block_place` 与真实客户端**逐字节一致**：
  `08 00000021 4e 00000013 05 ffffffff 10 0b 0c`（x=33,y=78,z=19,direction=5,空手,cursor 16/11/12）。
- 服务器对点击的应答不是 `open_window`，而是 `modularui2` 通道的 `custom_payload`（抓包 3472 帧）：
  ```
  3f 0a "modularui2" 00 14 03 01 00 0c "gregtech:mte" 03 21 4e 13
  3f 0a "modularui2" 00 36 0b 00 21 "basicmachine.alloysmelter.tier.02.powerSwitch:0" 00 02 00 01
  3f 0a "modularui2" 00 38 0b 00 21 "basicmachine.alloysmelter.tier.02.mufflerSyncer:0" 00 02 00 00
  ```
  第 2 字节是剩余长度，载荷里带 GUI 的注册名（`gregtech:mte`）、控件名与坐标（`03 21 4e 13` = 33/78/19）。
  控件的值以 `控件名:值` 的字符串流同步（`powerSwitch:0`、`mufflerSyncer:0`）。完整格式未逆向，暂按不透明处理。
- 容器本身仍是原版包：`window_items(0x30)` 用 **windowId=1** 到达，`30 01 0029` + **41 槽**；
  `set_slot(0x2f)` 也是 windowId=1。也就是说服务器直接打开了容器，只是没有 `open_window` 通知。

### fork 的处理（`packages/mineflayer-fork`）

- `lib/gtnh/modularui.js`：`createModularWindow(windows, title, packet)` —— 用 `new windows.Window(...)`
  造窗口，**机器槽 = 总槽数 - 36**（`inventoryStart`），`hotbarStart = slots - 9`，`craftingResultSlot = -1`，
  `requireConfirmation = false`，并打 `type='modularui2'`、`implicit=true`、`modularUI=true`。
- `lib/plugins/inventory.js`：`window_items` 落在未知窗口 id 上时先照旧缓冲，再加 **150ms 兜底定时器**
  （`IMPLICIT_DELAY_MS`，给正常 `open_window` 留时间，村民/箱子是先发 items 后发 open）；
  超时仍没有 `open_window` 就 `openImplicitWindow()` → `bot.currentWindow` + `windowOpen` 事件。
  `open_window` / `close_window` 会取消定时器。
- 之后 `set_slot`、`windowItems`、`clickSlot`、`closeWindow` 全部按普通窗口工作。

### 实测

```
$ node packages/mineflayer-fork/tools/machine-smoke.js 127.0.0.1 54615 --pos "33 78 19" --tp "34.5 78 20.5"
machine 33 78 19
tp Teleported machineS2 to 34.5,78.5,20.5
window 1 type=modularui2 slots=41 invStart=5
machine slots 5 filled: (empty)
player slots in window: 5:questbook:ItemQuestBookx1
reopened as window 2 slots=41
✓ machine GUI (ModularUI2) ready
```

- 每次右键都是**新的 windowId**（1、2、3 …），关掉再点会拿到新 id。
- 机器 41 槽 = 5 机器槽 + 36 玩家槽；玩家物品在窗口里从槽 5 开始（快捷栏 32..40）。
- 之前几轮"点击没反应"，是因为探针里 bot 站位/手持状态与我们后来的点击不同——同样的字节在 `tp` 到
  (34.5,78,20.5) 后能稳定开窗；现在已用冒烟脚本锁死这条路径。

### GT 机器的访问控制（字节码）

`BlockMachines.onBlockActivated` → `gtTE.getTimer() < 1` 直接 return false；
`!gtTE.isUseableByPlayer(player)` 时 **return true（静默，什么都不做）**。`isUseableByPlayer` =
`canAccessData() && playerOwnsThis(player,false) && mTickTimer > 1 && getTileEntityOffset(0,0,0)==this &&
distanceSq(x+0.5,y+0.5,z+0.5) < 64 && mMetaTileEntity.isAccessAllowed(player)`。
`playerOwnsThis` 在机器无主时把点击者设成 owner；`privateAccess() = mLockUpgrade || ownerControl()`。
也就是说：机器没被锁时任何玩家都能开；被锁/加了 owner 控制后才只有 owner 能开。

### 17. 在 ModularUI2 窗口里搬物品（点击真实发生了什么）

MUI2 窗口的容器号是服务器用 MUI2 自己的包建的，**和原版 `open_window` 的计数器不是一套**，
于是所有点击的确认包都是 `accepted = false`，但**服务器照样执行了这次点击**，随后用
`set_slot` 把真实结果推回来。抓到的典型序列（`bot.clickWindow(0, 0, 1)` 取出机器槽 0）：

```
>>CLICK {w:1,s:0,a:1,m:0,b:0}     // 点机器槽 0
<<SS 1 0 id=-1                    // 服务器：槽 0 空了（取走成功）
<<SS -1 -1 id=6241 n=2            // 服务器：光标上有 2 个（windowId=-1 是光标）
<<TXN 1 1 false                   // 确认包却说 accepted=false
```

因此在 fork 里做了三处补丁（都带 `GTNH-PATCH`）：

1. `set_slot` 的 `windowId < 0` 分支写入 `selectedItem`（光标）。原来完全忽略，
   导致"点完光标状态是错的"，后续点击全乱。
2. `confirmTransaction` 里若 `window.implicit`（MUI2 隐式窗口）且 `accepted === false`，
   发 `transactionMismatch` 事件但**不抛错**——服务器已经做了，靠 `set_slot` 校正模型。
3. `moveSlotItem` 在决定"要不要把光标物品放回原槽"之前等 250ms，因为 1.7 的光标
   `set_slot(-1,-1)` 可能比 transaction 晚到。

实测出的可用操作（`tools/machine-item-smoke.js` 全部按"关窗再开窗"的服务器真相校验）：

| 操作 | 做法 | 结果 |
| --- | --- | --- |
| 从机器槽取出 | `clickWindow(slot, 0, 1)`（shift 点击） | ✓ 服务器把物品并进背包 |
| 放进机器槽 | `clickWindow(玩家槽,0,0)` 拿起 → `clickWindow(机器槽,0,0)` 放下 | ✓ 落槽并持久 |
| 放进**玩家槽** | 拿起后点任意玩家槽 | ✗ 服务器完全不响应（连 transaction 都不回） |

最后一条是 MUI2 容器的限制：窗口里 5..40 是玩家背包，但点击这些槽服务器不处理。
所以"从机器槽搬到玩家槽"只能走 shift 点击，不能走"拿起再放下"。

验收输出：

```
window 1 type=modularui2 slots=41 inventoryStart=5
机器槽: 0:ItemQuestBookx1 1:- 2:- 3:- 4:-
玩家槽: 5:ItemQuestBookx1
取出 questbook:ItemQuestBook x1: 机器槽 -> 已移走, 玩家物品 1 -> 2
放入 questbook:ItemQuestBook x2: 机器槽 0 -> ItemQuestBookx2
✓ 机器物品双向点击通过
```

## 十七、2026-11-24：ModularUI2 控件流（机器状态）

GT 机器的 GUI 内容不只在槽位里——开关、错误、进度、电路配置这些都以
「控件名 → 值」的形式，走 `modularui2` 通道的 `PacketSyncHandler` 推下来。

### 1. 必须先向 FML 注册通道

这是最大的坑：**客户端不在 `REGISTER` 里声明 `modularui2`，服务器一个字节都不发**。
FML 的 `NetworkDispatcher` 只把包发给"客户端声明过该通道"的玩家。没注册时抓包
里只有 `gtnhlib` / `Waila` / `GregTech`，`modularui2` 为 0 帧；注册后 6 秒能收到
132 帧。已把它加进 `protocol-fml` 的 `DEFAULT_CHANNELS`（`src/handshake.js`）。

### 2. 包 id 表（NetworkHandler 注册顺序）

7 个包占 **12 个 id 槽**（`registerBoth` 内部 S2C/C2S 各 +1）：

| id | 包 | 方向 |
| --- | --- | --- |
| 1 | `SClipboard` | S→C |
| 2 | `SyncConfig` | C→S |
| 3 / 4 | `OpenGuiPacket` | S→C / C→S |
| 5 / 6 | `ReopenGuiPacket` | 双向 |
| 7 / 8 | `CloseGuiPacket` | 双向 |
| 9 / 10 | `CloseAllGuiPacket` | 双向 |
| 11 / 12 | `PacketSyncHandler` | 双向 |

### 3. 线格式

`OpenGuiPacket`（实测 `03 01 00 0c "gregtech:mte" 03 21 4e 13`）：

```
varint packetId            // 3
varint windowId            // 1  —— 和后面 window_items 的 windowId 一致
varint networkId
string factory             // GT 的 UI factory 名
buffer data                // factory 自己的数据；GT 是 varint 长 3 + x/y/z 一字节
```

`PacketSyncHandler`：

```
varint packetId            // 11
varint networkId
string panel               // 例如 basicmachine.alloysmelter.tier.02
string key                 // 例如 powerSwitch:0
bool   action              // false = 服务端同步下来，true = 客户端请求
buffer packet              // SyncHandler 自己写的值
```

值的缓冲以 `varint tag` 开头（`ValueSyncHandler.SYNC_VALUE = 0`，
`ItemSlotSH.SYNC_ITEM = 0` / `SYNC_ENABLED = 1`——两者都是 0，只能靠 key 与长度区分）：

| 类型 | 编码 | 例子（合金炉 tier 02） |
| --- | --- | --- |
| bool | 1 字节 | `powerSwitch:0` → `00 01` = true |
| int | varint（负数按 32 位补码） | `ghostCircuitIndex:0` → `00 ff ff ff ff 0f` = -1 |
| double | 8 字节大端 IEEE-754 | `auto_sync:…:0` → `00 ff f8 00 …` = **NaN**（进度条空转） |
| long | 8 字节大端补码 | 能量/数量类显式 key，如 `energy:0` |
| 物品槽 | `bool readOnly + ItemStack + bool enabled + bool false` | `player:0` → questbook x1 |

`long` 与 `double` 都是 8 字节大端，线上没有类型标记：目前按 key 区分——
`auto_sync:<panel>:<n>` 是 MUI2 给「widget 自带的 value」自动注册的，
GT 的进度条是 `new DoubleSyncValue(this::getAsDouble)`（`MTEBasicMachineBaseGui
.createProgressBar`），所以 auto_sync 的 8 字节按 double 解；显式
`Energy`/`Amount`/`Long` 键仍按 long 解。`decodeSyncValue` 里对 auto_sync
只在「NaN 或值域 [0,1]」时判 double，其余落 long，认错的极端值可拿原始字节复核。

物品仍是 `id(i32 BE) + count(u8) + damage(i16 BE) + nbtLen(i16 BE) + nbt + 1 字节`
——最后那个字节在抓包里**恒等于 count**（x1→01、x2→02、x64→40），暂按不透明字段保留。

### 4. 落地

- `packages/protocol-fml/src/gtnh/modularui.js`：`parsePacket` / `decodeSyncValue` /
  `collectSync`（纯函数，10 个单测用的是真实抓包帧）。
- `createFmlClient` 在 `custom_payload` 上识别 `modularui2`，解好后发 `gtnh_mui2`。
- fork 的 `lib/gtnh/modularui.js` 增加 `attachModularUI(bot)`：`openGui` 记住
  `windowId/factory/方块坐标`（窗口层据此**立刻**开窗，不再等 150ms 兜底），
  `syncHandler` 聚合进 `bot.machineState`，并暴露 `bot.panelState(panel)`、
  `bot.modularPanels()`、事件 `modularOpen` / `modularSync` / `modularClose`。
- 顺带把 protodef 的解析噪音关掉：fork 的 `createBot` 现在传
  `hideErrors: true` 给客户端（`protodefLogErrors: true` 可打开），并过滤
  `partialReadError` 类型的 `error` 事件——之前 FML 通道载荷被当成原版通道解析，
  每次登录都刷几十行堆栈。

验收（`node tools/mui-smoke.js 127.0.0.1 54615 --pos "33 78 19" --tp "34.5 78 20.5"`）：

```
modularOpen 1 gregtech:mte { x: 33, y: 78, z: 19 }
window 1 slots=41 factory=gregtech:mte
panel basicmachine.alloysmelter.tier.02 (10 keys)
  powerSwitch:0                   bool  true
  mufflerSyncer:0                 bool  false
  itemAutoOutput:0                bool  false
  fluidAutoOutput:0               bool  false
  powerfail:0                     bool  false
  ghostCircuitIndex:0             int   -1
  hasError:0                      bool  false
  auto_sync:…:0                   double NaN（机器空转，进度 0/0）
  auto_sync:…:2                   item  item 6241 x2 dmg=0
  player:0                        item  item 6241 x1 dmg=0
✓ ModularUI2 控件流解出 10 个值，powerSwitch=true
```

### 5. `auto_sync` 的语义与「只在变化时推」的修正

`auto_sync:<panel>:<n>` 是 MUI2 `WidgetTree.collectSyncValues` 给面板里
**没有显式注册**的同步 widget 自动起的 key（`AUTO_SYNC_PREFIX = "auto_sync:"`，
`n` 是该面板 BFS 顺序里的第几个）。合金炉的 `:0` 就是进度条：

```java
// MTEBasicMachineBaseGui.createProgressBar
new GTProgressWidget().value(new DoubleSyncValue(this::getAsDouble))
// lambda$createProgressBar$0: (double) mProgresstime / (double) mMaxProgresstime
```

机器空转时 `mMaxProgresstime == 0`，`0.0 / 0.0 = NaN`，位模式正是
`ff f8 00 00 00 00 00 00`——之前当成 long 解出来的 -2251799813685248 是误读。

实测还推翻了「progress 只在变化时推、空转收不到」：`DoubleSyncValue
.updateCacheFromSource` 用 `dcmpl` 比较（`getter.getAsDouble() != cache`），
NaN 与 NaN 比也不相等，所以空转时它**每 tick 都算变了**。
开一次 GUI 三秒收到 70 条 `syncHandler`（约 21 条/秒，几乎全是这条 NaN 进度）。

真正「只在变化时推」的是能量这类整数。要拿全量快照，**对同一方块再右键一次**
即可：服务端会重发 `openGui` 并重新推全部 key（实测第二次点击同样收到
`openGui x1` + 10 个 key + 持续进度流；服务器不发 `reopenGui` 包）。
`bot.machineState` 只保留每个 key 的最后一值，所以重开后再读 `panelState()`
就是一份完整快照。

## 十八、2026-11-25：动作层（生存挖掘 / 攻击 / 使用物品）与两个线格式修正

### 18.1 `spawn_entity_living` 的 type 在 GTNH 是 i16，不是 u8

`endlessids-mc1.7.10-1.7.4.jar` 的 `S0FPacketSpawnMobMixin` 把 type 加宽了
（`javap -p -c` 证实）：

```
writeType  = PacketBuffer.writeShort(type & 32767)
readType   = readShort() & 32767        // 原 readByte/writeByte 被 noWriteByte 顶掉
```

原版定义按 u8 读 → 后面每个字段都错位 1 字节。症状很好认：

- 所有 mob 名字都是 `unknown`（type 被读成别的东西）
- `entitySpawn` 事件的 position 是 `34078720` 这类天文数字
- `entitySpawn` 大量不触发（protodef 直接解析失败）

真实帧（`data/raw/mobcap.jsonl`，`.probe/tcpproxy2.js --listen 54621` 抓的）：

```
0f ef01 0041 00000317 00000823 000000f7 e0 00 0c ...
   │    │    │      │        │        │
   │    │    │      │        │        └ z = 247/32 = 7.72
   │    │    │      │        └ y = 2083/32 = 65.09
   │    │    │      └ x = 791/32 = 24.72
   │    │    └ type = 0x0041 = 65 (Bat)
   │    └ entityId varint = 239
   └ packet id 0x0f
```

修法：`packages/protocol-fml/src/index.js` 的 `GTNH_ENTITY_PACKETS`
（注意必须定义在 `play.toClient.types` 作用域里，根 `types` 会说
`vec3i16 is not defined`）：

```js
gtnh_spawn_entity_living: ['container', [
  { name: 'entityId', type: 'varint' },
  { name: 'type', type: 'i16' },
  { name: 'x', type: 'i32' }, { name: 'y', type: 'i32' }, { name: 'z', type: 'i32' },
  { name: 'yaw', type: 'i8' }, { name: 'pitch', type: 'i8' }, { name: 'headPitch', type: 'i8' },
  { name: 'velocity', type: 'vec3i16' },
  { name: 'metadata', type: 'entityMetadata' }
]]
packet_spawn_entity_living: 'gtnh_spawn_entity_living'
```

修好之后 `bot.registry.mobs[packet.type]` 直接出名字（`mobs[65]` = Bat、
`mobs[93]` = Chicken），`entities.js` 一个字都不用改。

`test/entity.test.js` 用上面那帧当 fixture（2 个用例）。**不能**在同一进程里
写「原版 u8 会读错」的反证：nmp 的 `createProtocol` 缓存 key 不含 customPackets，
要求反证得另起进程。

### 18.2 `arm_animation` 在 1.7 没有 hand 字段

1.7 的线格式是 `{ entityId i32, animation i8 }`；上游 mineflayer 只发
`{ hand: 0 }` → protodef 把 `entityId` 写成 0，等于「实体 0 挥手」，
客户端什么也看不到。`lib/gtnh/actions.js` 的 `armAnimationParams()` 补上
`entityId = bot.entity.id`、`animation = 0`。

### 18.3 物品尾字节必须自己补（写方向）

读的时候我们知道 `slot` 末尾多 1 字节（前面叫 `gtnhFlag`，等于 `itemCount`），
但写的时候 protodef 发现定义里没这个字段，就**什么都不写**（不是写 0），
于是对面读到的 count 是下一个字段的首字节。修法：
`lib/gtnh/items.js` 包一层 `prismarine-item` 工厂，覆盖 `Item.toNotch`，
`blockId >= 0` 时补 `gtnhFlag = itemCount`；9 个调用点统一改用它。

### 18.4 生存挖掘

`/gamemode 0` **必须在登录前生效**：1.7 的 gamemode 变更不会通知已登录的客户端
（`bot.game.gameMode` 会一直是旧值，`digging.js` 仍按创造模式 50ms 挖）。
工具里的流程是「连一次 → RCON `op` + `gamemode 0` + `tp` → 断开重连」。

实测耗时（含 lookAt 的网络往返，所以略高于理论值）：

| 方块 | 硬度 | 理论 | 实测 |
| --- | --- | --- | --- |
| `minecraft:grass` | 0.6 | 900ms | 1284–1824ms |
| `minecraft:sand` | 0.5 | 750ms | 1135ms |

### 18.5 攻击实体

1.7 服务器的攻击距离只有 ~4 格，超过就**静默无效**（不发任何拒绝包）。
冒烟工具里踩过的坑：

1. `entitySpawn` 监听必须先挂再 `summon`——RCON 往返只有几毫秒，晚挂就漏掉 spawn 包。
2. 不能只按名字找实体：曾选中一只 87 格外的旧鸡，打 15 次它一点血不掉。
   现在先 `kill @e[type=Chicken,r=24]`，再 summon，并只认 8 格内的。
3. 找到后要 RCON `tp` 到它旁边 1.2 格再打。

### 18.6 使用物品

`activateItem()` 在 1.7（`useItemWithBlockPlace`）走 `block_place`：
`location = (-1, 255, -1)`（`position_ibi` 的 y 是 u8，-1 要写成 255）、
`direction = -1`、`cursor` 全 0。`deactivateItem()` 走 `block_dig status 5`。

验收（`npm run action-smoke`）：

```
✓ 重连后生成于 (20.5, 75.0, 20.5) gamemode survival
  挖掘 minecraft:sand（硬度 0.5）预计 750ms，实际 1135ms → minecraft:air
✓ 生存挖掘通过
  贴近后距离 2.11
✓ 看到实体 Chicken id=2395 距离 2.11
  攻击 5 次 → 实体已消失
✓ 攻击实体通过
  使用 questbook:ItemQuestBook → usingHeldItem=true，释放后 false
✓ 使用物品通过
✓ 动作层冒烟通过
```

## 十九、2026-11-25：合成与熔炉（窗口布局 + 事务假拒绝）

### 19.1 1.7.10 的 `open_window` 只带数字类型

```
packet_open_window = { windowId u8, inventoryType u8, windowTitle string,
                       slotCount u8, useProvidedTitle bool,
                       entityId switch(inventoryType == 11) }
```

`inventoryType` 是**数字**：0 箱子 / 1 工作台 / 2 熔炉 / 3 发射器 / 4 附魔台 …

`prismarine-windows` 靠**类型名**决定布局，喂数字就退回「通用容器」：
`createWindow(1, 1, 'Crafting', 46)` 会造出 **82** 个槽、`inventoryStart=46`，
于是每一次 `window_click` 都点错格子（服务器静默不理）。

修法：`packages/mineflayer-fork/lib/gtnh/windows.js` 的 `createGtnhWindow()` 先把数字翻成名字
（`1 → 'minecraft:crafting_table'`、`2 → 'minecraft:furnace'`、`0 → 'minecraft:chest'` 并用
`slotCount - 36` 当 storage 槽数），再用 `fixWindowLayout()` 覆盖布局。

### 19.2 backhand 让玩家窗口变成 46 槽

`backhand` 加了副手槽，所以 1.7.10 的玩家窗口是 **46 槽**（原版 45）：

```
0 合成结果 / 1-4 合成格 / 5-8 护甲 / 9-35 主背包 / 36-44 快捷栏 / 45 副手
```

`prismarine-windows` 的 `minecraft:inventory` 建出来只有 45 槽、`inventoryEnd=45`，
服务端把物品塞进副手（45）时 `bot.inventory.items()` 看不见 —— 合成产物落进 45 号槽后
「服务器有、本地没有」。修法同上：玩家窗口补到 46 槽并把 `inventoryEnd` 设成 46。

### 19.3 `accepted=false` 不等于点击没执行

GTNH 的 `window_click` 在两种情况下回 `transaction accepted=false`：

1. 隐式窗口（ModularUI2 的 GT 机器窗口，见第十六节）本身计数器不同源；
2. **我们声明的 `item`（clickedItem）与服务端槽里的物品不完全相等**。

第 2 条的典型触发点就是工作台的结果槽：客户端按 `minecraft-data` 的配方算出
`log → planks x4`，而 GTNH 的实际配方是 **x2**，于是我们发出去的 `item` 是 `planks x4`，
服务端比对失败、回 `accepted=false` —— **但点击照样执行**，随后服务端会补一帧
`window_items` 全量重同步。

修法：`lib/plugins/inventory.js` 里对 1.7 放宽（`bot.gtnhLenientTransactions !== false` 时）
不抛错，只发 `transactionMismatch` 事件并等 250ms 让重同步落地；
调用方以 `window_items`/背包内容为准，而不是以事务旗标为准。

### 19.4 物品尾字节：写 `count`（不是 0）

早期实验里 `window_click` 用 `gtnhFlag=0` 能过、用 `count` 被拒，于是误判成「点击必须写 0」。
实际上是 **19.3 的假拒绝**在干扰判断。定论：

- S→C 与 C→S **都写 `count`**（`lib/gtnh/items.js` 的 `toNotch` 里 `gtnhFlag = itemCount`）；
- 空槽仍然只有 4 字节（`blockId = -1`，后面没有 count/damage/nbt/flag）；
- 顺带发现 `set_creative_slot` 的尾字节也被服务端当成 **count** 用：
  写 `itemCount: 1, gtnhFlag: 64` 就会真的造出 **64 个** —— 这是绕过
  「创意模式 count 恒被归一成 1」的唯一办法。

### 19.5 GTNH 的原版熔炉没有「沙 → 玻璃」

`minecraft:sand` 放进熔炉完全不烧（`testforblock lit_furnace` 失败、产物槽空、煤不掉），
而 `minecraft:cobblestone → minecraft:stone`、`minecraft:iron_ore → minecraft:iron_ingot`
都在 12 秒内正常出产物。所以验收用例用铁矿石，不要用沙子。

### 19.6 验收

```
$ npm --workspace mineflayer-fork run craft-smoke
✓ 生成于 (20.5, 76.62, 20.5)
  工作台 (22, 75, 20) type=58 name=minecraft:crafting_table
  配方：17x-1 5x4 → 5x4
  合成耗时 1539ms
✓ 合成出 planks x8
✓ 工作台窗口已关闭
✓ 合成冒烟通过

$ npm --workspace mineflayer-fork run furnace-smoke
✓ 生成于 (20.5, 76.62, 20.5)
  熔炉 22 75 20 type=61 name=minecraft:furnace
  窗口 type=minecraft:furnace slots=39 invStart=3
  输入槽=iron_ore 燃料槽=null
  产物槽=iron_ingot x1
  ✓ 背包出现 iron_ingot x1@44
✓ 熔炉冒烟通过
```

两个工具都是「关窗再开窗」按服务器真相判定，不看本地模型。

## 二十、2026-11-25：丢弃物品与吃食物

两者都不需要新的线格式补丁，但各有一个「不看本地模型就会被骗」的点。

### 20.1 丢弃 = `window_click` 点到窗口外

`bot.tossStack(item)` 就是「点起物品 → 点 -999 格（窗口外）」：

```
clickWindow(item.slot, 0, 0)   // 拿起
clickWindow(-999, 0, 0)        // 丢出窗口
```

服务器接受后背包立刻少一格，并在玩家脚下生成一个 `spawn_entity type=2`（Item）实体。
判定丢成功要看 **脚边出现 Item 实体**，不能只看背包——背包空了也可能只是被别的逻辑吃掉。

### 20.2 吃食物 = `block_place(-1,-1,-1)` + `entity_status 9`

1.7 没有独立的 `use_item` 包，「使用手上的物品」就是 `block_place`，坐标 -1/-1/-1、
面 -1（`position_ibi` 的 y 是 u8，写成 255）、光标全 0。

服务器用 **`entity_status` 的 `entityStatus: 9`** 表示「用完了」（1.61 秒后），
同时发 `update_health`（饥饿值回升）和 `set_slot`（数量 -1）。客户端还会收到
`animation` 的 `animation: 3`（吃东西动画）。

`mineflayer` 的 `bot.consume()` 本来就等 `entity_status 9`，所以 1.7 上不用改代码，
只要保证：

1. 手持食物、饥饿值 < 20（满饥饿时服务器直接忽略，客户端自己抛 `Food is full`）；
2. 客户端视角的 gamemode 是生存（`consume()` 只在非创造时才检查饥饿值）。

调试期的坑：`/gamemode` 变更**不会通知已登录客户端**，所以「服务端切生存、客户端仍以为创造」
是正常现象——反过来想用 `bot.food` 判断饥饿时，要等 `update_health` 到达（刚 spawn 时是 `undefined`）。

### 20.3 验收

```
$ npm --workspace mineflayer-fork run drop-eat-smoke
✓ 生成于 (19, 76, 19)
  丢弃前：dirt x5 @37
  ✓ 丢弃物品通过（脚边掉落物 1 个，背包已清空）
  等饥饿值掉到 18 以下…
  开始吃：food=17 面包 x4
  ✓ 吃东西通过（food 17 → 18，面包 4 → 3）
✓ 丢弃 + 吃食物冒烟通过
```

饥饿值用 `/effect <player> 17 300 5` 制造（1.7 的饥饿效果 id 是 17），
从 20 掉到 18 大约 7 秒，掉到 11 约 20 秒。

## 二十一、矿辞与配方数据源（Java agent 注入）

### 21.1 走过的死路（别重走）

| 路线 | 结果 |
| --- | --- |
| CraftTweaker `.zs` 脚本 | 服务端运行时 API 比 jar 里旧：`oreDict.get/getEntries`、`<oreDict:…>`、`recipes.getAll` 全不认，`for x in List` 不支持迭代 —— 只有 `print("字面量")` 能用 |
| `/dumpOredict`（IguanaTweaks） | 只写 56280 行**矿辞名**，没有物品 id |
| `/dumpregistry`（bdlib） | 117934 行 `modid:name`，没有数字 id |
| `/prltf <file>`（bartworks） | 只导原版 `CraftingManager`，且要求玩家 sender —— RCON 执行只会报 `An unknown error occurred` |
| `/recipeid dump`（NEI） | 命令**只注册在客户端**，服务端不认 |

### 21.2 真正的做法：Attach 一个 Java agent

服务器是我们自己启的（`javaw` PID 可查），直接用 JDK 的 attach 机制注入：

```bash
# 查 PID
powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='javaw.exe'\").ProcessId"
# 注入（AgentMain 用 com.sun.tools.attach.VirtualMachine，JDK 21 自带 jdk.attach 模块）
java -cp build AgentMain <pid> <agent.jar> <输出目录>
```

`agentmain(String args, Instrumentation inst)` 里用 `inst.getAllLoadedClasses()` 按名字取类，
**全部走反射**，不依赖编译期类路径。

### 21.3 反射时真正要用的名字

运行时被 FML 重映射成 **SRG 名**（`func_/field_`），Forge 自己的类则是明文名：

| 目标 | 名字 |
| --- | --- |
| 矿辞 | `net.minecraftforge.oredict.OreDictionary.getOreNames()` / `getOres(String)`（明文） |
| 配方表 | `net.minecraft.item.crafting.CraftingManager.func_77594_a()`（getInstance）→ `func_77592_b()`（getRecipeList） |
| 配方输出 | `IRecipe.func_77571_b()` |
| 有序配方 | `ShapedRecipes.field_77576_b`（宽）/ `field_77577_c`（高）/ `field_77574_d`（`ItemStack[]`） |
| 熔炉 | `FurnaceRecipes.func_77602_a()`（smelting）→ `func_77599_b()`（getSmeltingList，`Map<ItemStack,ItemStack>`） |
| 物品栈 | `ItemStack.func_77973_b()`（getItem）/ `field_77994_a`（数量）/ `field_77991_e`（damage） |
| 物品 id | `Item.func_150891_b(Item)` |
| 物品名 | `Item` 的 `field_150901_e`（RegistryNamespaced）→ `func_148750_c(item)` |

物品名与 FML 注册表**完全一致**（4750/4750 命中），所以 Node 侧可以直接拿名字当 key。

### 21.4 导出规模

```
矿辞 56279 条（其中 43959 条有物品），合成配方 10233 条，熔炉配方 9683 条
```

- GTNH 把**所有无序配方都转成了 `ShapedRecipes`**（导出的 shapeless = 0 条），所以只处理 shaped 也不丢数据。
- 矿辞里 `metadata = 32767`（`OreDictionary.WILDCARD_VALUE`）表示「任何 damage」，查询/匹配时要当通配处理。

### 21.5 落地

- agent 源码：`packages/gtnh-data/tools/jmx/src/{DumpAgent,AgentMain}.java`，构建产物 `dump.jar`。
- 原始导出：`packages/gtnh-data/data/raw/gtnh-2.9.0-server/gtnh-dump.jsonl`（10MB）。
- 转换：`node tools/build-recipes.js` → `data/recipes/{oredict,crafting,smelting,meta}.json`（3MB）。
- 查询 API：`packages/gtnh-data/src/recipes.js` 的 `RecipeBook`（`ore/oresOf/matchesOre/craftingFor/smeltFor/ingredientAccepts`）。
- bot 侧：`packages/mineflayer-fork/lib/gtnh/recipes.js` 的 `attachRecipes(bot)` →
  `bot.gtnhRecipes`、`bot.oreItems(name)`、`bot.oresOf(id,meta)`、`bot.gtnhRecipesFor(id,meta)`、`bot.gtnhSmeltingFor(id,meta)`。
  另有 `toMineflayerRecipe()` 把 GTNH 配方转成 mineflayer 的 `{inShape,result,delta,requiresTable}`。

### 21.6 验收

```
$ node tools/recipes-smoke.js
矿辞 56279 条 / 合成配方 10233 条 / 熔炉配方 9683 条
  plankWood 含 83 种物品，前 3: [[5,32767],[246,6],[246,7]]
  物品 5:0(minecraft:planks) 属于矿辞: ["plankWood"]
  熔炉 15:0(iron_ore) -> {"out":[265,0],"count":1}
✓ 矿辞/配方冒烟通过
```

**限制**：这只覆盖原版合成台 + 熔炉。GT 机器配方（`RecipeMap`）与 NEI 的合成表在服务端是另一套数据结构，
要导还需要遍历 `gregtech.api.util.GTRecipe` 的各 RecipeMap —— 后续再做。

## 二十二、GT 机器配方（RecipeMap 导出，NEI 的 GT 页面就是它）

### 22.1 为什么不是「读 NEI 的文件」

NEI 没有磁盘上的配方数据库：它的每一页都是**运行时**由各 mod 的 `IRecipeHandler` 现场生成的，
客户端 NEI 与服务端用的是同一批注册表。所以「读 NEI」= 读 NEI 渲染所依据的那些数据结构。
对 GT 而言那就是 `gregtech.api.recipe.RecipeMap` —— 在服务端内存里完整存在。

（NEI 自己的 `codechicken/nei/config/*Dumper` 只是配置/物品面板的 dump，不含配方。）

### 22.2 结构（javap + 反射确认）

```
RecipeMap.ALL_RECIPE_MAPS : Map<String, RecipeMap>     // 静态，136 个
RecipeMap.unlocalizedName : String                     // 'gt.recipe.macerator'
RecipeMap.getAllRecipes() : Collection<GTRecipe>
GTRecipe.mInputs / mOutputs            : ItemStack[]
GTRecipe.mFluidInputs / mFluidOutputs  : FluidStack[]
GTRecipe.mDuration : int   mEUt : int
GTRecipe.mHidden / mFakeRecipe : boolean   // 隐藏/占位配方，导出时过滤
```

### 22.3 导出规模（一次 attach，3.3 秒）

```
172 个 RecipeMap（其中 136 个有可见配方），175689 条可见配方
最大的几个：fluidsolidifier 28895 / macerator 24980 / extruder 13457 / hammer 13015 /
            fluidextractor 11212 / alloysmelter 10323 / assembler 10143 / arcfurnace 10106 / cuttingsaw 9309
```

导出后 JSONL 50MB，gzip 后 **1.7MB**，解析 0.5 秒。

### 22.4 落地

- agent：`packages/gtnh-data/tools/jmx/src/DumpGt.java`（`RecipeMap.ALL_RECIPE_MAPS` → 每条 GTRecipe 取字段，跳过 hidden/fake）
- 数据：`packages/gtnh-data/data/gt/gt-recipes.jsonl.gz`
- API：`packages/gtnh-data/src/gt-recipes.js` 的 `GtRecipes`（`forMap / forOutput / forInput / forFluid / mapNames / countFor`）
- bot：`bot.gtRecipesForOutput(id,meta)`、`bot.gtRecipesForInput(id,meta)`、`bot.gtRecipesForFluid(name)`、`bot.gtRecipeMaps()`（首次访问才加载）

### 22.5 用法示例

```
$ node tools/recipes-smoke.js
GT 配方：136 个 RecipeMap / 175689 条配方
  研磨机样例: [{"id":3027,"name":"gregtech:gt.blockframes","meta":610,"count":1}]
              -> [{"id":7639,"name":"gregtech:gt.metaitem.01","meta":2610,"count":2}] (16t, 4EU/t)
```

即「要做出 X，用哪台机器、什么原料、多少 EU/t、多少 tick」都能查。

### 22.6 注意（用户提醒 + 实测经验）

- **GT 机器淋雨会起火甚至爆炸**：`BaseMetaTileEntity` 在雨天 detectRain 后走 `doExplosion` 路径。
  布置机器要盖顶——bot 建工厂时别把机器裸放在露天。
- GT 的「合成」大多不是合成台，而是**工具 + 机器**（锤子成形、切割锯、组装机…）。
  `bot.recipesFor`（原版合成台/熔炉）只覆盖其中一小部分，真正的查询入口是 `bot.gtRecipesForOutput`。
- 依赖矿辞的配方：这里的输入是**具体 ItemStack**（GT 在注册时就固化成了某个物品），
  所以查「能不能用别的粉代替」要配合 `bot.gtRecipesForInput` + 矿辞反查 `bot.oresOf`。

## 二十三、2026-11-25：非 GT 的 mod 配方（逐 mod 导出）

NEI 里除了 GT 的 RecipeMap 页面，还有各 mod 自己的配方页。它们没有磁盘数据文件，只在服务端内存里，
所以每个 mod 都得单独找到「配方表在哪个类的哪个字段」，再用 agent 反射导出。

### 23.1 已导出的六个 mod

| mod | kind | 条数 | 入口 |
| --- | --- | --- | --- |
| Thaumcraft | arcane_shaped / arcane_shapeless / crucible / infusion / infusion_enchant / infusion_other | 586 / 35 / 777 / 652 / 50 / 80 | `ThaumcraftApi.getCraftingRecipes()`（一个 List 混 5 种类型） |
| Forestry | carpenter / centrifuge / squeezer / fermenter / still / moistener / fabricator / fabricator_smelting | 418 / 154 / 280 / 314 / 3 / 7 / 93 / 11 | `RecipeManagers` 的 8 个 static 字段 |
| Railcraft | rolling_shaped / coke_oven / blast_furnace | 19 / 164 / 163 | `RailcraftCraftingManager.{rollingMachine,cokeOven,blastFurnace}` 的 `getRecipeList()/getRecipes()` |
| TConstruct | melting / alloy / drying_rack | 956 / 8 / 10 | `Smeltery.instance` 的私有 `smeltingList`/`alloys`；`DryingRackRecipes.recipes` |
| Botania | petal / rune_altar / mana_infusion / elven_trade / brew / pure_daisy | 45 / 49 / 165 / 18 / 21 / 6 | `BotaniaAPI` 的 static List |
| Blood Magic | alchemy / altar / binding / unbinding | 60 / 64 / 19 / 19 | `AlchemyRecipeRegistry.recipes` / `AltarRecipeRegistry.altarRecipes` / `BindingRegistry` / `UnbindingRegistry` |

合计 **5246 条**，落在 `packages/gtnh-data/data/recipes/mod-recipes.json`（2.3MB，含 `byOutput` 索引）。

### 23.2 逐 mod 的踩坑（都是「导出全空」级）

- **`RailcraftCraftingManager.rockCrusher.getRecipes()` 返回 0 条**：滚压机拿到的是
  `net.minecraftforge.oredict.ShapedOreRecipe`，它**不继承** `ShapedRecipes`，字段是它自己的
  `output` / `input`(Object[]) / `width` / `height`（不是 `field_77575_e` 那套 SRG 名）。
  用 `cn.endsWith("ShapedRecipes")` 判类型会全部掉进 other 分支。
- **ShapedOreRecipe 的 `input` 每格是 `List<ItemStack>`**（矿辞的展开结果），直接 `stack()` 会得到 null，
  必须逐格展开成「备选数组」。
- **Botania 的 `RecipeManaInfusion` 只有一个 `input` 字段**（不是 `inputs` 列表），
  `RecipePetals`/`RecipeElvenTrade` 才是 `lists`；取输入要 `getInputs` → `getInput` → `inputs` → `input` 四级兜底。
- **Blood Magic 的字段名与直觉不同**：`AlchemyRecipe` 是 `output`/`recipe`/`bloodOrbLevel`/`amountNeeded`；
  `AltarRecipe` 是 `requiredItem`/`result`/`minTier`/`liquidRequired`；`BindingRecipe` 是 `requiredItem`/`outputItem`。
- **TConstruct 干物架的配方类字段是 `input`/`result`/`time`**（不是 `getInput()/getOutput()`），
  而且 `result` 要走 `getResult()`。
- **`ProbeInv` 探针**（`tools/jmx/src/ProbeInv*.java`）是按类名前缀列「容器型 static 字段」的通用探针，
  找下一个 mod 的配方表时先跑它，比盲翻 jar 快得多。注意：服务端加载了客户端类
  （如 `net.minecraft.client.model.ModelBiped`），对它 `getDeclaredFields()` 会抛
  `NoClassDefFoundError`，必须 try/catch 跳过。

### 23.3 数据格式归一化

Java 输出的 JSONL 有旧（`in` 是扁平 stack 列表）和新（可能嵌套）两种，统一用
`packages/gtnh-data/tools/build-mod-recipes.js` 归一化：

```
{
  mod, kind,
  out: [{id,name,meta,count}],
  ins: [ [备选...], ... ]     // 每种材料一格，备选 = {id,name,meta,count} | {ore:"ingotIron"}
  fluidIn: [{fluid,amount}], fluidOut: [...],
  time: null | number,
  extra: { research, aspects, mana, tier, lp, temperature, ... }
}
```

老格式的 `research` / `aspects` / `w` / `h` 会被搬进 `extra`（Thaumcraft 的 652 条 infusion 全都有 research）。

### 23.4 bot 侧 API（`packages/mineflayer-fork/lib/gtnh/recipes.js`）

```js
bot.modRecipeMods()            // ['bloodmagic','botania','forestry','railcraft','tconstruct','thaumcraft']
bot.modRecipeKinds('botania')  // ['brew','elven_trade','mana_infusion','petal','pure_daisy','rune_altar']
bot.modRecipesFor(6079)        // 产出符文的配方（47 条，带 extra.mana）
bot.modRecipesUsing(265)       // 用铁锭当原料的配方
bot.modRecipesByOre('flowerWhite')
bot.modRecipeSummary()
```

数据是懒加载（第一次访问才解析 2.3MB JSON）。

### 23.5 验收

```
mod 配方：5246 条（thaumcraft 2180 / forestry 1280 / railcraft 346 / tconstruct 974 / botania 304 / bloodmagic 162）
  符文样例: [["powderMana"],["plateStainlessSteel"],["minecraft:dye"],["minecraft:reeds"],["minecraft:fishing_rod"]]
            -> [{"id":6079,"name":"Botania:rune","meta":0,"count":2}] (mana 10000)
✓ 矿辞/配方冒烟通过
```

全仓 **155 个测试全过**。

### 23.6 还没导出的

AE2（`AEApi.instance().registries().grinder()/inscriber()` 是实例注册表，不是 static 集合）、
EnderIO（SAG mill / alloy smelter 的 `RecipeManager` 实例）、IC2（`Recipes` 静态但结构不同）、
Galacticraft、Witchery、Thaumic Tinkerer 等附属。方法同上：先 `ProbeInv` 定位，再写一个 dumper。

## 二十四、2026-11-25：AE2 / EnderIO / IC2 的配方（实例注册表）

前六个 mod 的配方表都是 `static` 集合，`ProbeInv` 一眼就能看到。这一批不一样：
AE2 / EnderIO 的配方表挂在**单例实例**里，得更进一步摸。

### 24.1 三个 mod 的入口与条数

| mod | kind | 条数 | 入口 |
| --- | --- | --- | --- |
| AE2 | inscriber | 12 | `AEApi.instance().registries().inscriber().getRecipes()` |
| AE2 | grinder | **0** | `.grinder().getRecipes()`（GTNH 把研磨交给 GT 研磨机） |
| EnderIO | sagmill | 1663 | `CrusherRecipeManager.getInstance().getRecipes()` |
| EnderIO | alloysmelter | 11 | `AlloyRecipeManager.getInstance().getRecipes()` |
| EnderIO | sliceandsplice | 7 | `SliceAndSpliceRecipeManager.getInstance().getRecipes()` |
| EnderIO | vat | 8 | `VatRecipeManager.getInstance().getRecipes()` |
| IC2 | machine_metalformerCutting | 1 | `ic2.api.recipe.Recipes.metalformerCutting.getRecipes()` |
| IC2 | machine_matterAmplifier | 2 | `Recipes.matterAmplifier.getRecipes()` |
| IC2 | 其余 10 个机器 | **0** | 见下 |

合计新增 **1704 条**，总数 5246 → **6950**。

### 24.2 IC2 / AE2 的「0 条」是真的

用 `ProbeIC2` 探针直接读 `ic2.api.recipe.Recipes.<field>` 的实例字段（`BasicMachineRecipeManager.recipes`）：

```
macerator     -> Map(0)      extractor  -> Map(0)     compressor -> Map(0)
centrifuge    -> Map(0)      blockcutter-> Map(0)     oreWashing -> Map(0)
metalformerCutting -> Map(1)                            ← 只有这一个有
```

GTNH 把 IC2 机器的配方**全部移除**（改用 GT 机器），AE2 的研磨机同理。
所以不要以为是导出失败 —— 是服务器里真的没有。

### 24.3 EnderIO 的两个坑

- **类没被加载**：EnderIO 的配方类在服务器启动时并不加载，`getAllLoadedClasses()` 里找不到。
  必须 `Class.forName(name, false, ItemStack.class.getClassLoader())`（`LaunchClassLoader`）现取。
  第一版 `findLoaded` 只查缓存 → `eio sagmill 类未加载`。
- **`getChances` 数组拼出 `[,1.0,0.1]`**：Java 侧拼 JSON 时没处理第一个元素 → 非法 JSON。
  改 `if (chanceOut.length() > 1) chanceOut.append(',')`。
- 输入用 `RecipeInput[]`，每项可能是 ItemStack 或 FluidStack；`getEquivelentInputs()` 给出矿辞展开的等价物，
  优先用它当备选数组。流体输入这一版丢弃（`ins` 里只剩物品格）。

### 24.4 归一化脚本的兼容

`build-mod-recipes.js` 现在读三个文件，且要同时认 `in`（老）与 `ins`（新）两个字段名 —— 漏了
`r.ins || r.in` 时，1704 条新配方全部 `ins:[]`（测试里 `sag.filter(r => r.ins.length)` 为 0 才暴露）。

### 24.5 验收

```
mod 配方：6950 条（thaumcraft 2180 / forestry 1280 / railcraft 346 / tconstruct 974 / botania 304 / bloodmagic 162 / ic2 3 / ae2 12 / enderio 1689）
✓ 九个 mod 都有配方
✓ EnderIO SAG 磨粉 1663 条
✓ AE2 压印器 12 条
  SAG 样例: ["appliedenergistics2:tile.OreQuartzCharged"] -> ["4631:1","7639:2516"] (2400 RF, 概率 [1,0.1])
  压印器样例: [["minecraft:redstone"]] -> ["4631:23"] (Press)
```

全仓 **158 个测试全过**。

## 二十五、2026-11-25：Galacticraft / Witchery 的配方（单例里的 ArrayList）

这一批的共同点：配方表不在 `static` 字段里，而在**单例的实例字段**里。

### 25.1 探针：ProbeLoad（按 jar + 类名正则强制加载）

`packages/gtnh-data/tools/jmx/src/ProbeLoad.java`（迭代到 `ProbeLoad2`），
args = `"<outFile>|<jarPath>|<classNameRegex>"`：

- 用 `JarFile` 列出类名，按正则筛（**跳过内部类** `$`）；
- `Class.forName(cn, false, ItemStack 的类加载器)` —— 必须是 LaunchClassLoader，否则
  Galacticraft/Witchery 的类根本加载不到（这也是早先按前缀扫 `getAllLoadedClasses()` 全空的原因）；
- 再列 static 字段里的容器（`Map(n)` / `Collection(n)` / `Array(n)`）。

两个自身 bug（都踩过）：
1. args 用 `\|` 切分成三段时，**类名正则里的 `|` 会被切碎** → `PatternSyntaxException`。改成 `split("\\|", 3)`。
2. 探针类被 JVM 缓存：改了代码必须换类名（ProbeLoad → ProbeLoad2），否则跑的还是旧逻辑。

### 25.2 Galacticraft（14 条）

| 配方页 | 入口 | 条数 |
| --- | --- | --- |
| 电路制造机 | `CircuitFabricatorRecipes.recipes`（`HashMap<ItemStack[], ItemStack>`，private static） | 9 |
| 压缩机 | `CompressorRecipes.recipes`（`List<IRecipe>`，private static） | 2 |
| 压缩机（冒险扩展） | `CompressorRecipes.recipesAdventure` | 3 |

压缩机的配方是标准 `ShapedRecipes`/`ShapelessOreRecipe`，复用原版那套字段读法即可。

### 25.3 Witchery（51 条）

三个单例都是 `private static final INSTANCE` + `public static X instance()`，配方在
`public final ArrayList<...Recipe> recipes` 里：

| 配方页 | 入口 | 条目字段 | 条数 |
| --- | --- | --- | --- |
| 蒸馏塔 | `DistilleryRecipes.instance().recipes` | `inputs[] / jars / outputs[]` | 9 |
| 坩埚 | `KettleRecipes.instance().recipes` | `inputs[] / output / power / inBook` | 38 |
| 纺车 | `SpinningRecipes.instance().recipes` | `fibre / modifiers[] / result` | 4 |

- 坑 1：`call(c, "instance")` 把 `Class` 当 receiver 传给静态方法 → `IllegalAccessException`
  被吞成 null，三条全报 `NullPointerException: List.iterator() because '<local1>' is null`。
  静态方法必须 **`m.invoke(null)`**。
- 坑 2：物品 id 用 `Item.func_150891_b(Item)` —— 这是**静态单参**方法，早期按实例零参调用
  一律返回 0，于是所有配方都是 `{"id":0,"name":"minecraft:..."}`（名字对、id 全 0）。

### 25.4 Thaumic Tinkerer 不需要单独导

它的内容全是 **Thaumcraft 的注魔/奥术配方**，早在 `ThaumcraftApi.getCraftingRecipes()` 里就抓住了：
数据里 `ThaumicTinkerer:*` 作为产物出现 122 条（注魔 652 条内）。所以「逐 mod」到这一步只需要补
真正自建注册表的 mod。

### 25.5 验收

```
mod 配方：7049 条（thaumcraft 2180 / forestry 1280 / railcraft 346 / tconstruct 974
                  / botania 304 / bloodmagic 162 / enderio 1689 / ae2 12 / ic2 3
                  / galacticraft 14 / witchery 85）
✓ Galacticraft：电路制造机 9 / 压缩机 2 / 冒险 3
✓ Witchery：蒸馏 9 / 坩埚 38 / 纺车 4
  电路制造机样例: 9x GalacticraftCore:item.basicItem:12 <- diamond + 2x EnderIO:itemMaterial + redstone + dye:4
  坩埚样例: 3x witchery:ingredient:57 <- vine + red_mushroom + brown_mushroom + ingredient:25 + wheat + ingredient:35
```

全仓 **161 个测试全过**。

### 25.6 火盆与酿造仪式（Witchery 补完）

| 配方页 | 入口 | 条目 | 条数 |
| --- | --- | --- | --- |
| 火盆 | `BrazierRecipes.instance().recipes` | `items[] / burnTicks / inBook / unlocalizedName` | 8 |
| 酿造仪式 | `WitcheryBrewRegistry.INSTANCE.getRecipes()` → 每项 `getExpandedRecipes()` | `result / ingredients[]` | 26 |

- 火盆的「产物」是效果不是物品，所以 `out` 为空数组，效果名放 `extra.effect`（`witchery.brazier.spectre` 这类），
  同时带 `burnTicks`（600）与 `inBook`。查询侧用 `byInput` 反查食材，不要指望 `byOutput`。
- `WitcheryBrewRegistry` 的实例字段是 **private** 的 `public static final INSTANCE`，没有 `instance()` 方法；
  只能遍历 `getDeclaredFields()` 找「static 且类型等于自身」的那个字段再 `get(null)`。
- **女巫烤炉没有独立配方表**：`TileEntityWitchesOven` 用的是原版 `FurnaceRecipes`（已在「熔炉 9683 条」里），
  副产品（`FUNNEL_CHANCE` 等概率）是写死在 `cookItem` 里的判断，没有可导出的数据 —— 所以烤炉不用单独导。

### 25.7 多份 dump 的去重（踩坑）

后一轮 dump 又把前一轮的 kind 带了一遍（`mods4` 里仍有蒸馏/坩埚/纺车）。在 `build-mod-recipes.js` 里做去重时：

- 一开始按 `[mod, kind, out, ins]` 做全量去重 → **误删 36 条真实配方**（Botania 魔力灌注、Railcraft 滚压等
  只差 `mana`/`time`/`extra` 的条目被判成重复：botania 304→294、railcraft 346→339、tconstruct 974→967）。
- 正确做法：1) key 必须包含 `fluidIn/fluidOut/time/extra`；2) **只做跨文件去重** —— 同一文件内部的完全重复要保留
  （那可能是 mod 真的注册了两次）。改完总数 7049（6950 + Galacticraft 14 + Witchery 85），各 mod 数量与去重前一致。

## 二十六、2026-11-25：TConstruct 浇筑（浇铸台 / 浇铸盆）

### 26.1 入口

| 配方页 | 入口 | 容器 |
| --- | --- | --- |
| 浇铸台 `casting_table` | `tconstruct.library.TConstructRegistry.getTableCasting()` | `LiquidCasting` 的 **private `ArrayList<CastingRecipe> casts`** |
| 浇铸盆 `casting_basin` | `TConstructRegistry.getBasinCasting()` | 同上（另一个 `LiquidCasting` 实例） |

`CastingRecipe` 的字段：`output`(ItemStack) / `castingMetal`(FluidStack) / `cast`(ItemStack，可为 **null**) /
`consumeCast`(boolean) / `coolTime`(int)。

- 走 `TConstructRegistry` 的两个静态 getter，而不是 `NEI` 的 `RecipeHandlerCastingBase.arecipes` ——
  后者是**客户端 NEI 插件**里的缓存列表（`plugins/nei/`），服务端根本不会加载。
- 无铸模的配方（直接倒金属成锭/块）`cast == null`，归一化后该空格子被丢掉 → `ins: []`。

### 26.2 数据

`DumpMods21`（jar `mods22.jar`）→ `data/raw/gtnh-2.9.0-server/mod-recipes-mods5.jsonl`，共 **1104 条**：

| kind | 条数 |
| --- | --- |
| `casting_table` | 1088 |
| `casting_basin` | 16 |

`build-mod-recipes.js` 额外做了一件事：把 `extra.fluid` 提升进 `fluidIn`（浇筑的金属是流体输入），
这样 `book.byFluid('molten.brass')` 这类查询也能命中浇筑配方。

样例：

```json
{"mod":"tconstruct","kind":"casting_table",
 "out":[{"id":4478,"name":"TConstruct:blankPattern","meta":1,"count":1}],
 "ins":[],"fluidIn":[{"fluid":"molten.brass","amount":144}],
 "extra":{"fluid":{"fluid":"molten.brass","amount":144},"consumeCast":false,"coolTime":80}}
```

### 26.3 全量

`packages/gtnh-data/data/recipes/mod-recipes.json` → **8153 条 / 3434KB**，十一个 mod：

| mod | 条数 |
| --- | --- |
| thaumcraft | 2180 |
| tconstruct | 2078 |
| enderio | 1689 |
| forestry | 1280 |
| railcraft | 346 |
| botania | 304 |
| bloodmagic | 162 |
| witchery | 85 |
| galacticraft | 14 |
| ae2 | 12 |
| ic2 | 3 |

冒烟：`node packages/mineflayer-fork/tools/recipes-smoke.js` → `✓ TConstruct 浇筑台 1088 条` / `✓ 浇筑盆 16 条`。

全仓 **162 个测试全过**（gtnh-data 47 / prismarine-chunk-1.7 7 / protocol-fml 43 / mineflayer-gtnh 32 / mineflayer-fork 33）。

### 26.4 TConstruct 工具组装（53 条）

NEI 的「工具组装」页对应 `tconstruct.library.crafting.ToolBuilder.instance.combos`（`List<ToolRecipe>`，
**public 字段**，53 条）。`ToolRecipe` 的字段是 protected 的 4 个 `LinkedList<Item>` + `ToolCore result`：
`headList / handleList / accessoryList / extraList`（同一格里的所有 Item 都是「可接受的部件」）。

- 输出 `out` 只有工具的 Item（没有 meta），`extra` 里按格给出部件名：
  `{"head":["TConstruct:pickaxeHead"],"handle":["TConstruct:toolRod"],"accessory":["TConstruct:binding"]}`。
- **反射取工具 id 会炸**：`ToolCore` 的实现类（`tconstruct.items.tools.*`）实现了客户端渲染接口，
  在专用服务端上 `getClass().getDeclaredMethods()` 会抛
  `NoClassDefFoundError: net/minecraft/client/renderer/texture/IIconRegister`。
  → dump 里对这类物品**只写 `id: -1` + 注册名**（名字靠遍历 `Item.field_150901_e` 注册表按对象身份反查，
  完全不触碰 ToolCore 类本身）。
- `build-mod-recipes.js` 因此多了一步**名字回填 id**：读
  `packages/protocol-fml/data/raw/local-fml-registry.json` 等注册表文件建 `name→id`，把 `id <= 0` 的物品补上
  （TConstruct:pickaxe → 4482）。53 条全部解析成功，`ins` 里部件 id 也都有值。

样例：

```json
{"mod":"tconstruct","kind":"tool_build",
 "out":[{"id":4482,"name":"TConstruct:pickaxe","meta":0,"count":1}],
 "ins":[[{"id":4503,"name":"TConstruct:pickaxeHead",...}],[{"id":4501,"name":"TConstruct:toolRod",...}],
        [{"id":4506,"name":"TConstruct:binding",...}]],
 "extra":{"head":["TConstruct:pickaxeHead"],"handle":["TConstruct:toolRod"],"accessory":["TConstruct:binding"]}}
```

全量 **8206 条 / 3460KB**（tconstruct 2131），全仓测试 **163 个**。

## 二十七、TConstruct 静态数据：熔炼温度 / 燃料 / 工具材料

`DumpMods27`（attach 到运行中的服务端）导出三块静态数据 → `data/raw/gtnh-2.9.0-server/tconstruct-data.jsonl`
→ `build-tconstruct.js` → `packages/gtnh-data/data/tconstruct/tconstruct.json`（179KB）
→ 加载器 `packages/gtnh-data/src/tconstruct.js`（`TConstructData` / `loadTConstruct`）。

### 27.1 数据来源与规模

| 数据 | 入口 | 条数 |
| --- | --- | --- |
| 熔炼（物品 → 流体 + 温度） | `Smeltery.instance.smeltingList` + `temperatureList` | 956 |
| 熔炉燃料 | `Smeltery.instance.smelteryFuels`（`Map<Fluid, Integer[]{power,duration}>`） | 4 |
| 工具材料 | `TConstructRegistry.toolMaterials`（`HashMap<Integer,ToolMaterial>`） | 184 |
| 弓材料 | `TConstructRegistry.bowMaterials` | 180 |
| 箭材料 | `TConstructRegistry.arrowMaterials` | 180 |

燃料只有四种：`lava`(1300/80)、`pyrotheum`(5000/70)、`ic2pahoehoelava`(3000/90)、`ic2hotcoolant`(900/55)。
`power` 就是熔炼温度上限，`duration` 是每 mB 的燃料消耗节奏。

### 27.2 `ToolMaterial` 字段（全部 public，直接反射）

`materialName` / `harvestLevel` / `durability` / `miningspeed` / `attack` / `handleModifier` /
`reinforced` / `stonebound` / `tipStyle` / `primaryColor` / `localizationString` / `displayName` / `ability`。

- **`miningspeed` 是 ×100 的整数**（`toolSpeed()` 直接返回原值）：Manyullyn 900 → 9.0，Cobalt 1100 → 11.0，Wood 150 → 1.5。
  加载器提供 `toolSpeed()` 做这个换算。
- `attack` 是 TiC 自己的小整数攻击值（Wood 1 / Iron 3 / Cobalt 4 / Manyullyn 5），
  最终伤害还要叠工具类型的基础值与强化。
- `handleModifier` 是手柄对耐久的倍率（Manyullyn 2.5），`stonebound`/`reinforced` 是特殊属性初值。

样例：

```
Manyullyn: harvestLevel 9, durability 900, miningSpeed 900(→9.0), attack 5, handleModifier 2.5
Cobalt:    harvestLevel 8, durability 600, miningSpeed 1100(→11.0), attack 4, handleModifier 1.75
Iron:      harvestLevel 3, durability 188, miningSpeed 600(→6.0), attack 3, handleModifier 1.2
Wood:      harvestLevel 0, durability 38, miningSpeed 150(→1.5), attack 1, handleModifier 1
```

### 27.3 熔炼：温度 + 流体

`melting` 表以 `"id:meta"` 为键：

```json
"3034:4019": {"id":3034,"name":"gregtech:gt.blockores2","meta":4019,"temp":400,
              "fluid":"aluminum.molten","amount":144}
```

温度区间从 75K（水类）到 4000+K（钨等），熔岩只有 1300K —— 所以「熔岩能不能熔这个」是一句实际有用的判断：

```js
const tc = loadTConstruct()
tc.temperatureFor(3034, 4019)          // 400
tc.meltingFor(3034, 4019).fluid        // 'aluminum.molten'
tc.canMeltWith('lava', 3034, 4019)     // true
```

### 27.4 bot API

`attachTconstruct(bot)`（`lib/gtnh/tconstruct.js`，在 `loader.js` 里紧接 `attachRecipes` 调用）：

```
bot.tconstruct                  // TConstructData 实例
bot.tconstructMaterial('manyullyn')     // 材料（名字大小写不敏感，也接受 id）
bot.tconstructMaterials()               // 184 种
bot.tconstructToolSpeed('manyullyn')    // 9
bot.tconstructMelting(3034, 4019)       // {temp, fluid, amount}
bot.tconstructMeltingFor({id, damage})  // 便利：直接吃 bot.items() 的条目
bot.tconstructFuel('lava')              // {power:1300, duration:80}
bot.tconstructFuels()
bot.tconstructBowMaterial('wood')
```

### 27.5 踩坑

1. **`itemName()` 会抛 `NoClassDefFoundError: IIconRegister`** —— 和工具组装同一个坑：
   熔炼表里有 GT 的「带渲染的物品」，第一次跑 `tconMelting` 在 424 条处整批崩掉（只写出半份文件）。
   修法：`wrapperJson()` 内所有反射单独 try/catch，名字兜底走「注册表身份反查」，循环里逐条容错
   （最终 `ok=956 bad=0`）。
2. **`note()` 会把错误当成一行数据写进输出**（`{"error":"tcon-melting",...}`），
   `build-tconstruct.js` 里要么过滤 `r.kind` 为空的行，要么把 `note()` 改成只写 stderr —— 现在是后者。
3. `toolSpeed()` 不做换算（`javap -c` 确认直接 `ireturn miningspeed`），换算必须在 JS 侧做。

### 27.6 验收

```
TConstruct：材料 184 种，熔炼 956 条，燃料 4 种
  Manyullyn: 耐久 900 / 挖掘速度 9 / 攻击 5 / 采集等级 9
  铝矿熔炼: 400K → aluminum.molten x144（熔岩 1300K 可熔）
✓ TConstruct 材料 >= 150 种
✓ TConstruct 熔炼温度可查
✓ TConstruct 熔岩燃料 power 1300
✓ Manyullyn 耐久 900
```

全仓测试 **174 个**（gtnh-data 56 / prismarine-chunk-1.7 7 / protocol-fml 43 / mineflayer-gtnh 32 / mineflayer-fork 36）。

---

## 二十八、TConstruct 造镐 / 造锤（真实链路）与锤的 AoE

### 28.1 整条链路

```
pattern(woodPattern 4480, meta=图案号) + 材料
  → Part Builder（ToolStationBlock meta 1，44 槽，invStart 8）
     槽 0 = pattern、槽 2 = 材料 → 产物在槽 4（**必须关窗重开才读得到**）
  → Tool Station（meta 0，40 槽，invStart 4）：槽 1 head / 槽 2 handle / 槽 3 accessory → 输出槽 0
  → Tool Forge（ToolForgeBlock meta 0，41 槽，invStart 5）：槽 1..4 四个部件 → 输出槽 0
```

- **图案 meta 表**（`tconstruct.tools.items.Pattern.patternName`）：1 rod、2 pickaxe、9 binding、
  14 largerod、16 largeplate、21 hammerhead、25 arrowhead。
- **材料 → 可用图案**：`flint(318)` 只能出 2/25；`stone(1)/cobble(4)` 出 21/16/14/9；
  `planks(5)` 只出 9；`obsidian(49)` 出 21/14/16；`bone/cactus/netherrack` 没注册，全不出。
- **金属部件不能在部件台削**（要走铸模浇筑）。
- 组装配方：`pickaxe = pickaxeHead + toolRod + binding`；`hammer = hammerHead + toughRod + heavyPlate ×2`。

### 28.2 两个工具本身的行为坑

1. **输出槽不同步**：工具站/部件台的输出槽不会实时推到客户端（我们自己兜底建的隐式窗口尤其明显），
   必须 `close` 再右键重开才能读到成品，然后在槽 0 上点一下拿起。
2. **石材组合是 TiC 的固有 bug**：agent 里直接调 `ToolBuilder.instance.buildTool(...)` 按材料 id 试，
   只有 `mid=1 (Stone)` 返回 null，其余 Wood/Flint/Obsidian/Iron 都 OK —— 所以「石头锤子造不出来」不是我们的问题。

### 28.3 工具 → 挖速（新代码）

TConstruct 工具的强度全在 NBT 的 `InfiTool` compound 里（`Head`/`Handle`/`HarvestLevel`/
`BaseDurability`/`BaseAttack`/`Broken`），材料号就是 `Head`：

```js
bot.tconstructToolInfo(tool)  // { head, handle, harvestLevel, durability, attack, material, speed }
bot.tconDigTime(block, tool)  // hardness * (canHarvest ? 1.5 : 5) / speed
bot.digTime = (b) => bot.tconDigTime(b) * 1000   // 覆盖 mineflayer 只认原版工具的实现
```

- 数据字段是 `miningSpeed`（大写 S），写成 `miningspeed` 会拿到 `undefined`。
- 原版 `block.harvestTools` 里是**镐的物品 id**，要映射成等级再比：
  `{270:0, 285:0, 271:1, 257:2, 258:3}`。

### 28.4 验收（`npm run tool-mine-smoke`）

同一面 3×3 石墙，镐 vs 锤：

```
镐 TConstruct:pickaxe（Flint 速度 4 等级 0）
  清空 9 块墙：9 次挥动 10755ms（1195ms/块），理论合计 5063ms
锤 TConstruct:hammer（Obsidian 速度 6.5 等级 5）
  清空 9 块墙：5 次挥动 7754ms（862ms/块），理论合计 1731ms

锤清空同一面墙耗时 7754ms vs 镐 10755ms → ✓ 锤更快
✓ 工具采矿对比通过
```

- 锤一次挥动连带破坏 3 块（3×3 面的一行），所以 9 块墙只要 5 下；镐要 9 下。
- 实测每下都有 ~700ms 的固定开销（发 `block_dig` → 等 `blockUpdate`），
  所以**理论那一列**（按材料速度算）才接近真人手感：锤 1731ms vs 镐 5063ms。

### 28.5 环境备忘

- `RCON tp` **不会**给新位置下发区块：必须 `tp` → 断开 → 重登，区块在登录时才有。
- GTNH 的 `/fill` 必须带玩家参数，造墙只能用逐块 `setblock`。
- 右键 TiC 方块要**同高度、≤4 格**，站高了点不出窗口（连原版箱子都不开）。

全仓测试 **176 个**（gtnh-data 56 / prismarine-chunk-1.7 7 / protocol-fml 43 / mineflayer-gtnh 32 / mineflayer-fork 38）。

## 二十九、TiC 冶炼：结构、控制器/水龙头朝向、浇筑链路（GTNH 2.9 实测）

### 29.1 冶炼炉结构（`SmelteryLogic`）
- 底面必须**实心焦黑砖**；每层外圈砖环（四角不校验）；**内部必须是空气**；控制器**同层至少一个焦黑储罐**；有且只有一个控制器。
- 窗口槽数 = `getBlockCapacity()` + 36 → **38 槽 = 2 层炉有效 / 36 槽 = 无效**（用这个判断结构对不对，不需要读服务端）。

### 29.2 控制器 / 水龙头必须由「玩家放置」写入朝向
- `SmelteryLogic.checkValidPlacement()` 的 tableswitch 只处理 `direction` 2/3/4/5，`default: return` → `setblock` 放的方块 `direction=0`，**永远不扫描结构**。
- `direction` 由放置时的点击面（`setDirection(int side)`）或 yaw 决定：2=+z、3=−z、4=+x、5=−x。要朝炉内，就**点朝内那一侧的面**。
- 水龙头同理：`FaucetLogic.activateFaucet()` 把坐标按 direction 平移一格去找 `IFluidHandler`（排液口），液体倒进**水龙头脚下**那格 → 排液口与水龙头必须**同高相邻**，水龙头脚下是浇筑台/盆。
- 排液口/水龙头有 `onBlockActivated`，直接右键会被吞；**潜行 + `block_place`** 才会走 `onItemUse`（`bot.setControlState('sneak', true)`）。

### 29.3 `block_place` 的 cursor 必须落在被点面上（曾导致「机器人放不了方块」）
- 服务端按 cursor 校验命中面，`cursorX/Y/Z` 全 8 会被当成「没打在面上」静默丢弃。
- 规则：+x→cursorX=16、−x→0、+z→cursorZ=16、−z→0、顶面→cursorY=16、底面→0，另两轴 8。
- 另外要求：站在实心地面上（掉到空中会超出 4 格 reach）、面朝目标（`bot.lookAt`）。

### 29.4 `tile_entity_data`（S35）比原版多 1 字节
- 真实布局：`position_isi + action(u8) + extra(u8) + i16 nbtLen + gzip`；原版缺 `extra`，于是 nbtLen 读成 0 → `zlib decompress failed`。
- 修法见 `packages/protocol-fml/src/index.js` 的 `GTNH_TE_PACKETS`；测试 `packages/protocol-fml/test/tile-entity.test.js` 用真实帧（水龙头 TE，坐标 5/80/−7）锁住。
- 修好之后才能读 `bot.blockEntities`：冶炼炉控制器 `{ValidStructure, Layers, MaxLiquid, Direction, Liquids:[{Amount, FluidName}]}`、水龙头 `{hasLiquid, Direction}`、浇筑台/盆 `{hasLiquid, Capacity, Items[], maxCastingDelay}`、储罐 `{amount, fluidName}`。

### 29.5 浇筑：台可用、盆的块铸造没打通
- **浇筑台（`SearedBlock` meta 0）可用**：手持金铸模（`TConstruct:metalPattern` meta=图案号，如 2 = 镐头）点一下放上，用 direction 指向排液口的水龙头点一下 → 台内 `hasLiquid:1`、`Capacity:144`，冷却后右键取出 **铁镐头 `TConstruct:pickaxeHead:2`** ✓。
- 铸模 id：`metalPattern`(4526) / `clayPattern`(4527)，meta 同图案表（2 镐头、14 大棒、16 大板、21 锤头）；`consumeCast:false`。
- **浇筑盆（meta 2）在本服被禁**：同一水龙头、同一位置，盆 `hasLiquid` 恒 0；把脚下换成焦黑储罐立刻能接 432mb → 水龙头/排液口/冶炼炉都正常，是 GTNH 关了盆的块铸造（用户确认）。要出锭/块就走**浇筑台 + 铸模**。
- **「熔炼停摆」的真相 = 结构容量**：`SmelteryLogic.getInventoryStackLimit() == 1`（每格一件），而炉子槽数 = 内部方块数 = `MaxLiquid / 1440`。3×3×2 的小炉只有 **2 个槽**，塞 9 件进去也只有 2 件能同时熔，看起来像「停摆」。换成 **5×5×3（内部 3×3×3 = 27 槽，MaxLiquid 38880）** 后：9 个铁锭并行投入 → **90 秒全部熔完 1296mb**。
- 投料 API：`bot.insertIntoSmeltery(pos, entries)` —— 用 **shift 点击**（窗口槽 = `slots-36+27+(hotbar-36)`）把每件推进一个空炉槽；返回「重开窗口后确认的件数」，实测 9/9。
- **水龙头朝向必须指向排液口**：`FaucetLogic` 的 `case 2→z++ / 3→z-- / 4→x++ / 5→x--`。bot 自己放水龙头时**先 `setControlState('sneak', true)` 再点排液口朝向自己的那个面**（潜行走 `onItemUse`，不会被排液口的 `onBlockActivated` 吃掉），得到的 `Direction` 才正确（实测 Direction=2 → 一次点击就把 144mb 倒进下方浇筑台）。
### 29.7 辅助 API 与冒烟
- 已实测的完整链路（全部由 bot 自己完成）：建 5×5×3 焦黑炉壳（setblock）→ 点支撑石 +x/+z 面放控制器（得到 direction 2/4）→ 灌 4 桶岩浆（4000mb）→ 潜行点排液口放水龙头 → 熔 9 锭（90 秒）→ 点水龙头把 144mb 倒进带金铸模的浇筑台 → 冷却后点台取出 **`TConstruct:pickaxeHead`（Damage=2 = Iron）**。
- `packages/mineflayer-fork/lib/gtnh/smeltery.js`：`bot.readSmeltery(pos)`（valid/layers/maxLiquid/liquids）、`bot.smelteryAmount(pos, fluid?)`、`bot.readCastingBlock(pos)`、`bot.readTank(pos)`、`bot.insertIntoSmeltery(pos, entries, {slotLimit})`、`bot.pourFaucet(pos, face=1, {sneak})`。
- `npm run smeltery-smoke -- 127.0.0.1 54615`：读炉子 → 缺就放金铸模 → 熔 9 件（或复用现有铁水）→ 点水龙头 → 冷却后取出 **`TConstruct:pickaxeHead`**。实测通过。
- 注意：水龙头的 `sneak` 只在「往排液口上贴水龙头」时需要；正常浇筑是普通 `block_place`（带 correct cursor）。

## 三十、2026-11-26：冶炼炉的能力边界（实测）与 GT 机器路径

**自测结论：冶炼炉只能熔「它自己的表里的东西」**
- 表中的 956 条覆盖到 1300K：`>1300K` 只有 5 条（WitchingGadgets 的钨簇 1405/1519/1560/1728/2896K）。
- **铅 / 银 / 铂 / 钨 / 钠 / 钾也没有 molten 熔液**：`lead`、`silver`、`platinum`、`tungsten`、`naquadah`、`osmium`、`iridium` 在熔液名里**一个都查不到** —— 冶炼炉根本不存在这些液体的配方。
- 活体实测（`big` 冶炼炉，27 槽）：
  - 塞入 `miscutils:itemIngotTungstenTitaniumCarbide`（钨钛碳化物锭，id 8588）→ **60 秒后熔液量纹丝不动（1008mb），物品仍躺在槽 0**；
  - 同一炉塞铁锭 → 正常熔（对照）。
- 所以「高级金属在冶炼炉里熔不了」不是姿势问题，是**配方表里没有**。

**GT 的替代路径（数据侧已就位）**
- `gt.recipe.extruder`（**压模机 / Extruder**）共 **13457** 条；其中 **8418 条产出 `TGregworks:*` 工具部件**，模具就是 **TiC 的 `TConstruct:metalPattern`（25 种图案：pickaxeHead 2 / shovel 3 / axe 4 / binding 9 / toughRod 15 …）**。
  → 高温金属做工具部件，是「金属锭 + 金属图案 → 挤出机 → 部件」，不是冶炼炉。
- 电压/配方约束（全部可查）：
  - 全 175689 条 GT 配方按 EU/t 分级：`ULV 103715 / LV 52987 / MV 5888 / HV 3057 / EV 1915 / IV 1824 / LuV 1706 / ZPM 1118 / UV 3479`；挤出机那 8418 条几乎全在 **ULV/LV**（2203 / 6215）。
  - 配方可带**电路编号**：`gt.integrated_circuit`（damage = 编号），assembler 里 **5251 / 10143 条**需要它；挤出机 0 条。
  - 多方块：`gt.recipe.pyro`、`gt.recipe.blastfurnace`、`gt.recipe.distillationtower`、`gt.recipe.electricimplosioncompressor` 等 map 与单方块版并存 —— 同一配方在不同机器上位/效率不同。

**给框架的结论**：TiC 冶炼炉这条线只覆盖「低熔点金属 → 铸件」；想做钨/铂/钛这类，必须实现 GT 机器层（机器方块 + 电压校验 + 电路槽 + 多方块），而配方数据已经在 `data/gt/gt-recipes.jsonl.gz` 里（含 `eu`/`dur`/`in`/`out`/`fin`/`fout`）。

## 31. GT 单方块机器（压模机 extruder）

**为什么先做 extruder**：GTNH 把 IC2 的机器配方全删了，工具部件的金属路线走 GT 压模机（`gt.recipe.extruder` 13457 条，其中 8418 条产 `TGregworks:*` 部件，模具是 TiC 的 `TConstruct:metalPattern`）。

**机器 id（agent 反射 `gregtech.api.enums.ItemList` 取得）**
| 等级 | id | 备注 |
| --- | --- | --- |
| extruder LV/MV/HV/EV/IV | `3003:281/282/283/284/285` | 方块 `gregtech:gt.blockmachines` |
| 铁镐头图案 | `TConstruct:metalPattern:2` | 不消耗 |
| GT 铁锭 | `gregtech:gt.metaitem.01:11019` | 11000+materialId |
| LV 太阳能板 | `3003:2733` | 可作为紧邻供电 |

**GUI 槽序（实测）**：窗口 `0/1 = 输入+形状`、`2/3 = 第二组输入+形状`、`4 = 输出`；GT 容器把**快捷栏紧接在机器槽之后**（TiC 是主背包在前）——窗口内 `inventoryStart = 5` 时，快捷栏 0 → 窗口 5，主背包 9 → 窗口 14。

**供电**：紧邻的 LV 太阳能板能直接给机器供 EU（实测 45 秒产出 8 个部件）。用户提醒：**GT 线缆不会自动连接，需要用剪线钳右键对应面来控制连接**，所以「贴着放」是最省事的供电方式。

**代码**
- `packages/mineflayer-fork/lib/gtnh/gtmachine.js`：`VOLTAGES/TIER_NAMES`、`recipeTier(eu)`、`canRun(recipe, machineTier)`（机器档位 ≥ 配方档位，附中文原因）、`machineInfo(meta)`、`findExtruderRecipes(gtRecipes, {output,input,shape})`、`gtnWindowSlots(window)`、`readMachineSlots(window, info)`。
- `packages/mineflayer-fork/tools/extruder-smoke.js`：全自动——放机器 + 太阳能 → 投料 → 等产出 → 电压校验 → 取件。
- 测试 `test/gtmachine.test.js`（5 个）。
- 验收输出：
```
机器 gregtech:gt.blockmachines meta 1 档位 LV
供电 gregtech:gt.blockmachines
产出 TGregworks:tGregToolPartPickaxeHeadx8@1500
配方 30 EU/t, 256t → ✓ LV 档可跑
✓ 已取到 TGregworks:tGregToolPartPickaxeHead x8
✓ 压模机冒烟通过
```

## 三十二、2026-11-26：第二批 NEI handler（Avaritia / HarvestCraft / WitchingGadgets / Et Futurum）

**怎么挑的**：mods 目录 217 个 jar 里有 99 个 jar 的类名含 `nei`。先写 `ProbeScan1`（agent）
扫「类名匹配 `nei.*handler|recipehandler|neiplugin|...` 的顶层类」，把每个 jar 的 NEI handler 列全；
再对候选 mod 用 `ProbeScan1` 的反射模式列出 static 容器字段与单例里的实例容器字段，判断
「配方表是不是一个能直接读的 List/Map」。

### 32.1 本批四个 mod（合计 318 条）

| mod | kind | 条数 | 表在哪 |
| --- | --- | --- | --- |
| Avaritia | extreme_crafting | 135 | `ExtremeCraftingManager.getInstance().getRecipeList()`（9x9，`List<IRecipe>`） |
| HarvestCraft | cutting_board / cooking_pot | 51 / 63 | `CraftingManagerPamCuttingBoard` / `CraftingManagerPamPot` 的 `getInstance().getRecipeList()` |
| HarvestCraft | animal_trap / fish_trap | 3 / 1 | `TrapRecipes.ANIMAL_TRAP_RECIPES` / `FISH_TRAP_RECIPES`（`Map<Item, List<WeightedItemStack>>`） |
| WitchingGadgets | infernal_blast_furnace / spinning_wheel | 51 / 5 | `InfernalBlastfurnaceRecipe.recipes`、`SpinningRecipe.recipeList`（都是 public static List） |
| Et Futurum | smithing_table | 9 | `SmithingTableRecipes.getInstance().getRecipes()` |

`mod-recipes.json` 从 **8206 → 8524 条**（3.9MB），mod 数 11 → 15。

### 32.2 三种新形状

- **9x9 网格**：`ExtremeShapedOreRecipe` 是 `output` / `input`(Object[]) / `width`,`height`；
  `ExtremeShapedRecipe` 是 `recipeWidth`/`recipeHeight`/`recipeItems`(ItemStack[])；
  `ExtremeShapelessRecipe` 是 `recipeOutput`/`recipeItems`(List)。
  81 格里大量是空的，**空格必须占位**，否则网格布局被压掉。
  归一化时对带 `extra.w/h` 的配方**不删空 cell**（其余照旧删），测试断言 `ins.length === 81` 且存在空 cell。
- **加权掉落**：`WeightedItemStack extends WeightedRandom$Item`，`stack` 是 public 字段，
  权重在父类 —— SRG 名是 `field_76292_a`（不是 `itemWeight`，代码里两个都试）。
  dump 写 `out: [{stack, weight}]`，归一化时拆成 `out` 里的普通 stack + `extra.weights` 数组。
- **矿辞输入**：`InfernalBlastfurnaceRecipe.input` 不是 String 而是 `Utilities$OreDictStack`
  （`key` String + `amount` int）。直接按 String 处理会得到 20/51 条空输入；
  取 `key` 后走同一套 `oreAlt()`，`amount` 进 `extra.oreAmount`。

### 32.3 探针/agent 的三个坑

- `call(Class, "getInstance")` 会把 Class 当 receiver 传给静态方法 → `IllegalArgumentException`
  被吞掉变成 null，整批导出静默为 0 条。静态方法要用 `invoke(null, ...)`（`staticCall`）。
  这次 `DumpMods28` 就是这么全空、`DumpMods29` 才跑通。
- `StringBuilder` 是 static 且不重置时，同一 JVM 里第二次 attach 会把上一次的结果一起写进文件
  （`ProbeScan1` 第一次 82 行 + 第二次 192 行 = 274 行，看起来像「扫描结果混在一起」）。
- JVM 缓存已加载的 agent 类，**改了探针代码必须换类名**（`DumpMods28→29→30→31→32`）。

### 32.4 代码

- `packages/gtnh-data/tools/jmx/src/ProbeScan1.java`（按 jar+正则扫容器字段与单例实例字段）、
  `ProbeOne1.java`（打印某个 List 字段里前几个元素的某字段类型/值）、`DumpMods32.java`（本批最终 dumper）。
- `packages/gtnh-data/tools/build-mod-recipes.js`：`FRESH_FILES` 加 `mod-recipes-batch2.jsonl`；
  `normalize()` 支持「网格保位」与「加权掉落拆解」。
- 单测：`gtnh-data/test/mod-recipes.test.js` 加 4 条（Avaritia 网格 / HarvestCraft / WitchingGadgets / Et Futurum），
  fork `test/mod-recipes.test.js` 加 1 条；全仓 **202 测试**（gtnh-data 60 / fork 87 / chunk 7 / protocol-fml 48）。

## 三十三、2026-11-26：第三批 NEI handler（GalaxySpace 火箭 / Binnie 突变）

### 33.1 四个表在哪

| mod | 表 | 条数 |
| --- | --- | --- |
| GalaxySpace | `galaxyspace.core.recipe.RocketRecipes.RECIPES_ROCKET_T1..T8`（`NasaWorkbenchRecipe`） | 32（每级 4） |
| Binnie | `binnie.core.machines.inventory.Incubator.RECIPES`（`IncubatorRecipe`） | 160 |
| Binnie/ExtraBees | `binnie.extrabees.genetics.ExtraBeeMutation.mutations`（`IMutation`） | 153 |
| Binnie/Botany | `binnie.botany.genetics.FlowerHelper.flowerMutations` | 37 |

`Forestry` 的 `IMutation` 只有 `getAllele0()/getAllele1()/getTemplate()/getBaseChance()/isSecret()`，
没有物品 id —— 产物和输入都是**物种名**，所以归一化成 `{"species": "Arid"}`，不参与 `byOutput`（物品索引）。

### 33.2 新形状：物种

`build-mod-recipes.js` 加 `isSpecies(x)`，`asAlternatives` 遇到 `{species}` 直接保留。
`byOutput` 索引跳过没有 id 的产物（`o.id + ':'` 会变成 `undefined:0`，测试里断言这个 key 不存在）。

### 33.3 GalaxySpace 火箭不是 3x3

`NasaWorkbenchRecipe.input` 是 `HashMap<Integer, ItemStack>`，`getRecipeSize()` 返回**条目数**：
T1 有 19 格材料、T8 有 53 格。第一版按 `minKey` 归一塞进 3x3，超过 9 的槽位直接被丢掉；
改成「跨度 ≤ 9 用网格，否则按 key 升序平铺 + `extra.keys` 记原槽位」，`build` 侧对带 `keys` 的
也保位（`keepHoles`），否则空槽会让 `ins` 与 `keys` 错位。

### 33.4 代码

- `packages/gtnh-data/tools/jmx/src/ProbeScan2.java`（`sb.setLength(0)`，只打印真有容器字段的类）、
  `DumpMods35.java`（本批最终 dumper，含 `speciesJson`/`fluidJson`）。
- 数据：`data/raw/gtnh-2.9.0-server/mod-recipes-batch3.jsonl`（382 行）→ `data/recipes/mod-recipes.json` **8906 条 / 17 个 mod**。
### 33.5 按物种查（没有物品 id 的配方怎么查）

物种条目既没有 `id` 也不在 `byOutput` 索引里，所以加了两个入口：
`ModRecipes.forSpecies(name)`（产物或亲本任一命中）与 `ModRecipes.species()`（产物侧物种名去重排序，
144 个）；bot 侧是 `bot.modRecipesForSpecies(name)` / `bot.modRecipeSpecies()`。

顺带修掉一个真 bug：`byOutput(undefined)` 原本会把所有物种条目都捞出来（`undefined !== undefined` 不成立，
物种的 `o.id` 也是 undefined），现在 `byOutput` 对非数字 id 直接返回 `[]`。

- 单测：gtnh-data `test/mod-recipes.test.js` 加 3 条（火箭 32 / 培养器/突变 190 / 按物种查），fork 的第三批用例并入物种断言；
  全仓 **205 测试**（gtnh-data 62 / fork 88 / chunk 7 / protocol-fml 48）。

## 三十四、2026-11-26：实体名——148 个 id，98 个来自 mod

`setEntityData` 用 `entityDataByInternalId = bot.registry.entitiesArray`（minecraft-data）
查 `spawn_entity_living` 的 `type`，查不到就 `name='unknown'`。GTNH 装了 98 个 mod 实体，
它们全落成 unknown，于是 `bot.nearestEntity(e => e.name === 'X')` 之类没法用。

### 34.1 数据来源

`net.minecraft.entity.EntityList` 有五个静态 Map（SRG 名，`javap` 或反射都能看到）：

| 字段 | 内容 | 大小 |
| --- | --- | --- |
| `field_75625_b` | 名字 → Class | 785 |
| `field_75626_c` | Class → 名字 | 761 |
| `field_75623_d` | **Integer → Class**（线上就是它） | 148 |
| `field_75624_e` | Class → Integer | 108 |
| `field_75622_f` | 名字 → Integer | 79 |

只有 148 个实体有数字 id（`addMapping` 时才算），名字有 761 个是因为大量实体只登记了名字。
`DumpEntity1.java` 不写死字段名：遍历所有 static Map，按 key/value 类型认出
「Integer→Class」与「Class→String」两张，再用后者给前者补名字。

导出结果 `packages/gtnh-data/data/entities.json`（148 条，含 `cls` 便于溯源）。

### 34.2 校准

- 原版 50 个实体里 49 个 id 与名字和 minecraft-data **完全一致**（第 50 个 Fishing Float 在
  minecraft-data 里 `internalId` 就是 undefined），说明 mod 没有挤掉原版 id，表可以放心用；
- 98 条类名不以 `net.minecraft` 开头（EnderZoo 的 9 个、GalaxySpace 的若干机器人、
  `soundEntity` / `rangeEntity` 这类内部实体也在）。

### 34.3 代码

- `packages/gtnh-data/src/entities.js`：`EntityTypes`（`get/idOf/nameOf/names/modEntities`）+ `loadEntities()`；
- `packages/mineflayer-fork/lib/gtnh/entities.js`：`gtnhEntityData(internalId)` 返回与
  minecraft-data 同形的条目（宽高固定 0.6×1.8，`category: 'Unknown'`，另带 `gtnhClass`）；
- `lib/plugins/entities.js:177`：`entityData ??= entityDataByInternalId[type] ?? gtnhEntityData(type)`，
  两条 spawn 路径（`spawn_entity_living` 与 `spawn_entity`）都过 `setEntityData`，所以一处兜底就够。

### 34.4 单测（6 条）

gtnh-data：148 条、原版名字对齐、98 个 mod 实体、未知 id 返回 null、minecraft-data 的实体全覆盖。
fork：mod 实体（EnderZoo 苦力怕 id=6）名字正确、原版 Creeper 仍走 minecraft-data（分类不被覆盖）、
表外 id 仍落 unknown。**测试 213**（gtnh-data 67 / fork 91 / chunk 7 / protocol-fml 48）。

### 34.5 已知残留

`fetchEntity(id)` 对没收到 spawn 包的 id 也会建一个空实体（`name` 为 undefined、位置 (0,0,0)）；
实测出生点附近 31 个实体里有 16 个是这种（服务器对未 spawn 的 id 先发了 metadata/velocity）。这是上游行为，
不影响按名字找实体（这些条目 `name` 是 undefined 而不是某个真名），没动。

## 三十五、2026-11-26：挖方块要什么工具（GT 的机器/线缆/矿）

### 35.1 现象

`bot.dig()` 对任何方块都直接挖，不看手里的工具。GTNH 里这是错的：
GT 的机器方块要扳手，线缆要剪线钳，矿要镐（且等级随材料升高），
空手或拿错工具挖不掉（客户端会一直发挖掘动画，服务端不认）。

根因有两层：

1. 上游 `lib/plugins/digging.js` 只管发 `player_digging`，本地不做 `canHarvestBlock` 校验；
2. minecraft-data 对 1.7.10 只给 `boundingBox: 'block'/'empty'`，没有 harvest 信息。

### 35.2 数据：17126 条 {name, meta, tool, level}

1.7.10 的方块自己声明 `getHarvestTool(int meta)` / `getHarvestLevel(int meta)`，
GT 把这两个用到了非原版工具上。从服务端内存导出来：

```
packages/gtnh-data/tools/jmx/src/DumpHarvest7.java
  → packages/gtnh-data/data/harvest.jsonl.gz   （67.2 KB，4258 个方块 × meta 0..15，只留 tool 非空的 17126 条）
```

分布：pickaxe 12146 / wrench 2873 / axe 1247 / shovel 606 / crowbar 176 / sword 32 /
scoop 26 / shears 16 / cutter 4。

写探针时踩的坑（DumpHarvest1..6 都失败）：

- 1.7.10 **没有 `Block.blocksList` 数组**（那是更早的版本），方块表是 `Block.blockRegistry`；
- 它是 `cpw.mods.fml.common.registry.FMLControlledNamespacedRegistry`，
  **只实现 `Iterable`，不是 `Map`**——`instanceof Map` 判断会直接漏掉；
- 拿注册名的正确入口是注册表自己的 `RegistryNamespaced.func_148750_c(Object)`，
  不是 `Block` 的静态方法（`Block.func_149739_a()` 给的是 unlocalized name，不是注册名）。

### 35.3 GT 的工具是「一个物品 + damage」

这一条最容易错：GT 的扳手、剪线钳、锤、锯……**都是同一个物品**
`gregtech:gt.metatool.01`，靠 damage 区分，注册名完全一样，
物品的 `displayName` 也还是注册名（客户端才用 lang 渲染）。

所以「名字里含 wrench 就是扳手」这条规则对 GT 工具全部失效。

类型只在 lang 里：`gt.metatool.01.<damage>.name`。

```
10 Saw        12 Hammer      14 Soft Mallet   16 Wrench
18 File       20 Crowbar     22 Screwdriver   24 Mortar
26 Wire Cutter 28 Scoop      30 Branch Cutter 34 Knife
36 Butchery Knife 44 Plunger 46 Rolling Pin
170/172/174/176 各种涡轮    180..192 Pocket Multitool 194 Trowel
```

生成成 `packages/gtnh-data/data/gt-tools.json`（`tools/build-gt-tools.js` 从 gregtech jar 的
`assets/gregtech/lang/{en_US,zh_CN}.lang` 解析），27 条。

**走错的死路**：`Item.getHarvestLevel(stack, toolClass)` 对 GT 工具没有区分力——
`DumpGtTools1.java` 对 damage 0..60 × 16 个工具类全部返回 0，任何一类都「属于」，
这条路直接放弃。另外 damage 0 的 metatool 是不存在的物品（`give` 回来是空的）。

### 35.4 落地

- `gtnh-data/src/gt-tools.js`：`gtToolKind(name, meta)` / `gtToolName(name, meta, 'zh')` / `gtToolsOfKind(kind)`；
- `mineflayer-fork/lib/gtnh/harvest.js`：`toolKindOf(item)` 先查 GT 表再走名字正则；
  `findTools` 支持别名——**GT 的锤可以当镐挖石/矿**（`TOOL_ALIASES.pickaxe = ['pickaxe','hammer','multitool']`）；
  装备比较必须连 metadata 一起比（`sameItem`），否则手持扳手会被当成「已经拿着镐」；
- `mining.js` 的 `mineBlock` 挖之前调 `equipToolFor`，拿不到工具就写 `bot._lastMineReason` 返回 false。

实机（创造模式，三块方并排）：

```
机器 gt.blockmachines:1 → 要 wrench 1   空手 false「没有wrench」  给 16 号扳手 → true 313ms
矿   gt.blockores:1     → 要 pickaxe 0  空手 false「没有pickaxe」 给 12 号锤  → true 308ms
线缆 gt.blockmachines:8 → 要 cutter 0   空手 false「没有cutter」  给 26 号剪线钳 → true 309ms
```

缺口：`gregtech:gt.blockores` 在 harvest 表里没有条目（GT 覆盖的是 `canHarvestBlock`），
`harvest.js` 按名字 `/blockores|:.*_ore$|_ore\b/` 兜底成 pickaxe 0；
等级没有按材料细分，实际挖不动高等级矿时不会自动升级工具。

### 35.5 生存模式：原版工具挖不动 GTNH 的矿

现象：生存模式 `bot.dig` 挖 `minecraft:coal_ore` **永远超时**（10–15 秒），
服务端 `testforblock … air` 一直返回「is Coal Ore」；同一个方块在创造模式 308ms 就没了。

对照实验（同一套 tp + `setblock` 场景，`/give … minecraft:diamond_pickaxe` 手持原版钻石镐 278）：

| 方块 | 要求 | 结果 |
| --- | --- | --- |
| `minecraft:dirt` | 任何工具 | **5.05 s 挖掉**，服务端确认变空气 |
| `minecraft:coal_ore` | pickaxe 0 | 15 s 不动，服务端方块不变 |

排除掉的项：

- 区块没问题——`bot.blockAt` 读得到、`bot.entity.position.y ≈ 81.000`（站在地面上）、`onGround=true`；
- 包没问题——创造模式用同一份 `block_dig` 成功，`packet_block_dig` 就是 `status / location(position_ibi) / face`；
- 不是「等太短」——把 `bot.digTime` 临时改成 5000 ms 再挖，还是不动；
- 不是「发包频率」——每 50 ms 重发 `status 0` 持续 4 秒再 `status 2`，还是不动。

结论：**GTNH 服务端在算「需要工具才能挖」的方块时，不认原版工具的物品 id**。
`getPlayerRelativeBlockHardness` 给原版钻石镐算的是惩罚速度，`progress` 永远到不了 1，
于是 `status 2` 被忽略、服务端也不发 `block_change`（客户端就一直等 `blockUpdate`，超时）。
dirt 不需要工具，所以能挖——这条对照同时证明了「客户端流程本身是对的」。

下一步：用 GT 自己的工具复验。`/give <player> gregtech:gt.metatool.01 1 12` 在 1.7.10 上不给
（背包是空的，`bot.heldItem` 为 null），得走 `bot.creative.setInventorySlot` + registry 里的数字 id。

### 35.6 远距离 tp 后区块不来，物理停摆

现象：`/tp` 到离出生点很远的位置后，`bot.blockAt` 一直 `null`、`bot.world.columns` 不新增该列，
bot 的位置被顶高 1.62 格（正好 `EYE_HEIGHT`）、`onGround` 却是 `true`。

原因在 `lib/plugins/physics.js:93`：

```js
if (bot.blockAt(bot.entity.position) != null) { // otherwise the chunk is unloaded: no simulation
  …
  updatePosition(now)   // 只有区块加载时才发 position 包
}
```

区块没加载就不发包 → 服务端以为玩家还在旧位置 → 只继续发旧位置的区块 → 死锁。

实测（同一个 bot，依次 tp）：

| 目标 | 该区块到了吗 | 读方块 |
| --- | --- | --- |
| (60, 80, 60) | 是 | 正常 |
| (100, 80, 100) | 是 | 正常 |
| (160, 81, 162) | **否**（20 秒、`columns` 停在 289） | `null` |

手动补发 `position` 包也没用，说明卡在服务端那侧（该列没发）。
所以冒烟/探针脚本要 tp 到场地的，**别一次 tp 太远**；先 tp 到附近再走过去更稳。

### 35.7 生存模式：空手挖得动，手持镐就挖不动——因为 GT 把原版镐禁了

想验「挖掉 → 掉落物进背包」，结果撞在一个反常现象上。同一场地、同一格、同一会话：

| 手持 | 方块 | 客户端 `digTime` | 结果（`testforblock … air`） |
| --- | --- | --- | --- |
| 空手 | `minecraft:dirt` | 750 ms | ✅ 1.4 s 挖掉 |
| 空手 | `minecraft:stone` | 7500 ms | ✅ 9.2 s 挖掉 |
| 原版钻石镐（`/give` 给的） | `minecraft:dirt` / `stone` / `coal_ore` | 300–750 ms | ❌ 25 s 超时，服务端方块纹丝不动 |
| 原版钻石镐（创造模式 `setInventorySlot` 塞的） | 同上 | 同上 | ❌ 同上 |
| GT 锤 `gt.metatool.01:12` / `:2` / `:0` | `coal_ore` | — | ❌ 同上 |

**空手能挖、而且时间和原版公式对得上**（`stone` 空手 1/1.5/100 每 tick → 7.5 s，实测 9.2 s，差的是服务端 tick 卡顿）。
所以客户端的 `block_dig` 包、坐标、face、`status 0 → 2` 全都对，服务端也确实在累加进度。

**已排除**：
- 区块没加载（`bot.blockAt` 读得到、`onGround=true`、y≈81.000）；
- 包格式（创造模式发同一份包能挖掉，`testforblock` 确认变空气）；
- 等太短（`waitTime` 3000 / 5000 / 8000 / 20000 全试过）；
- 重发 `status 0`（会重置进度，反而更糟）；
- `held_item_slot` 包（手动发 `{ slotId: 1 }` 后空手仍能挖）；
- 工具来源（`/give` 的服务端物品与 creative 塞的完全一致地失败）；
- `gamemode` 没生效（`gamemode 0` + `gamemode survival` 都发过，客户端 `gameMode` 变成 survival，服务端日志也认）。

**未解**：服务端在「手持物品」时进度像是 0。可能方向：GT 服务端对非 GT 工具的 `getBreakSpeed` 有特殊处理，
或者服务端 tick 卡顿（日志有 `Can't keep up! Running 2126ms behind, skipping 42 tick(s)`）让 `updateBlockRemoving` 的累加异常。
要用真实客户端在同一台服务器上挖一次做对照，才能判定这是服务器的问题还是 bot 的问题。

**影响**：`bot.mineNearby` 在生存服上挖不动（创造模式正常，`fork-smoke` 的挖掘就是创造模式）。

**2026-11-27 结论（用户确认 + 实机对照）**：现象不是 bug，是 GT 的设计——
**原版镐里只有木镐能挖，石/铁/金/钻石镐全被 GT 禁掉了**，要用 GT 自己的工具或匠魂（TiC）的工具。

实机对照（生存模式，同一场地，`/gamemode 0`，手持工具从 slot 36 equip）：

| 手持 | 方块 | 客户端 `digTime` | 结果 |
| --- | --- | --- | --- |
| `minecraft:wooden_pickaxe` | `stone` | 1150 ms | ✅ 2.3 s 挖掉 |
| `minecraft:diamond_pickaxe` | `stone` | 300 ms | ❌ 20 s 超时，服务端方块不动 |
| `TConstruct:pickaxe` | `stone` | 7500 ms | ✅ 约 8 s 挖掉 |

所以「空手能挖」也是同一件事的另一面：空手的速度就是 1.0，GT 不拦；
拿了被禁的镐反而让服务端把挖掘速度算成 0（`getDigSpeed` 判为不能采）。

**代码侧已按这个规则改**（`packages/mineflayer-fork/lib/gtnh/harvest.js`）：
- `BANNED_PICKAXES = { stone_pickaxe, iron_pickaxe, golden_pickaxe, diamond_pickaxe }`，找镐时直接排除，
  否则会挑中一把「装备了也挖不动」的镐卡在那里；
- 可用的镐 = `wooden_pickaxe` + `TConstruct:pickaxe` + `TConstruct:hammer`（TiC 锤也能挖）+ GT 的锤/多用途工具；
- 背包里只有被禁的镐时，`equipToolFor` 的失败原因会点名「被 GT 禁了，只能用木镐或匠魂/GT 的镐」。

**已修（`lib/plugins/digging.js` 的 `digTime`）**：minecraft-data 不认识匠魂/GT 的工具，
一律按徒手（速度 1）算，石头要 7500 ms。现在加了 GTNH-PATCH：当**工具确实匹配这个方块**
（`toolKindOf(held)` 命中 `toolNeeded(block)` 的别名表）且**算出来的时间明显偏大**
（`> hardness * 900`）时，按工具的真实速度重算——
`harness = hardness × 1500 × 1.2 / speed`，`speed` 取自匠魂工具 NBT 的 `InfiTool.MiningSpeed`
（没有 NBT 的按 1 算，即「空镐」）。1.2 是给服务端 tick 卡顿留的余量：`status 2` 发早了
服务端会直接丢掉这个包，而接下来的 `status 0` 又会把已有的进度归零，宁可多等一点。

实机（生存模式、同一场地、`testforblock` 判定）：

| 手持 | 方块 | `digTime` | 实测用掉 | 结果 |
| --- | --- | --- | --- | --- |
| 匠魂镐（无 NBT，速度 1） | `coal_ore`（硬度 3） | 5400 ms | 5508 ms | ✅ 挖掉 |
| 匠魂镐（无 NBT，速度 1） | `stone`（硬度 1.5） | 2700 ms | 2796 ms | ✅ 挖掉 |

公式和实测只差一次网络往返，说明服务端的挖掘时长就是 `硬度 × 1500 / 速度`，
客户端早先按徒手算的 7500 ms 才是错的。

**关于「GT 的镐」（2026-11-27 用户两次澄清，第二句修正第一句）**：
- 第一句「只能用 GT 的镐或者匠魂的镐」→ 后来修正：**GT 根本没有自己的镐**。
  `gregtech.common.items.IDMetaTool01` 里只有 SAW / HARDHAMMER / WRENCH / FILE / CROWBAR /
  SCREWDRIVER / MORTAR / WIRECUTTER / SCOOP / DRILL / CHAINSAW…，**没有 PICKAXE**。
  lang 里 `gt.metatool.01.0..8` 没有键，也是这个原因——不是「表没导全」，是物品不存在。
- 能挖矿的只有：**匠魂的镐**（镐头用什么材料都行，GT 的钴/玛玉灵/钨钢做成部件就有对应等级与速度）、
  木镐（GT 唯一放行的原版镐）、以及 GT 的硬锤 `metatool.01:12`（锤不是镐，但 GT 允许它挖石/矿）。
- **匠魂工具有「挖掘速度」（`InfiTool.MiningSpeed`）**，同一块矿的耗时差别很大，所以
  `findTools` 现在按 `MiningSpeed` 排序，而不是按名字里的材料猜。
- **匠魂工具损坏后可以用主部件的材料锭在装配台（Tool Station / Tool Forge）修复**，
  所以 `findTools` 会把耐久见底（`Durability <= 1`）的工具排到最后——它还能修，但当下不该优先用。

`lib/gtnh/harvest.js` 新增：`tiCStats(item)`（读 `InfiTool` 的 MiningSpeed / HarvestLevel /
Durability / TotalDurability，`{type,value}` 套娃与普通对象两种形状都认）、`toolSpeed(item)`、
`isWornOut(item)`；`findTools` 的排序键变成「先排除快报废的，再按速度，再按名字里的材质」。

## 三十六、2026-11-27：NEI 静态表的最后四个候选——全部没有独立配方表

§32/§33 之后还剩四个「有 NEI handler 类、但不确定有没有静态表」的 mod。用
`packages/gtnh-data/tools/jmx/src/ProbeScan5.java`（`ProbeScan2` 的继任者，见下面的 loader 坑）
扫了一遍，结论是**都不值得单独导**：

| jar | 找到的容器 | 能不能当配方表 |
| --- | --- | --- |
| `BetterQuesting-3.8.92-GTNH.jar` | `QuestDatabase.INSTANCE` Map(3814) 条 QuestInstance、`QuestLineDatabase.INSTANCE` Map(46) | ❌ 是任务书数据，不是配方；另属一个维度 |
| `NEIAddons-1.18.8.jar` | `NEIAddons.addons` List(2)、`GeneticsUtils.beePositionToType` Map(4) | ❌ 只是 NEI 的附加显示 |
| `EnhancedLootBags-1.3.5.jar` | 无静态容器（`LootGroups` 是类定义，不是实例表） | ❌ |
| `TwilightForest-2.7.45.jar` | 全是名字数组、生物蛋表、地图生成参数（`TFFeature.featureList` Array(256) 等） | ❌ 配方都注册进原版 CraftingManager，已在 vanilla 数据里 |

补记一个探针 loader 的坑：在 GTNH 的 retrobootstrap（RFB）环境里
`Class.forName("net.minecraft.item.ItemStack").getClassLoader()` 拿不到东西，
会抛 `ClassNotFoundException: Class bytes are null for net.minecraft.item.ItemStack`。
必须从 `net.minecraft.launchwrapper.Launch.classLoader`（`LaunchClassLoader`）取，退路依次是
`Thread.currentThread().getContextClassLoader()` 和 `ClassLoader.getSystemClassLoader()`。
`ProbeScan5` 就是这么做的，也顺手把「类只加载不初始化」（`forName(..., false, cl)`）和
「初始化失败就跳过」分开，避免一个 mod 的客户端类炸掉整份扫描。

**到这里 NEI 的静态配方表算挖完了**：原版 + GT 的 175 689 条 + 17 个 mod 的 8906 条，
剩下能想到的候选都验证过没有静态表。再往下的「配方」类扩展只能走运行时注册表
（AE2/EnderIO/IC2 那类实例 API），或者转做别的东西（比如 BetterQuesting 的任务数据）。

---

## 三十七、2026-11-27：任务书（BetterQuesting 3814 条）

GTNH 的任务书是 BetterQuesting 管的，3814 条任务、46 条线。它既不是配方表也不是
NEI handler，是另一套数据，但价值一样：`bot` 能读任务书，才能回答「我现在能交哪些
任务、还缺什么」。这一节记数据怎么导、格式长什么样、踩了什么坑。

### 37.1 表在哪

jar：`G:\mc\GTNH2.9.0-server\mods\BetterQuesting-3.8.92-GTNH.jar`。两个静态单例：

```java
betterquesting.questing.QuestDatabase.INSTANCE     // UuidDatabase<IQuest>   3814
betterquesting.questing.QuestLineDatabase.INSTANCE // UuidDatabase<IQuestLine> 46
```

**坑一：key 是 UUID，不是数字 id。** `UuidDatabase` 提供 `keySet()` / `get(Object)`，
接口上有 `getEntries()` 但实例没有实现。所以遍历是：

```java
QuestDatabase db = QuestDatabase.INSTANCE;
for (UUID id : db.keySet()) {
    IQuest q = db.get(id);
}
```

**坑二：一条线的任务列表不是 `getQuests()`。** `QuestLine` 自己就继承了
`UuidDatabase<IQuestLineEntry>`，线的任务就是它的 `keySet()`。任务的直接前置是
`QuestInstance.getRequirements()`，返回 `Set<UUID>`。

**坑三：1.7.10 的 NBT 没法按下标取元素。** `NBTTagList` 在 1.7.10 上只有
`tagCount()`（SRG `func_74745_c`）和 `appendTag`，**没有 `get(int)`**；按参数签名
反射匹配会撞上 `func_74744_a`（`removeTag`），那是真删元素的方法，删到越界就抛
`IndexOutOfBoundsException: Index 1 out of bounds for length 1`。最后是反射读它私有的
`tagList`（`java.util.List`）字段来取。同理 `NBTTagCompound.getTag(String)` 是
`func_74781_a`，数字标签的值在私有 `data` 字段里，按 getter 返回类型（byte/short/
int/long/float/double）选。

探针 `DumpQuest13.java`（`args "<out>@@<mode>"`，`mode=peek|all`）一次导出：

```json
{"counts":{"quests":3814,"lines":46},
 "quests":[{"id":"<uuid>","prereq":["<uuid>", ...],"nbt":{...}}],
 "lines":[{"id":"<uuid>","quests":["<uuid>", ...],"nbt":{...}}]}
```

前置不在 NBT 里拆——NBT 存的是 `{questIDHigh, questIDLow}` 两个 long，拼回 UUID 会丢
精度，所以 Java 侧直接输出 `getRequirements()` 的字符串数组。耗时 2.7 秒，10.6MB。

### 37.2 前端字段长什么样

任务的显示属性在 `nbt.properties.betterquesting`，**值本身是带引号的 JSON 字面量**，
要 `JSON.parse` 两次：

```json
{"name":"\"Shadow Metal\"","desc":"\"...\"","icon":"{...}"}
```

`tasks[]` 每项有 `taskID`（`bq_standard:retrieval` 等）和 `requiredItems`；
`rewards[]` 每项有 `rewardID`（`bq_standard:item` / `:choice` / `:questcompletion` / `:xp`）。
每类的关键字段：

| taskID | 字段 |
| --- | --- |
| `bq_standard:retrieval` / `optional_retrieval` / `crafting` | `requiredItems[{id, Damage, Count, OreDict}]` |
| `bq_standard:fluid` | `requiredFluids[{FluidName, Amount}]` |
| `bq_standard:hunt` | `target` + `required` |
| `bq_standard:location` | `name` / `posX,posY,posZ` / `dimension` / `range` |
| `bq_standard:meeting` | `target` |
| `bq_standard:checkbox` | 没有可查字段（玩家自己勾） |

分布：retrieval 3743、optional_retrieval 1400、checkbox 228、crafting 137、hunt 104、
location 34、fluid 17、meeting 1。

`tools/build-quests.js` 把 10.6MB 的 raw 压成 `data/quests.json`（5039 KB），顺手建
`byLine` / `byItem` / `byTask` 三个索引——按物品反查「哪些任务要交它」全靠 `byItem`。

### 37.3 用法

```js
const { loadQuests } = require('gtnh-data')
const book = loadQuests()
book.byName('Shadow Metal')                  // 模糊也搜
book.chain(quest.id)                         // 从根到它的前置链（拓扑序）
book.missingFor(quest.id, bot.inventory.items())
book.readyWith(bot.inventory.items())        // 当前背包能交的
```

fork 侧对应 `bot.quests()` / `bot.questReady()` / `bot.questMissing(id)` / `bot.questPlan(id)`。
`questPlan` 把缺料接到配方上：原版合成 → GT 合成台 → mod 配方 → GT 机器 → 熔炉，按这个顺序取
第一条，再往下拆两层（`{ kind, inputs, next }`）；GT 机器配方里 `count` 为 0 的输入是模具/催化剂，
不算消耗，已过滤。

**坑四：物品字段两套写法。** 任务数据是 `{id, meta}`（`id` 是注册名字符串，如
`gregtech:gt.metaitem.01`、`TaintedMagic:BlockShadowOre`），mineflayer 的物品是
`{name, metadata}`。`inventoryCounts` 必须 `it.name || it.id` 加
`it.meta != null ? it.meta : it.metadata`，否则背包永远算空——这个坑让 fork 的第一版
测试直接挂掉。

### 37.4 测试

`packages/gtnh-data/test/quests.test.js` 9 条 + `packages/mineflayer-fork/test/quests.test.js`
3 条，全离线：总数、按线/名字/物品反查、前置链拓扑序、材料齐 ready、缺料报 need/have、
checkbox 记 unknown。

## 三十八、2026-11-27：掉落物实体在 1.7.10 叫 `Item`（大写），不是 `item`

**现象。** 生存模式挖掉两块 `coal_ore`，`testforblock` 确认方块变空气，掉落物实体就在
脚边两格内，但 `bot.mineNearby()` 返回后背包里没有 coal，`collectDrops` 一个也没走过去。

**原因。** 1.7.10 的实体注册名是 `Item`（`EntityItem` 的 `getEntityString()`），而
minecraft-data 给上游 mineflayer 的实体表里同一类叫 `item`。`mining.js` 的
`collectDrops` 原本写 `e.name === 'item'`，严格相等在 GTNH 上一个都匹配不到：

```
实体: [ 'Item@123,63,119', 'Item@121,64,121', 'Item@122,64,120', ... ]
      （全都是 Item，一个 item 都没有）
```

**修法。** `collectDrops` 改成 `/^item$/i.test(e.name)`，并加了 `typeof e.name === 'string'`
保护（未 spawn 的实体 `name` 是 undefined，见 §34.5）。

**验证。** 生存模式、匠魂镐（无 NBT，MiningSpeed=1）挖 2 块 `coal_ore`：

```
挖了 2 块，耗时 13768 ms
附近掉落物: [ 'Item@123,63,119', 'Item@121,64,121', ... ]
背包(挖后): [ 'TConstruct:pickaxex1', 'coalx1' ]
>>> coal 进背包: ["coalx1"]
```

掉落物确实进了背包——这是「生存模式挖矿」全链路（选工具 → 算 digTime → 挖 → 捡）第一次
端到端跑通。`packages/mineflayer-fork/test/mining.test.js` 加了一条用大写 `Item` 的用例。

**顺带一条。** 掉落物会掉进挖开的坑里（实测 y 从 80 掉到 63/64），`collectDrops` 的
`bot.goto` 会跟着走下去——这依赖 pathfinder 的有限下落（`MAX_FALL=4`），超过 4 格的深坑
它不会追。
