# Galacticraft

> 电路制造 / 压缩机；数据 14 条。

## 数据入口
- `micdoodle8.mods.galacticraft.api.recipe.CircuitFabricatorRecipes.recipes`（`HashMap<ItemStack[], ItemStack>`，private static）= 9
- `CompressorRecipes.recipes`（`List<IRecipe>`，private static）= 2
- `recipesAdventure` = 3

## 坑
- 类启动时不加载 → 用 `ProbeLoad` 按 jar 里的类名 `Class.forName` 强制加载后再读静态字段。

## 关联
- 与 [[gregtech]] 无耦合。
