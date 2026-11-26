# Railcraft

> 滚压机 / 焦炉 / 高炉；数据 346 条。

## 数据入口
- `mods.railcraft.api.crafting.RailcraftCraftingManager` 四个 static 字段：`rollingMachine / cokeOven / blastFurnace / rockCrusher`。
- 条数：rolling_shaped 19 / coke_oven 164 / blast_furnace 163；**rockCrusher 0（表是空的）**。

## 坑
- GTNH 的滚压机配方用 **`net.minecraftforge.oredict.ShapedOreRecipe`**，它 `implements afg` 但**不继承 `ShapedRecipes`** → 按类名分派必须先判它，否则只拿到产物、原料全丢。
- 格子里可能是 `List<ItemStack>`（矿辞备选），不是单个 ItemStack。

## 关联
- 与 [[gregtech]] 无耦合。
