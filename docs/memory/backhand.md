# Backhand（副手槽）

> 给 1.7.10 加了副手槽 → **玩家窗口是 46 槽，不是 45**。

- 槽位：0 输出 / 1–4 合成 / 5–8 装备 / 9–35 背包 / 36–44 快捷栏 / **45 副手**。
- `gtnh-data` 的 feature 表把 `doesntHaveOffHandSlot` 覆盖成 `false`（`GTNH_OVERRIDES`）。
- 影响：所有窗口槽位换算都要按 46 槽算；合成产物可能落进副手。

## 关联
- → [[tconstruct]]：工具站/部件台窗口的玩家槽起点。
- → [[gregtech]]：GT 机器窗口的 `inventoryStart`。
