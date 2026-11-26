# WitchingGadgets

> 关联：[[witchery]]

> 地狱高炉 51 / 纺车 5，共 56 条。

## 数据入口
- `witchinggadgets.common.util.recipe.InfernalBlastfurnaceRecipe.recipes`（public static List，51）
  字段：`input`(Object) / `output` / `time` / `isSpecial` / `bonus`。
- `witchinggadgets.common.util.recipe.SpinningRecipe.recipeList`（public static List，5）
  字段：`output` / `input`(Object[])。

## 坑
- **`input` 是 `witchinggadgets.common.util.Utilities$OreDictStack`，不是 String**
  （`key` String + `amount` int）。按 String 强转会得到 20/51 条空输入；
  取 `key` 后走同一套 `oreAlt()`，`amount` 进 `extra.oreAmount`。
- `isSpecial` 的配方没有固定输入，靠 `bonus` 描述产物概率 → 不塞进 `ins`。

## 关联
- → [[witchery]]：同一套魔幻系材料（岩浆膏、神秘金属等）。
