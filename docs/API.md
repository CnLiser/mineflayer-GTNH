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

`bot` 上：`bot.formatMessage(input)`（同 `formatMessage(input, options.lang)`）、
`bot.supportFeature(feature)`、`bot.registry`（FML 注册表注入，blocks 4258 / items 11343）。

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
