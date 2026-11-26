# Thaumcraft（TC）

> 奥术合成 / 注魔 / 坩埚；数据里 2180 条（六个 mod 里最多）。

## 数据入口（服务端反射）
- `thaumcraft.api.ThaumcraftApi.getCraftingRecipes()` → 一个 List **混着 5 种类型**，按类名后缀分派：
  - `ShapedArcaneRecipe`（output/input/aspects/research/width/height）→ `arcane_shaped` 586
  - `ShapelessArcaneRecipe` → `arcane_shapeless` 35
  - `InfusionRecipe`（getRecipeOutput/getComponents/getAspects/getResearch/getInstability）→ `infusion` 652
  - `InfusionEnchantmentRecipe` → `infusion_enchant` 50
  - `CrucibleRecipe`（catalyst/aspects/key）→ `crucible` 777
  - 其它 mod 注册进来的 → `infusion_other` 80（方法名做兜底链）

## 坑
- AspectList：`getAspects()` 拿 `Aspect[]`，再 `getAmount(aspect)`。
- 24 条 infusion 的 output 是 `[null,null]` 的变体列表。
- 客户端不加载，必须靠 agent attach；同 JVM 换代码要**换类名**。

## 关联
- → [[tconstruct]]：无直接交互。
- 数据与归一化：`data/recipes/mod-recipes.json`（`research`/`aspects` 在 `extra`）。
