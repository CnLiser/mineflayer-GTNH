# Et Futurum

> 关联：[[gregtech]]

> 锻造台（Smithing Table）9 条，把 1.16 的锻造台带进 1.7.10。

## 数据入口
- `ganymedes01.etfuturum.recipes.SmithingTableRecipes.getInstance().getRecipes()`（9）
  字段：`input`(Object) / `material`(Object) / `output` / `copyNBT`(boolean)。

## 坑
- **`copyNBT` 是语义的一部分**：`netherite_pickaxe` 那条要把钻石镐的附魔/耐久带过去，
  所以 `extra.copyNbt = true`；漏了这条，查「钻石镐 → 下界合金镐」就解释不了附魔为什么保留。
- `input`/`material` 是 Object，可能是 ItemStack 也可能是矿辞 List，按原版 ShapelessOreRecipe 展开。

## 关联
- 无。
