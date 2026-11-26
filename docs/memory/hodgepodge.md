# Hodgepodge（1.7.10 杂项修复集）

> 它改了两个线格式，是「偶发/诡异 bug」的常见来源。

1. **登录包多 4 字节**：`MixinS01PacketJoinGame_FixDimensionID` 在包尾追加 `writeInt(dimension)` → `Chunk size is 17 but only 13 was read`。修法：`GTNH_LOGIN_PACKETS` 用 restBuffer 收 `dimensionId`。
2. **位置包的 stance 校验**：发错会 `had an illegal stance` + `hodgepodge.disconnect.illegal_stance` 踢人。
3. **NBT 长度**：`MixinPacketBuffer` 把 null 写成 `short(-1)`、超长写 `short(32767)+int+bytes`（顺序不变，只影响大 NBT）。
4. `MixinNetHandlerPlayClient_FixHandleSetSlot` 只做槽位越界检查，不改线格式。

## 关联
- → [[chunkapi-endlessids]]：同在协议层改字段。
- 协议补丁位置：`packages/protocol-fml/src/index.js`。
