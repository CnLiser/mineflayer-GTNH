# IC2（IndustrialCraft 2）

> 机器配方在 GTNH 里几乎全被清空，只剩 3 条。

## 数据入口
- `ic2.api.recipe.Recipes` 的 14 个 `IMachineRecipeManager` 静态字段（macerator/extractor/compressor/centrifuge/blockcutter/blastfurance/metalformer*/oreWashing/matterAmplifier…）。
- `getRecipes()` → `Map<IRecipeInput, RecipeOutput>`。
- 实测：**macerator/extractor/compressor/centrifuge/blockcutter/oreWashing 全是 Map(0)**，只有 `metalformerCutting` 1 条 + `matterAmplifier` 2 条 → 0 条是真的，不是导出 bug。

## 关联
- → [[gregtech]]：GTNH 用 GT 机器取代 IC2 机器。
