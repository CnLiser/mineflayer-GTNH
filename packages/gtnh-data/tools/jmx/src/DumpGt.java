import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/** GT recipe map 导出：遍历 RecipeMap.ALL_RECIPE_MAPS -> getAllRecipes() -> GTRecipe 字段。 */
public class DumpGt {
  static StringBuilder sb = new StringBuilder();
  static Class<?> clsStack;
  static Class<?> clsItem;
  static Method mGetItem;
  static Method mGetIdFromItem;
  static Field fCount;
  static Field fMeta;
  static Field fRegistry;
  static Method mRegistryName;
  static Field fFluidName; // FluidStack.fluid
  static Field fAmount;    // FluidStack.amount
  static Method mFluidName;
  static int recipeCount = 0;
  static int mapCount = 0;

  public static void agentmain(String args, Instrumentation inst) {
    try {
      run(args, inst);
    } catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static Class<?> find(Instrumentation inst, String name) {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(name)) return c;
    return null;
  }

  static String esc(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 32) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }

  static String itemName(Object item) {
    if (item == null) return null;
    try { if (mRegistryName != null && fRegistry != null) return (String) mRegistryName.invoke(fRegistry.get(null), item); } catch (Throwable t) {}
    return null;
  }

  static String stack(Object st) {
    if (st == null) return "null";
    try {
      Object item = mGetItem.invoke(st);
      if (item == null) return "null";
      int id = (Integer) mGetIdFromItem.invoke(null, item);
      int meta = fMeta.getInt(st);
      int count = fCount.getInt(st);
      return "{\"id\":" + id + ",\"name\":" + esc(itemName(item)) + ",\"meta\":" + meta + ",\"count\":" + count + "}";
    } catch (Throwable t) {
      return "null";
    }
  }

  static String stacks(Object arr) {
    if (arr == null) return "[]";
    StringBuilder b = new StringBuilder("[");
    int n = Array.getLength(arr);
    for (int i = 0; i < n; i++) {
      if (i > 0) b.append(',');
      b.append(stack(Array.get(arr, i)));
    }
    return b.append(']').toString();
  }

  static String fluids(Object arr) {
    if (arr == null) return "[]";
    StringBuilder b = new StringBuilder("[");
    int n = Array.getLength(arr);
    for (int i = 0; i < n; i++) {
      Object fs = Array.get(arr, i);
      if (i > 0) b.append(',');
      if (fs == null) { b.append("null"); continue; }
      String name = null;
      int amount = 0;
      try {
        Object fluid = fFluidName.get(fs);
        amount = fAmount.getInt(fs);
        if (fluid != null && mFluidName != null) name = (String) mFluidName.invoke(fluid);
      } catch (Throwable t) {}
      b.append("{\"fluid\":").append(esc(name)).append(",\"amount\":").append(amount).append('}');
    }
    return b.append(']').toString();
  }

  static void run(String args, Instrumentation inst) throws Exception {
    Class<?> clsMap = find(inst, "gregtech.api.recipe.RecipeMap");
    Class<?> clsRecipe = find(inst, "gregtech.api.util.GTRecipe");
    Class<?> clsFluid = find(inst, "net.minecraftforge.fluids.FluidStack");
    if (clsMap == null || clsRecipe == null) throw new IllegalStateException("RecipeMap/GTRecipe 未加载");
    clsStack = find(inst, "net.minecraft.item.ItemStack");
    clsItem = find(inst, "net.minecraft.item.Item");
    mGetItem = clsStack.getDeclaredMethod("func_77973_b");
    mGetIdFromItem = clsItem.getDeclaredMethod("func_150891_b", clsItem);
    fCount = clsStack.getDeclaredField("field_77994_a");
    fMeta = clsStack.getDeclaredField("field_77991_e");
    for (Field f : clsItem.getDeclaredFields()) {
      if (f.getType().getName().endsWith("RegistryNamespaced")) { fRegistry = f; break; }
    }
    if (fRegistry != null) {
      fRegistry.setAccessible(true);
      Object reg = fRegistry.get(null);
      for (Method m : reg.getClass().getMethods()) {
        String n = m.getName();
        if ((n.equals("getNameForObject") || n.equals("func_148750_c")) && m.getParameterTypes().length == 1) { mRegistryName = m; break; }
      }
    }
    if (clsFluid != null) {
      for (Field f : clsFluid.getDeclaredFields()) {
        if (f.getType().getName().equals("net.minecraftforge.fluids.Fluid")) fFluidName = f;
        if (f.getType() == int.class && f.getName().toLowerCase().contains("amount")) fAmount = f;
      }
      Class<?> clsFluidType = find(inst, "net.minecraftforge.fluids.Fluid");
      if (clsFluidType != null) {
        try { mFluidName = clsFluidType.getMethod("getName"); } catch (Throwable t) {
          for (Method m : clsFluidType.getDeclaredMethods()) if (m.getReturnType() == String.class && m.getParameterTypes().length == 0) { mFluidName = m; break; }
        }
      }
    }

    Field fAll = clsMap.getField("ALL_RECIPE_MAPS");
    Map<?, ?> maps = (Map<?, ?>) fAll.get(null);
    Method getAll = clsMap.getDeclaredMethod("getAllRecipes");
    Field fUnlocal = clsMap.getField("unlocalizedName");
    for (Map.Entry<?, ?> e : maps.entrySet()) {
      Object map = e.getValue();
      if (map == null) continue;
      String mapName;
      try { mapName = String.valueOf(fUnlocal.get(map)); } catch (Throwable t) { mapName = String.valueOf(e.getKey()); }
      Collection<?> recipes;
      try { recipes = (Collection<?>) getAll.invoke(map); } catch (Throwable t) { continue; }
      mapCount++;
      for (Object r : recipes) {
        try {
          if (r.getClass() != clsRecipe) continue; // 只用 GTRecipe 本体，跳过子类特例
          boolean hidden = clsRecipe.getDeclaredField("mHidden").getBoolean(r);
          if (hidden) continue;
          boolean fake = clsRecipe.getDeclaredField("mFakeRecipe").getBoolean(r);
          if (fake) continue;
          int eu = clsRecipe.getDeclaredField("mEUt").getInt(r);
          int dur = clsRecipe.getDeclaredField("mDuration").getInt(r);
          Object in = clsRecipe.getDeclaredField("mInputs").get(r);
          Object out = clsRecipe.getDeclaredField("mOutputs").get(r);
          Object fin = clsRecipe.getDeclaredField("mFluidInputs").get(r);
          Object fout = clsRecipe.getDeclaredField("mFluidOutputs").get(r);
          sb.append("{\"map\":").append(esc(mapName))
            .append(",\"eu\":").append(eu)
            .append(",\"dur\":").append(dur)
            .append(",\"in\":").append(stacks(in))
            .append(",\"out\":").append(stacks(out))
            .append(",\"fin\":").append(fluids(fin))
            .append(",\"fout\":").append(fluids(fout))
            .append("}\n");
          recipeCount++;
        } catch (Throwable t) {}
      }
    }
    File file = new File(args, "gt-recipes.jsonl");
    try (Writer w = new OutputStreamWriter(new FileOutputStream(file), "UTF-8")) { w.write(sb.toString()); }
    try (Writer w = new OutputStreamWriter(new FileOutputStream(new File(args, "gt-recipes-meta.json")), "UTF-8")) {
      w.write("{\"maps\":" + mapCount + ",\"recipes\":" + recipeCount + "}\n");
    }
  }
}
