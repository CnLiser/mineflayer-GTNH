# ChunkAPI + EndlessIDs（区块 / 方块 / 物品 id 加宽）

> 真正改区块包的是 **ChunkAPI**（`chunkapi-1.7.10-0.8.4.jar`）；EndlessIDs 提供加宽的数据管理器。

## 容器格式（S21 / S26 的载荷）
```
int managerCount                      // 小端
for each manager: int idLen; bytes id; int blobLen; bytes blob
```
**容器里的 int 小端，manager blob 里的 int 大端**（Java `ByteBuffer.slice()` 会重置成 BE）。

## manager 表
| id | 内容 |
| --- | --- |
| `endlessids:blockid` | 24 位 id，2 bit/段掩码，B1 4096 + B2Low/B2High 各 2048 + B3 4096 |
| `endlessids:metadata` | 16 位 meta，M1Low/M1High/M2 |
| `endlessids:biome` | 512 字节（256 个大端 short） |
| `minecraft:blockid` | short msbMask + 4096 LSB + 可选 2048 高位 |
| `minecraft:blocklight` / `skylight` | 无包头，每段 2048 半字节 |
| `gregtech:clientmeta` | 每 tracker `int count + count×(long pos + short meta)`；**方块包 0 字节** |

## 其它线格式
- S26 `map_chunk_bulk`：`short count; int[count] sizes; int deflated; bool sky; zlib; count×{x,z,mask}`。
- S23 `block_change`：`long packedPos`（x 26 / y 12 / z 26）+ `int count` + 每 manager 的 `string id + 定长数据`（**没有长度前缀**，未知 manager 没法跳）。
- S22 `multi_block_change`：chunkX/chunkZ + varint count + 每条 `short pos` + 同 S23 的容器。
- **物品 id 4 字节**（`slot` 的 blockId = i32）。

## 关联
- → [[gregtech]]：clientmeta manager。
- → [[tconstruct]]：物品 id 加宽让 TiC 部件 id > 4095。
- → [[modularui2]]：无关（不同通道）。
