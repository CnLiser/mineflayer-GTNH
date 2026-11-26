# Binnie（Extra Bees / Extra Trees / Botany）

> 关联：[[forestry]]

> 培养器 160 + 蜜蜂突变 153 + 花突变 37；产物是**物种**，不是物品。

## 数据入口
- `binnie.core.machines.inventory.Incubator.RECIPES` → `List<IncubatorRecipe>`，160 条。
  `IncubatorRecipe` = `input`/`output`(FluidStack) / `inputStack`/`outputStack` / `lossChance` / `tickChance`，
  getter：`getExpectedOutput()` / `getInputStack()` / `getChance()` / `getLossChance()`。
  产物基本是流体（`binnie.growthmedium` / `binnie.bacteria` / `bacteriapoly` / `bacteriavector`），
  所以 `out` 大多为空、`fluidOut` 有值；160 条里 153 条带 `outputStack`。
- `binnie.extrabees.genetics.ExtraBeeMutation.mutations` → 153 条 `IMutation`。
- `binnie.botany.genetics.FlowerHelper.flowerMutations` → 37 条；同类的 `flowerTemplates` 50 条是模板不是配方。

## 坑
- Forestry 的 `IMutation` 只有 `getAllele0()/getAllele1()/getTemplate()/getBaseChance()/isSecret()`，
  没有 id —— 归一化成 `{"species":"Arid"}`，输入输出都是物种。
- 物种没有物品 id，**不能进 `byOutput` 索引**（会生成 `undefined:0` key），测试里断言它不存在。
- `build-mod-recipes.js` 的 `asAlternatives` 要认 `isSpecies()`，否则物种格会被当无效数据丢掉。

## 查询
- `bot.modRecipesForSpecies('Arid')`（产物或亲本命中）/ `bot.modRecipeSpecies()`（144 个产物侧物种名）。
- 物种没有物品 id，`byOutput` / `byInput` 查不到；`byOutput(undefined)` 曾经会把 190 条物种配方全捞出来，
  已修成「非数字 id 直接返回空」。
- 卡片里 37 条花突变 + 153 条蜜蜂突变 + 160 条培养器 = 350 条。

## 关联
- → [[forestry]]：`IMutation` / `IAllele` 接口与基因系统都来自 Forestry；ExtraTrees 的树突变本批未做。
