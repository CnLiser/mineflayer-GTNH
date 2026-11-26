# Avaritia（无尽贪婪）

> 关联：[[tconstruct]]

> 极值合成（Extreme Crafting）135 条，9x9 或 9x5 网格。

## 数据入口
- `fox.spiteful.avaritia.crafting.ExtremeCraftingManager.getInstance().getRecipeList()` →
  `List<IRecipe>`，混三种类型（**都只有 public 字段，没有 getter**）：
  - `ExtremeShapedOreRecipe`：`output` / `input`(Object[]) / `width`,`height`
  - `ExtremeShapedRecipe`：`recipeOutput` / `recipeItems`(ItemStack[]) / `recipeWidth`,`recipeHeight`
  - `ExtremeShapelessRecipe`：`recipeOutput` / `recipeItems`(List)
- 归一化后 `extra.w/h` = 9x9 或 9x5，`ins` 长度 81 或 45。

## 坑
- **空格必须占位**：81 格里大量是空 cell（135 条里 121 条含空格），删掉空格网格会塌成错位。
  `build-mod-recipes.js` 对带 `extra.w/h` 的配方不删空 cell。
- getRecipeList 里有 3 条 `output == null` 的无效配方（138 - 3 = 135），dump 时跳过。
- `input` 元素既可能是 ItemStack 也可能是 `List<ItemStack>`（矿辞），需展开成备选数组。

## 关联
- → [[tconstruct]]：极值合成用到工具部件（锤/锯等）。
