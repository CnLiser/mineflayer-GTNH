import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/**
 * 逐个 mod 的配方导出（NEI 里非 GT 的页面 = 各 mod 自己的配方注册表）。
 *
 * 用法（attach）：
 *   java -cp <tools> Attach <pid> DumpMods "<outdir> <mod1,mod2,...>"
 * agentmain args = "<outdir> <mods>"
 *
 * 每行一条 JSON：
 *   {"mod":"thaumcraft","kind":"arcane_shaped","research":"...","aspects":{...},
 *    "in":[{id,meta,count}],"out":{...},"fluidIn":[...],"fluidOut":[...],"time":n,"extra":{...}}
 */
public class DumpMods3 {
  static StringBuilder out = new StringBuilder();
  static Class<?> clsStack, clsItem;
  static Method mGetItem, mGetIdFromItem, mRegistryName;
  static Field fCount, fMeta, fRegistry, fFluidName, fAmount;
  static Method mFluidName;
  static int lines = 0;

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.split(" ")[0] + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static Class<?> find(Instrumentation inst, String name) {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(name)) return c;
    return null;
  }

  static Object get(Object t, String field) {
    for (Class<?> c = t.getClass(); c != null; c = c.getSuperclass()) {
      try { Field f = c.getDeclaredField(field); f.setAccessible(true); return f.get(t); } catch (Throwable e) {}
    }
    return null;
  }

  static Object getStatic(Class<?> cls, String field) {
    for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
      try { Field f = c.getDeclaredField(field); f.setAccessible(true); return f.get(null); } catch (Throwable e) {}
    }
    return null;
  }

  /** 在 cls 及其接口/父类上找无参（或给定参数）方法并调用。 */
  static Object call(Object target, String name, Object... args) {
    if (target == null) return null;
    for (Class<?> c = target.getClass(); c != null; c = c.getSuperclass()) {
      for (Method m : c.getMethods()) {
        if (!m.getName().equals(name) || m.getParameterCount() != args.length) continue;
        try { m.setAccessible(true); return m.invoke(target, args); } catch (Throwable t) {}
        try { m.setAccessible(true); return m.invoke(target, args); } catch (Throwable t) {}
      }
    }
    return null;
  }

  static Object callStatic(Class<?> cls, String name, Object... args) {
    for (Method m : cls.getMethods()) {
      if (!m.getName().equals(name) || m.getParameterCount() != args.length) continue;
      try { m.setAccessible(true); return m.invoke(null, args); } catch (Throwable t) {}
    }
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
      return "{\"id\":" + id + ",\"name\":" + esc(itemName(item)) + ",\"meta\":" + fMeta.getInt(st) + ",\"count\":" + fCount.getInt(st) + "}";
    } catch (Throwable t) { return "null"; }
  }

  /** ItemStack / ItemStack[] / Collection / Object[] 一律转成数组式 JSON（保留 null 位）。 */
  static String stacks(Object src) {
    if (src == null) return "[]";
    List<Object> list = new ArrayList<>();
    if (src.getClass().isArray()) {
      int n = Array.getLength(src);
      for (int i = 0; i < n; i++) list.add(Array.get(src, i));
    } else if (src instanceof Collection) {
      list.addAll((Collection<?>) src);
    } else {
      list.add(src);
    }
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < list.size(); i++) {
      if (i > 0) b.append(',');
      b.append(stack(list.get(i)));
    }
    return b.append(']').toString();
  }

  static String fluid(Object fs) {
    if (fs == null) return "null";
    try {
      Object fluid = fFluidName.get(fs);
      int amount = fAmount.getInt(fs);
      String name = null;
      if (fluid != null && mFluidName != null) name = (String) mFluidName.invoke(fluid);
      return "{\"fluid\":" + esc(name) + ",\"amount\":" + amount + "}";
    } catch (Throwable t) { return "null"; }
  }

  static String fluidAsStack(Object fluid) { // Fluid（不是 FluidStack）
    if (fluid == null) return "null";
    try { return "{\"fluid\":" + esc((String) mFluidName.invoke(fluid)) + ",\"amount\":0}"; } catch (Throwable t) { return "null"; }
  }

  static String aspects(Object aspectList) {
    if (aspectList == null) return "{}";
    try {
      Object arr = call(aspectList, "getAspects");
      if (!(arr instanceof Object[])) return "{}";
      StringBuilder b = new StringBuilder("{");
      boolean first = true;
      for (Object a : (Object[]) arr) {
        if (a == null) continue;
        Object tag = call(a, "getTag");
        Object amt = call(aspectList, "getAmount", a);
        if (!first) b.append(',');
        first = false;
        b.append(esc(tag == null ? String.valueOf(a) : (String) tag)).append(':').append(amt);
      }
      return b.append('}').toString();
    } catch (Throwable t) { return "{}"; }
  }

  static void emit(String json) {
    out.append(json).append('\n');
    lines++;
    if (lines % 5000 == 0) { } // 保留计数，不打断
  }

  static String head(String mod, String kind) {
    return "{\"mod\":" + esc(mod) + ",\"kind\":" + esc(kind);
  }

  // ---------------- 各 mod ----------------

  static void thaumcraft(Instrumentation inst) {
    Class<?> api = find(inst, "thaumcraft.api.ThaumcraftApi");
    if (api == null) { emit(head("thaumcraft", "missing") + "}"); return; }
    Object list = callStatic(api, "getCraftingRecipes");
    if (!(list instanceof List)) { emit(head("thaumcraft", "empty") + "}"); return; }
    for (Object r : (List<?>) list) {
      if (r == null) continue;
      String cn = r.getClass().getName();
      String kind;
      String outJson = "null", inJson = "[]", asp = "{}", research = "null", extra = "{}";
      if (cn.endsWith("ShapedArcaneRecipe")) {
        kind = "arcane_shaped";
        outJson = stack(get(r, "output")); inJson = stacks(get(r, "input"));
        asp = aspects(get(r, "aspects")); Object res = get(r, "research"); research = esc(res == null ? null : String.valueOf(res));
        extra = "{\"w\":" + get(r, "width") + ",\"h\":" + get(r, "height") + "}";
      } else if (cn.endsWith("ShapelessArcaneRecipe")) {
        kind = "arcane_shapeless";
        outJson = stack(get(r, "output")); inJson = stacks(get(r, "input"));
        asp = aspects(get(r, "aspects")); Object res = get(r, "research"); research = esc(res == null ? null : String.valueOf(res));
        extra = "{\"size\":" + call(r, "getRecipeSize") + "}";
      } else if (cn.endsWith("InfusionEnchantmentRecipe")) {
        kind = "infusion_enchant";
        Object ench = call(r, "getEnchantment");
        outJson = "{\"enchant\":" + esc(ench == null ? null : String.valueOf(call(ench, "getName"))) + "}";
        inJson = stacks(call(r, "getComponents")); asp = aspects(get(r, "aspects"));
        Object res = get(r, "research"); research = esc(res == null ? null : String.valueOf(res));
        extra = "{\"xp\":" + get(r, "recipeXP") + ",\"instability\":" + get(r, "instability") + "}";
      } else if (cn.endsWith("InfusionRecipe")) {
        kind = "infusion";
        Object ro = call(r, "getRecipeOutput");
        if (ro == null) { ro = get(r, "recipeOutput"); if (ro == null) ro = get(r, "output"); }
        if (ro instanceof Object[]) { outJson = stacks(ro); } else { outJson = stack(ro); }
        inJson = stacks(call(r, "getComponents"));
        asp = aspects(call(r, "getAspects"));
        Object res = call(r, "getResearch"); research = esc(res == null ? null : String.valueOf(res));
        Object central = call(r, "getRecipeInput");
        extra = "{\"instability\":" + call(r, "getInstability") + ",\"center\":" + stack(central) + "}";
      } else if (cn.endsWith("CrucibleRecipe")) {
        kind = "crucible";
        outJson = stack(call(r, "getRecipeOutput")); asp = aspects(get(r, "aspects"));
        Object cat = get(r, "catalyst");
        Object key = get(r, "key"); research = esc(key == null ? null : String.valueOf(key));
        extra = "{\"catalyst\":" + stacks(cat) + "}";
      } else {
        // 其它 mod 往 TC 注册的配方：尽力而为
        kind = "infusion_other";
        Object ro = call(r, "getRecipeOutput");
        if (ro == null) { ro = get(r, "recipeOutput"); if (ro == null) ro = get(r, "output"); }
        outJson = (ro instanceof Object[]) ? stacks(ro) : stack(ro);
        Object comp = call(r, "getComponents");
        if (comp == null) comp = get(r, "components");
        if (comp == null) comp = get(r, "input");
        inJson = stacks(comp);
        Object asp2 = call(r, "getAspects");
        if (asp2 == null) asp2 = get(r, "aspects");
        if (asp2 != null) asp = aspects(asp2);
        Object res = call(r, "getResearch");
        if (res == null) res = get(r, "research");
        research = esc(res == null ? null : String.valueOf(res));
        extra = "{\"cls\":" + esc(cn) + "}";
      }
      emit(head("thaumcraft", kind) + ",\"out\":" + outJson + ",\"in\":" + inJson + ",\"aspects\":" + asp + ",\"research\":" + research + ",\"extra\":" + extra + "}");
    }
  }

  static void forestry(Instrumentation inst) {
    Class<?> rm = find(inst, "forestry.api.recipes.RecipeManagers");
    if (rm == null) { emit(head("forestry", "missing") + "}"); return; }
    String[][] mgrs = {
      {"carpenterManager", "carpenter"}, {"centrifugeManager", "centrifuge"},
      {"squeezerManager", "squeezer"}, {"fermenterManager", "fermenter"},
      {"stillManager", "still"}, {"moistenerManager", "moistener"},
      {"fabricatorManager", "fabricator"}, {"fabricatorSmeltingManager", "fabricator_smelting"},
    };
    for (String[] pair : mgrs) {
      Object mgr;
      try { mgr = getStatic(rm, pair[0]); } catch (Throwable t) { continue; }
      if (mgr == null) continue;
      Object recs = call(mgr, "getRecipes");
      if (!(recs instanceof Collection)) { System.err.println("forestry " + pair[1] + " mgr=" + mgr.getClass().getName() + " recs=" + recs); continue; }
      System.err.println("forestry " + pair[1] + " count=" + ((Collection<?>) recs).size());
      for (Object r : (Collection<?>) recs) {
        if (r == null) continue;
        String kind = pair[1];
        String outJson = "null", inJson = "[]", fluidIn = "[]", fluidOut = "[]", extra = "{}", time = "null";
        try {
          switch (kind) {
            case "carpenter": {
              Object grid = call(r, "getCraftingGridRecipe");
              outJson = stack(call(grid, "getRecipeOutput"));
              inJson = stacks(call(grid, "getIngredients"));
              fluidIn = "[" + fluid(call(r, "getFluidResource")) + "]";
              Object box = call(r, "getBox");
              time = String.valueOf(call(r, "getPackagingTime"));
              extra = "{\"box\":" + stack(box) + ",\"w\":" + call(grid, "getWidth") + ",\"h\":" + call(grid, "getHeight") + "}";
              break;
            }
            case "centrifuge": {
              inJson = stacks(call(r, "getInput"));
              Object prods = call(r, "getAllProducts");
              StringBuilder b = new StringBuilder("[");
              boolean first = true;
              int dropped = 0;
              if (prods instanceof Map) {
                for (Map.Entry<?, ?> e : ((Map<?, ?>) prods).entrySet()) {
                  if (dropped >= 4) break;
                  if (!first) b.append(',');
                  first = false;
                  b.append("{\"item\":").append(stack(e.getKey())).append(",\"chance\":").append(e.getValue()).append('}');
                  dropped++;
                }
              }
              b.append(']');
              outJson = b.toString();
              time = String.valueOf(call(r, "getProcessingTime"));
              break;
            }
            case "squeezer": {
              inJson = stacks(call(r, "getResources"));
              fluidOut = "[" + fluid(call(r, "getFluidOutput")) + "]";
              Object rem = call(r, "getRemnants");
              time = String.valueOf(call(r, "getProcessingTime"));
              outJson = "[]";
              extra = "{\"remnants\":" + stack(rem) + ",\"remnantsChance\":" + call(r, "getRemnantsChance") + "}";
              break;
            }
            case "fermenter": {
              inJson = stacks(call(r, "getResource"));
              fluidIn = "[" + fluid(call(r, "getFluidResource")) + "]";
              fluidOut = "[" + fluidAsStack(call(r, "getOutput")) + "]";
              extra = "{\"value\":" + call(r, "getFermentationValue") + ",\"modifier\":" + call(r, "getModifier") + "}";
              break;
            }
            case "still": {
              fluidIn = "[" + fluid(call(r, "getInput")) + "]";
              fluidOut = "[" + fluid(call(r, "getOutput")) + "]";
              time = String.valueOf(call(r, "getCyclesPerUnit"));
              break;
            }
            case "moistener": {
              inJson = stacks(call(r, "getResource"));
              outJson = stack(call(r, "getProduct"));
              time = String.valueOf(call(r, "getTimePerItem"));
              break;
            }
            case "fabricator": {
              Object[] ing = (Object[]) call(r, "getIngredients");
              inJson = stacks(ing);
              outJson = stack(call(r, "getRecipeOutput"));
              fluidIn = "[" + fluid(call(r, "getLiquid")) + "]";
              extra = "{\"plan\":" + stack(call(r, "getPlan")) + ",\"w\":" + call(r, "getWidth") + ",\"h\":" + call(r, "getHeight") + "}";
              break;
            }
            case "fabricator_smelting": {
              inJson = stacks(call(r, "getResource"));
              outJson = stack(call(r, "getProduct"));
              fluidIn = "[" + fluid(call(r, "getLiquid")) + "]";
              break;
            }
          }
        } catch (Throwable t) {
          continue;
        }
        emit(head("forestry", kind) + ",\"out\":" + outJson + ",\"in\":" + inJson
             + ",\"fluidIn\":" + fluidIn + ",\"fluidOut\":" + fluidOut
             + ",\"time\":" + time + ",\"extra\":" + extra + "}");
      }
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String[] parts = args.trim().split("\\s+");
    out.setLength(0); lines = 0;
    String outDir = parts[0];
    Set<String> mods = new HashSet<>(Arrays.asList(parts.length > 1 ? parts[1].split(",") : new String[]{"thaumcraft"}));
    clsStack = find(inst, "net.minecraft.item.ItemStack");
    clsItem = find(inst, "net.minecraft.item.Item");
    if (clsStack == null || clsItem == null) throw new IllegalStateException("ItemStack/Item 未加载");
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
    Class<?> clsFluidStack = find(inst, "net.minecraftforge.fluids.FluidStack");
    Class<?> clsFluid = find(inst, "net.minecraftforge.fluids.Fluid");
    if (clsFluidStack != null) {
      for (Field f : clsFluidStack.getDeclaredFields()) {
        if (f.getType().getName().equals("net.minecraftforge.fluids.Fluid")) fFluidName = f;
        if (f.getType() == int.class && f.getName().toLowerCase().contains("amount")) fAmount = f;
      }
    }
    if (clsFluid != null) {
      try { mFluidName = clsFluid.getMethod("getName"); } catch (Throwable t) {
        for (Method m : clsFluid.getDeclaredMethods()) if (m.getReturnType() == String.class && m.getParameterCount() == 0) { mFluidName = m; break; }
      }
    }

    if (mods.contains("thaumcraft")) { int before = lines; thaumcraft(inst); System.err.println("thaumcraft lines=" + (lines - before)); }
    if (mods.contains("forestry")) { int before = lines; forestry(inst); System.err.println("forestry lines=" + (lines - before)); }

    try (Writer w = new OutputStreamWriter(new FileOutputStream(new File(outDir, "mod-recipes.jsonl")), "UTF-8")) {
      w.write(out.toString());
    }
  }
}
