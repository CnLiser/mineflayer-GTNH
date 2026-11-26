# Witchery

> 蒸馏 / 坩埚 / 纺车 / 火盆 / 酿造仪式；数据 85 条。

## 数据入口
- 三个 `private static final INSTANCE` + `public static X instance()`（配方在 `public final ArrayList<...Recipe> recipes`）：
  `DistilleryRecipes`(9) / `KettleRecipes`(38) / `SpinningRecipes`(4)。
- `BrazierRecipes.instance().recipes`(8)：产物是**效果**不是物品 → `out: []`、`extra.effect`（如 `witchery.brazier.spectre`）。
- `WitcheryBrewRegistry` **只有 INSTANCE 字段没有 instance()** → 遍历 declaredFields 找「static 且类型等于自身」。

## 坑
- 静态方法必须 `m.invoke(null, …)`；把 Class 当 receiver 会静默返回 null。
- 物品 id 用 `Item.func_150891_b(Item)`（静态单参），按实例零参调一律返回 0。

## 关联
- → [[tconstruct]]：无。
- 女巫烤炉用原版 `FurnaceRecipes`，所以不单独导（已在「熔炉 9683」里）。
