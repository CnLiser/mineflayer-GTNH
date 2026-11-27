# API 速查

`bot` 上 GTNH 特有的方法。上游 mineflayer 的（`dig` / `placeBlock` / `craft` / `openBlock` /
`clickWindow` / `lookAt` …）不重复列，看 [上游文档](https://github.com/PrismarineJS/mineflayer/tree/master/docs)。

```js
const { createBot, loadServerMods, formatMessage } = require('mineflayer-fork')

const bot = createBot({
  host: '127.0.0.1',
  port: 54615,
  username: 'bot',
  mods: loadServerMods()        // FML 握手用；不传会缺 mod 注册表，方块/物品名全是 id
})
await bot.once('spawn')
```

`loadServerMods()` 从 `packages/protocol-fml/data/raw/server-modlist.json` 读 296 个 mod 的
name/version（本地有 `local-server-modlist.json` 优先）。

## 1. 门面

| 导出 | 说明 |
| --- | --- |
| `createBot(options)` | `options` 比上游多 `mods`、`modsFile`、`lang` |
| `loadServerMods(file?)` | 读 mod 列表，返回 `[{name, version}]` |
| `formatMessage(input, lang?)` | 把 chat 组件渲染成字符串（`translate` + `with` 会用 lang 表） |
| `messageToJSON(msg)` | `ChatMessage`/字符串/数组 → 原始组件 JSON（存原文用它，别 `JSON.stringify` 别的） |
| `supportFeature(feature, version?)` | 1.7.10 的 feature 表（`minecraft-data` 对 1.7.10 全返回 false） |
| `connect(options, {baseDelayMs, maxDelayMs, maxTries, createBot})` | 断线重连：断线后**重建整个 bot**，指数退避 |

`bot` 上：`bot.formatMessage(input)`（同 `formatMessage(input, options.lang)`）、
`bot.supportFeature(feature)`、`bot.registry`（FML 注册表注入，blocks 4258 / items 11343）。

### 1.1 断线重连

mineflayer 本身不管重连。`connect()` 是一个薄封装：socket 断了就把 bot 整个重建
（世界缓存、背包、打开的窗口都跟着旧连接一起丢掉，重建比原地清理更可靠）。

```js
const { connect } = require('mineflayer-fork')
const link = connect({ host: '127.0.0.1', port: 54615, username: 'bot' })
link.on('bot', (bot) => bot.once('spawn', () => console.log('连上了')))
link.on('reconnect', ({ delay, tries }) => console.log(`${delay}ms 后第 ${tries} 次重连`))
link.on('giveup', ({ reason, tries }) => console.log('放弃', reason, tries))
link.start()
```

`link.bot` 是当前那一个 bot（重连后换成新的）；`link.stop()` 停止重试并退出。
退避是 `baseDelayMs * 2^(n-1)`，上限 `maxDelayMs`，`maxTries` 次后发 `giveup`。
注意：重连期间旧 bot 上的监听、任务状态都不保留，脚本要监听 `bot` 事件重新挂。

## 2. 世界与方块

```js
const block = bot.blockAt(bot.entity.position.offset(0, -1, 0))
block.name      // 'gregtech:gt.blockmachines'（FML 注册名，不是 'stone'）
block.metadata  // 0-15
```

- **`bot.blockEntities`** — `Map<string, NBT-ish>`，方块实体（机器、熔炉、熔炉的 TileEntity）最近一次同步的 NBT 快照，key 是 `x,y,z`。
- **`bot.isABed(block)`** / **`bot.parseBedMetadata(block)`** — 床的头部/脚部与朝向。
- `bot.findBlock` / `blockAt` / `blockInSight` 行为同上游，但 1.7.10 的方块 id 由 FML 映射表解析（见 FINDINGS §3）。

## 3. 矿辞

```js
bot.oreItems('oreIron')     // → [{ id: 15, metadata: 0, count: 1 }, ...] 共 11 种
bot.oresOf(15, 0)           // → ['oreAnyIron', 'oreIron']（按 item id+meta 反查）
```

数据在 `gtnh-data/data/ores.json`（56279 条映射）。

## 4. 配方

### 4.1 原版 + GT

```js
bot.gtnhRecipes                          // 原版配方书（矿辞版 + 普通版）
bot.gtnhRecipesFor(id, meta)             // 可用什么合成它
bot.gtnhSmeltingFor(id, meta)            // 熔炉
bot.gtRecipeMaps()                       // ['gt.recipe.assembler', ...] 136 个
bot.gtRecipesForOutput(id, meta)         // GT 机器配方（175689 条里）
bot.gtRecipesForInput(id, meta)
bot.gtRecipesForFluid('steam')
```

单条 GT 配方：

```js
{ map: 'gt.recipe.assembler', eu: 120, dur: 3200,
  in:  [{ id: 7639, name: 'gregtech:gt.metaitem.01', meta: 32741, count: 1 }],
  out: [{ id: 7640, name: 'gregtech:gt.metaitem.02', meta: 32577, count: 1 }],
  fin: [], fout: [] }
```

`eu` 是每 tick 的 EU（不是总量），`dur` 是 tick 数（3200 = 160 秒）。

### 4.2 其它 mod（17 个、8906 条）

```js
bot.modRecipeMods()                      // ['ae2','avaritia','binnie',...]
bot.modRecipeKinds('binnie')             // ['bee_mutation','flower_mutation','incubator']
bot.modRecipesFor(id, meta)              // 产物查
bot.modRecipesUsing(id, meta)            // 输入查
bot.modRecipesByOre('oreIron')
bot.modRecipesForSpecies('Arid')         // 物种（没有物品 id 的那些）按产物或亲本查
bot.modRecipeSpecies()                   // 144 个物种名
bot.modRecipeSummary()                   // { mods, total, byMod }
```

单条形状：

```js
{ mod: 'galaxyspace', kind: 'rocket',
  out: [{ id: 4695, name: 'GalacticraftCore:item.spaceship', meta: 0, count: 1 }],
  ins: [[{ id: 10248, name: 'GalaxySpace:item.ModuleLander', meta: 0, count: 1 }], ...],
  fluidIn: [], fluidOut: [], time: 0, extra: { keys: [0, 1, 3, ...] } }
```

`ins` 是 **每格一个备选数组**（矿辞/多选时一格多个候选）。带 `extra.w`/`extra.h` 的是网格配方（保留空格，
按行优先）；带 `extra.keys` 的是散列槽位（火箭工作台，19–53 格，`keys[i]` 对应 `ins[i]`）；
物种配方用 `[{ species: 'Arid' }]`。

### 4.3 TiC

```js
bot.tconstructMaterials()                // 184 种
bot.tconstructMaterial('Iron')
bot.tconstructMelting(id, meta)          // 熔炼（956 条）
bot.tconstructMeltingFor(bot.heldItem)   // 传 Item 对象也行
bot.tconstructFuels() / bot.tconstructFuel('lava')
bot.tconstructToolSpeed('Iron')          // 工具材料速度
bot.tconstructToolInfo(item)             // 解析一个工具/武器的材料组成
bot.tconDigTime(block, tool?)            // 挖这个方块要多少 ms（含材料加成）
```

### 4.4 熔炉 / 浇筑

```js
bot.placeFaucet(faucetPos, drainPos)     // 放水龙头（需要手持）
bot.readSmeltery(pos)                    // 读冶炼炉：储罐 + 各层液体
bot.smelteryAmount(pos, 'Iron')          // 某液体多少 mB
bot.readTank(pos)                        // 单个储罐
bot.readCastingBlock(pos)                // 浇筑台/盆的状态
bot.insertIntoSmeltery(pos, entries)     // 投料
bot.pourFaucet(pos, face)                // 右键龙头浇
```

坐标都是 `Vec3`。这些都要先 `openBlock` 过 GUI 才能读到 `bot.blockEntities`。

## 5. GT 机器 / ModularUI2

```js
bot.on('modularOpen', ({ windowId, factory, blockPos, networkId }) => {})
bot.on('modularSync', ({ panel, key, tag, kind, value }) => {})
bot.on('modularClose', ({ windowId }) => {})

bot.machineState                         // Map<panel, Map<key, value>>
bot.panelState('basicmachine.alloysmelter.tier.02')   // → { 'auto_sync:…:0': {...}, … } | null
bot.modularPanels()                      // 见过的 panel 名
bot.disposeModularUI()                   // 摘掉监听
```

`kind` 是 `int` / `long` / `float` / `double` / `string` / `item` / `fluid` / `bool` / `nbt` …；
`auto_sync:<panel>:<n>` 是**没有显式注册**的同步值，`:0` 通常是进度条
（`DoubleSyncValue`，机器空转时是 `NaN`，见 FINDINGS §17.5）。要一份全量快照就**重开 GUI**。

机器侧纯函数在 `lib/gtnh/gtmachine.js`（不挂 bot）：

```js
const { tierIndex, tierVoltage, canRun, machineInfo, findExtruderRecipes, readMachineSlots } = require('mineflayer-fork/lib/gtnh/gtmachine')
```

## 6. 物理

```js
bot.physics                  // Physics 实例（simulatePlayer / apply）
bot.physicsEnabled = false   // 关掉服务端权威物理，自己接管（默认 true）
bot.on('physicsTick', () => {})
```

碰撞盒：`lib/gtnh/blockshape.js` 的 `blockShapes(block)` 返回相对 AABB 数组
（半砖 0.5、台阶 0.5/1.0、栅栏 1.5、地毯 0.0625…，见 FINDINGS §11.5）。

### 6.1 寻路（实验性）

1.7.10 上跑不了 `mineflayer-pathfinder`（它依赖 1.8+ 的方块形状），这里是一个最小实现：
整数格点上的 A*（平走 / 1 格上台阶 / 最多 4 格下落），执行交给现有 physics。

```js
const path = bot.findPathTo(new Vec3(x, y, z), { maxNodes: 6000 })  // [{x,y,z}, ...] 或 null
const ok = await bot.goto(new Vec3(x, y, z), { timeoutMs: 30000 })  // 走过去，返回是否到达
const ok = await bot.goto(new Vec3(x, y, z), { dig: true })     // 允许挖穿挡路的方块
const ok = await bot.goto(new Vec3(x, y, z), { bridge: true })  // 允许在沟上垫方块（手里要有方块）
const ok = await bot.goto(new Vec3(x, y, z), { jump: false })   // 不跳（默认会跳 1 格宽的沟）
```

`bot.solidAt(x, y, z)` 是底层判定（没加载的区块按实心处理，宁可绕路）。
两个注意点：半砖/台阶在规划时按整块算（physics 的 stepUp 会处理 0.5 格差）；
`followPath` 不做避障重规划，卡住（位置 2 秒没变）就返回 false。
`dig` / `bridge` / `jump` 是三种**规划期**动作（不是事后补救）：A* 会把「挖穿两格高障碍」
（代价 `1 + 3×格数`）、「在悬空处垫一块」（代价 `1 + 6`）、「跳过 1 格宽的空隙」（代价 `1 + 2.5`）
也算成可走的边，
于是它会自己权衡绕路还是挖/垫。执行时 `followPath` 在进入这类节点前先挖/先垫。
`bot.diggableAt(x,y,z)` 判定能不能挖（基岩/水/岩浆不行）。
`goto` 失败后还有兜底：沿目标方向扫 1~3 格挖两格再重新规划，最多 `retries` 次。
不要用 `bot.lookAt()` 改朝向——1.7 的 physics 用 `(sin(yaw), cos(yaw))` 当前向，
`followPath` 里直接写 `bot.entity.yaw = atan2(dx, dz)`。

### 6.2 挖矿循环

把「找矿 → 走过去 → 挖掉 → 捡掉落物」串成一句。方块名可以带 `minecraft:` 前缀，也可以不带
（GTNH 的注册名本身不带前缀）。

```js
const mined = await bot.mineNearby('coal_ore', { count: 4, radius: 16 })
const mined = await bot.mineNearby(['gregtech:gt.blockores', 'minecraft:iron_ore'], { count: 8 })
await bot.mineBlock(someBlock)        // 挖指定的一块
await bot.collectDrops({ collectMs: 4000 })
```

`count` 是目标块数，`radius` 是搜索半径（格），`dig` 默认 true（走过去时允许挖穿挡路的方块），
`collect` 默认 true。挖不到（够不着、没工具、被基岩挡住）就跳过那一块继续找下一块，
返回值是实际挖掉的块（数组上挂着 `mined.skipped = [{ name, position, reason }]`），
最后一次失败原因在 `bot._lastMineReason`。

### 6.3 工具与挖掘等级

GTNH 里不同的方块要不同的工具：矿要镐（等级随材料升高）、机器要扳手、线缆/导线要剪线钳、
蜂箱要捕虫网。这些信息从服务端导成了 `gtnh-data/data/harvest.jsonl.gz`（17126 条），
`bot.dig` 之前会先查表、再确认手里有没有对应的工具。

```js
bot.toolNeeded(block)          // { tool: 'wrench', level: 1 } / { tool: 'pickaxe', level: 0 } / null
bot.findTools('wrench')        // 背包里能当扳手用的物品，按材质从好到差
await bot.equipToolFor(block)  // { ok, tool, need }，拿不到工具时 ok=false + reason
```

GT 的扳手、剪线钳、锤都是同一个物品 `gregtech:gt.metatool.01`，靠 damage 区分
（16 扳手 / 26 剪线钳 / 12 锤），`bot.findTools` 按 damage 认，不看名字。
**GT 的锤可以当镐用**（挖石、挖矿），所以 `pickaxe` 的候选里包含 hammer 和多功能工具。

**GT 没有自己的镐**：能挖矿的是匠魂的镐（镐头用 GT 材料做）、木镐（GT 唯一放行的原版镐）、
以及 GT 的硬锤。匠魂工具的 `InfiTool.MiningSpeed` 与耐久都在 NBT 里，`bot.findTools` 按
MiningSpeed 从快到慢排，耐久见底（`Durability <= 1`）的排在最后——它可以在装配台用主部件的
材料锭修好，但当下不该优先用。`bot.digTime` 也按 MiningSpeed 重算（`硬度 × 1500 × 1.2 / 速度`），
否则 mcdata 会按徒手估出 7.5 秒。

```js
// 挖机器：没有扳手会被拦下，不会白挖
const r = await bot.equipToolFor(machineBlock)
if (!r.ok) console.log(r.reason)   // '没有wrench（方块 gregtech:gt.blockmachines 需要）'
```

等级（`need.level`）目前只用于报告，还没做「等级不够就换更好的工具」——实机挖不动高等级矿时，
`bot.dig` 会超时，`_lastMineReason` 是「挖掘超时」。

### 6.4 任务书（BetterQuesting）

GTNH 的任务书导成了 `gtnh-data/data/quests.json`：3814 条任务、46 条任务线，
带前置关系和「交什么物品」的索引。`bot` 上挂了一层查询，用来回答「现在能交哪些任务、
还缺什么」。

```js
bot.quests()                   // 任务书对象（首次调用才加载，5MB JSON）
bot.questLines()               // 46 条线的 { id, name }
bot.questLine('Mass Processing')
bot.questsOfLine('Mass Processing')
bot.questByName('Shadow Metal')   // 先精确、再包含；返回数组
bot.questSearch('steel', { limit: 20 })
bot.questChain(questId)        // 从根到它，拓扑序，最后一个是它自己
bot.questForItem('gregtech:gt.metaitem.01', 11368)   // 哪些任务要交它
bot.questReady()               // 当前背包能交的任务（checkbox 之类记 unknown）
bot.questMissing(questId)      // [{ name, id, meta, need, have, ore }]
```

「缺的东西怎么弄」——`questPlan` 会把缺料接到配方上（原版合成 → GT 合成台 → mod 配方 →
GT 机器 → 熔炉，按这个顺序找第一条），默认往下拆两层：

```js
bot.questPlan(questId, { depth: 2, limit: 10 })
// [{ name, id, meta, need, have,
//    how: { kind: 'gt:gt.recipe.alloysmelter', eu: 120, dur: 3200,
//           inputs: [{ id, meta, count }],
//           next: [{ ...同结构 }] } | null }]
```

一个典型的「该干什么」循环：

```js
for (const q of bot.questReady({ limit: 5 })) console.log('能交：', q.name)
const q = bot.questByName('Shadow Metal')[0]
console.log('还缺：', bot.questMissing(q.id))
console.log('前置：', bot.questChain(q.id).map((x) => x.name))
```

底层数据在 `packages/gtnh-data/src/quests.js`（`loadQuests()` → `Quests` 实例，方法同上，
只是不带 `bot.` 前缀），格式与任务类型的字段见 FINDINGS §37。

### 6.5 任务脚本（让 bot 自己做一个任务）

`questPlan` 只告诉你「缺什么、能怎么弄」，`questSteps` 把它变成一串可执行的步骤，
`runQuest` 真的去执行：

```js
const plan = bot.questSteps('Soft Mallet Adventure')
// => { quest: { id, name, line },
//      steps: [ { kind:'mine',  item:'log',    meta:0, count:3, block:'log' },
//               { kind:'craft', item:'planks', meta:0, count:7, inputs:[...] },
//               { kind:'craft', item:'stick',  meta:0, count:2, inputs:[...] } ],
//      blocked: [],
//      ready: false }

const r = await bot.runQuest('Soft Mallet Adventure', { rounds: 6, radius: 24 })
// => { plan, log: [{ round, kind, item, count, ok, reason? }], missing: [], ready: true }
```

规划规则（`planQuest`）：

1. **工作台合成 / 熔炉** 优先——木板、木棍本身是方块，直接挖也拿得到，但有配方时按配方做。
   配方一次产多个时按产出数换算（`outputCount`），不是「要 7 个就合成 7 次」。
2. 没有再**挖**——先按物品名反查方块（`coal` → `coal_ore`），GT 的矿统一是
   `gregtech:gt.blockores`，只有名字本身是「某矿」才回落到它。
3. 都不行就看有没有**机器配方**（GT 机器 / mod 机器），有就进 `blocked` 并写「需要什么机器」，
   这一层不执行——机器配方要开 GUI、放流体，不在自动脚本的能力范围内。

执行规则（`runQuest`）：按轮重算，每轮重新 `planQuest`（背包变了缺料就少），
连续一轮零进展就停。挖掘用「背包净增」判断成功，不信任 `mineNearby` 的返回值。

到 `ready: true`（`missing` 为空）后会自动交给 `bot.submitQuest`。

交任务（默认走 BQ 自己的 FML 通道，和玩家点「提交」是同一条路）：

```js
await bot.submitQuest('I Want SOLIDS Not LIQUIDS!')
// => { ok: true, via: 'bq', verified: true }
// 前置没做/物品不够 => { ok: false, reason: '服务端没接受（前置没完成或物品不够）', reply: '...' }
```

服务端对失败是**静默**的，所以有 rcon 时会顺带 `bq_admin check` 核对一次（`verified`）。
`opts.verify: false` 跳过核对；`opts.via: 'rcon'` 退回管理员代交（不校验前置，多选一奖励
由服务端选）。通道格式见 FINDINGS §39.5。`runQuest` 的 `opts.submit: false` 可以关掉自动提交。

单独烧一炉：

```js
await bot.smeltItem('minecraft:iron_ingot', 2)       // 自己找原料和燃料
// => { ok: true, smelted: 1 }  或  { ok: false, reason: '熔料不够：要 2 个 iron_ore / ...' }
```

原料是**反查**的（`gtnhSmeltSource` / `gtnhSmeltSources`，产物 → 原料），一个产物常有
好几种原料（铁锭能烧原版铁矿，也能烧好几个 mod 的矿），按背包里真有的那个挑。
燃料顺序：煤 → 木炭 → 木板 → 原木 → 木棍。

⚠️ 熔炉窗口不要用上游的 `furnace.putFuel` / `putInput` / `takeOutput`——它们走
`window.findItemRange`，GTNH 的 4 字节 id 下匹配不到玩家背包里的物品（实测报
`Can't find iron_ore in slots [3 - 39]`）。`smelt` 内部是自己 `clickWindow` 点的。

## 7. 聊天

```js
const { loadLang, Lang } = require('gtnh-data')
const bot = createBot({ host: '127.0.0.1', port: 54615, username: 'bot',
                        mods: loadServerMods(), lang: new Lang(loadLang()) })

bot.formatMessage({ translate: 'dreamcraft.welcome.welcome', with: ['2.9.0'] })
// → 'Welcome to GregTech: New Horizons 2.9.0'
// 不带 lang 时 → 'dreamcraft.welcome.welcome(2.9.0)'（键名 + 参数）
bot.on('messagestr', (msg) => console.log(bot.formatMessage(msg)))
```

`Lang.key()` 先查中文再查英文；查不到就回退成 `键名(参数, …)` 的调试形式。
`loadLang()` 读 `data/raw/gtnh-2.9.0/lang`（296 个 mod 的键；只有 mod 键，没有 `container.*` 这类原版键，
所以箱子标题会是 `container.chest` 原文）。

## 8. 实体

```js
bot.entities                 // Map<id, Entity>
entity.name                  // 'Creeper' / 'enderzoo.ConcussionCreeper'（148 个 mod 实体）
entity.gtnhClass             // 'enderzoo.ConcussionCreeper'（mod 实体才有）
```

mod 实体没有 minecraft-data 条目，宽高按 0.6×1.8 兜底（`lib/gtnh/entities.js`）。
`fetchEntity(id)` 对没 spawn 的 id 也会建空实体（上游行为，见 FINDINGS §34.5）。

## 9. 1.7.10 与上游行为不同的地方

在 `lib/plugins/*.js` 里，都带 `GTNH-PATCH` 注释：

- `window_items` / `set_slot` / `open_window` —— 4 字节物品 id、46 槽（含副手）、`gtnhFlag`
- `clickWindow` —— 交易是 lenient 的（`bot.gtnhLenientTransactions`）
- `spawn_entity_living` —— 用 `mobs[type]` 而不是名字表
- 区块 —— `prismarine-chunk-1.7`（本仓库包）

改这些之前先读 [docs/MEMORY.md](MEMORY.md) §4 与 [docs/FINDINGS.md](FINDINGS.md) 对应小节。
