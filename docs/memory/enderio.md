# EnderIO

> SAG 磨粉 / 合金炉 / 切刀 / 发酵桶；数据 1689 条（全部 mod 里第二多）。

## 数据入口
- `crazypants.enderio.machine.MachineRecipeRegistry.instance`，各机器 `getInstance()` 后 `getRecipes()`：
  `CrusherRecipeManager`(sagmill) / `AlloyRecipeManager` / `SliceAndSpliceRecipeManager` / `VatRecipeManager`。
- 条数：sagmill 1663 / alloysmelter 11 / sliceandsplice 7 / vat 8。

## 坑
- 这些类**启动时不加载**，`inst.getAllLoadedClasses()` 找不到 → 必须 `Class.forName(name, false, 玩家类的 classLoader)` 强制加载。
- 概率数组拼 JSON 时首元素会多一个逗号（`[,1.0,0.1]`）→ 非法 JSON。

## 关联
- 与 [[gregtech]] 无耦合（但同属 NEI 页面）。
