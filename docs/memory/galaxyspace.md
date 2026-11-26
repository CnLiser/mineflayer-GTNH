# GalaxySpace（星系空间）

> 关联：[[galacticraft]] → [[gregtech]]

> 火箭配方 32 条（T1..T8 各 4 条），材料是 19–53 格的散列，不是 3x3。

## 数据入口
- `galaxyspace.core.recipe.RocketRecipes.RECIPES_ROCKET_T1 .. T8` 各一个 `List<NasaWorkbenchRecipe>`。
- `NasaWorkbenchRecipe`（在 Galacticraft jar 里）：
  `output`(ItemStack) / `input`(**HashMap<Integer, ItemStack>**) +
  `getRecipeSize() / getRecipeOutput() / getRecipeInput()`。

## 坑
- `input` 的 key 是槽位号，但 **不是 0..8**：T1 的 key 是 `[1,2,3,4,7..21]` 共 19 个，
  T8 是 1..53。按 3x3 归一塞会丢掉 9 号以后的槽 —— 第一版就是这样少了 34 格。
- 处理：跨度 ≤ 9 才按网格（`extra.w/h`），否则按 key 升序平铺，`extra.keys` 记原槽位；
  `build-mod-recipes.js` 对带 `extra.keys` 的也保位（`keepHoles`），否则空槽会与 keys 错位。
- `getRecipeSize()` 返回的是**条目数**（19/53），不是边长。
- `AssemblyRecipes.RECIPES` 是空的，别白跑。

## 关联
- → [[galacticraft]]：`NasaWorkbenchRecipe` 与火箭部件（noseCone/heavyPlating/engine/rocketFins）都来自 Galacticraft。
