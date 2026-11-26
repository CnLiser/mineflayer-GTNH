# Applied Energistics 2

> 压印器 / 研磨机；GTNH 里研磨机配方被清空。

## 数据入口
- `AEApi.instance().registries()` → `grinder()` / `inscriber()`。
- `IGrinderRegistry.getRecipes()` → `List<IGrinderEntry>`（**0 条**，GTNH 清空）。
- `IInscriberRegistry.getRecipes()` → `Collection<IInscriberRecipe>`（**12 条**），`getProcessType()` 为 `Inscribe` / `Press`。
- 包名是 `appeng.api.features.*`（不是 `appeng.api.recipes.*`）。

## 关联
- → [[gregtech]]：GTNH 用 GT 机器替代 AE2 研磨。
