# Blood Magic

> 炼金 / 血祭坛 / 绑定；数据 162 条。

## 数据入口
- `WayofTime.alchemicalWizardry.api.alchemy.AlchemyRecipeRegistry.recipes(60)`
- `…altarRecipeRegistry.AltarRecipeRegistry.altarRecipes(64)`
- `…bindingRegistry.BindingRegistry.bindingRecipes(19)` / `UnbindingRegistry.unbindingRecipes(19)`

## 坑
- **三套配方字段名完全不同**：Alchemy 用私有的 `output/recipe/bloodOrbLevel/amountNeeded`；Altar 用 `input/result/minTier/liquidRequired…`；Binding 用 `requiredItem/outputItem`。按一类通用的 input/output 猜一定全空。

## 关联
- 与 [[gregtech]] 无耦合。
