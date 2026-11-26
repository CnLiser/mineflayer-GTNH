# HarvestCraft（潘马斯农场）

> 关联：[[gregtech]]

> 切菜板 51 / 烹饪锅 63 / 动物陷阱 3 / 鱼陷阱 1，共 118 条。

## 数据入口
- `com.pam.harvestcraft.CraftingManagerPamCuttingBoard.getInstance().getRecipeList()`（51）
- `com.pam.harvestcraft.CraftingManagerPamPot.getInstance().getRecipeList()`（63）
  —— 两者返回的都是 `List<IRecipe>`（ShapedRecipes / ShapelessOreRecipe 混合），和原版合成台一样读。
- `com.pam.harvestcraft.TrapRecipes.ANIMAL_TRAP_RECIPES` / `FISH_TRAP_RECIPES`：
  `Map<Item, List<WeightedItemStack>>`（3 / 1 个 bait）。

## 坑
- **加权掉落**：`TrapRecipes$WeightedItemStack extends WeightedRandom$Item`，`stack` 是 public 字段，
  权重在**父类**，SRG 名是 `field_76292_a`（不是 `itemWeight`）。
  dump 写 `out: [{stack, weight}]`，归一化拆成普通 `out` + `extra.weights`（与 `out` 等长）。
- 陷阱的 key 是**诱饵 Item**（不是配方产物）→ `ins: [[bait]]`；权重列表是产物。

## 关联
- 无跨 mod 依赖；产物都进原版合成/熔炉以外的新页面。
