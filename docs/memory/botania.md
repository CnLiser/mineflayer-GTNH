# Botania

> 花药 / 符文祭坛 / 魔力灌注 / 精灵交易；数据 304 条。

## 数据入口
- `vazkii.botania.api.BotaniaAPI` 的 static 列表：`petalRecipes(45)` / `pureDaisyRecipes(6)` / `manaInfusionRecipes(165)` / `runeAltarRecipes(49)` / `elvenTradeRecipes(18)` / `brewRecipes(21)`。

## 坑
- **魔力灌注的输入字段是单数 `input`**（不是 inputs），取输入要四级兜底：`getInputs → getInput → inputs → input`。
- `RecipeRuneAltar extends RecipePetals`，多一个 `mana`。

## 关联
- 与 [[gregtech]] 无耦合。
