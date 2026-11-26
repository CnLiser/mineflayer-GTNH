# Forestry

> 蜂箱 / 木工 / 离心；数据 1280 条。

## 数据入口
- `forestry.api.recipes.RecipeManagers` 的 8 个 public static manager：`carpenterManager / centrifugeManager / fermenterManager / moistenerManager / squeezerManager / stillManager / fabricatorManager / fabricatorSmeltingManager`。
- 条数：carpenter 418 / centrifuge 154 / squeezer 280 / fermenter 314 / still 3 / moistener 7 / fabricator 93 / fabricator_smelting 11。

## 坑（最坑的一个 mod）
- **真正的配方表是 `recipes()`（返回 `Set<ICarpenterRecipe>`），不是 `getRecipes()`** —— 后者是「按原料查」的缓存 Map，会把导出全变成空。
- **`IRecipe.getRecipeOutput` 在运行时是 SRG 名 `func_77571_b`**，输出必须兜底。
- 实现类是包私有的 → 反射要用 `getDeclaredMethods()` + `setAccessible(true)`，否则整批字段 null。

## 关联
- 与 [[gregtech]] 无耦合；产物 id 参与全局注册表。
