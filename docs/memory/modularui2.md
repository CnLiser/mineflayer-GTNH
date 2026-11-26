# ModularUI2（GT 机器 GUI 框架）

> GTNH 2.9 的 GT 机器 GUI 全部走它：**没有 open_window**，容器内容仍走原版 window_items/set_slot。

## 协议
- **必须向 FML 注册 `modularui2` 通道**，否则服务器一个字节都不发。`handshake.js` 的 `DEFAULT_CHANNELS` 已含它。
- 包 id（`registerBoth` 各占 2 个）：`SClipboard=1 / SyncConfig=2 / OpenGuiPacket=3,4 / ReopenGuiPacket=5,6 / CloseGuiPacket=7,8 / CloseAllGuiPacket=9,10 / PacketSyncHandler=11,12`。
- `OpenGuiPacket` = `windowId varint + networkId varint + factory string + data buffer`（data 里是方块坐标）。
- `PacketSyncHandler` = `networkId varint + panel string + key string + action bool + value buffer`。
- 值编码：buf 首字节是 tag（`SYNC_VALUE=0`），bool 1 字节、int varint、long 8 字节 BE、物品槽 `bool + item + bool + bool`。

## 行为坑
- MUI2 容器的 **transaction 恒回 accepted=false，但点击照常执行** → 不能当失败；fork 只 emit `transactionMismatch`。
- MUI2 窗口里点**玩家槽**服务器完全不响应 → 取东西用 shift 点击。
- 窗口建立：`window_items` 落在未知 windowId 时，按 `slotCount - 36` 推算玩家背包起点开「隐式窗口」（`implicit=true`）。

## 已实现
- `packages/protocol-fml/src/gtnh/modularui.js`：`parsePacket` / `decodeSyncValue` / `collectSync`。
- `packages/mineflayer-fork/lib/gtnh/modularui.js`：`attachModularUI(bot)` → `bot.machineState / panelState / modularPanels`，事件 `modularOpen/modularSync/modularClose`。
- 冒烟：`npm run mui-smoke`（合金炉 10 个 key）。

## 关联
- → [[gregtech]]：所有 GT 机器 GUI + 控件同步。
- → [[tconstruct]]：TiC 方块同样不发 open_window，共用这套兜底。
