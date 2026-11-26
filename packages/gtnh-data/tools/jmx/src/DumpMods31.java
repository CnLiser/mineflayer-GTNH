import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;

/**
 * 导出第二批 mod 配方：
 *   avaritia      极值工作台（9x9）
 *   harvestcraft  切菜板 / 烹饪锅 / 捕兽笼与鱼笼
 *   witchinggadgets 地狱高炉 / 纺车
 *   etfuturum     锻造台
 *
 * args = "<outFile>"
 * 输出 JSONL：{mod, kind, out:[stack], ins:[[alt...]], time, extra}
 */
public class DumpMods31 {
  static final StringBuilder out = new StringBuilder();
  static final StringBuilder notes = new StringBuilder();
  static int lines = 0;
  static ClassLoader cl;
  static Class<?> oreDict;

  public static void agentmain(String args, Instrumentation inst) {
    String outFile = args.split("\\|")[0].trim();
    try { run(args, inst); }
    catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(outFile + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String outFile = args.split("\\|")[0].trim();
    out.setLength(0);
    notes.setLength(0);
    lines = 0;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraft.item.ItemStack")) cl = c.getClassLoader();
    if (cl == null) throw new IllegalStateException("no ItemStack class loader");
    try { oreDict = cls("net.minecraftforge.oredict.OreDictionary"); } catch (Throwable t) { oreDict = null; }

    try { avaritia(); } catch (Throwable t) { note("avaritia", t); }
    try { harvestcraftBoards(); } catch (Throwable t) { note("hc-boards", t); }
    try { harvestcraftTraps(); } catch (Throwable t) { note("hc-traps", t); }
    try { wgInfernal(); } catch (Throwable t) { note("wg-infernal", t); }
    try { wgSpinning(); } catch (Throwable t) { note("wg-spinning", t); }
    try { etfuturumSmithing(); } catch (Throwable t) { note("ef-smithing", t); }

    try (java.io.FileWriter w = new java.io.FileWriter(outFile)) { w.write(out.toString()); }
    try (java.io.FileWriter w = new java.io.FileWriter(outFile + ".notes")) { w.write(notes.toString()); }
    System.err.println("[dump31] " + lines + " lines -> " + outFile);
  }

  static void note(String what, Throwable t) {
    System.err.println("[dump31] " + what + " failed: " + t);
    notes.append(what).append(" failed: ").append(t).append('\n');
  }

  // ---------- 反射 helper ----------
  static Class<?> cls(String n) throws Exception { return Class.forName(n, false, cl); }

  static Method find(Class<?> c, String name, int argc) {
    for (Class<?> k = c; k != null; k = k.getSuperclass()) {
      for (Method m : k.getDeclaredMethods()) {
        if (m.getName().equals(name) && m.getParameterCount() == argc) { m.setAccessible(true); return m; }
      }
    }
    return null;
  }

  static Object call(Object o, String name, Object... a) {
    if (o == null) return null;
    Method m = find(o.getClass(), name, a == null ? 0 : a.length);
    if (m == null) return null;
    try { m.setAccessible(true); return m.invoke(o, a); } catch (Throwable t) { return null; }
  }

  static Object callAny(Object o, String... names) {
    for (String n : names) { Object r = call(o, n); if (r != null) return r; }
    return null;
  }

  static Object staticCall(Class<?> c, String name, Object... a) {
    Method m = find(c, name, a == null ? 0 : a.length);
    if (m == null) return null;
    try { m.setAccessible(true); return m.invoke(null, a); } catch (Throwable t) { return null; }
  }

  static Object staticField(Class<?> c, String name) {
    for (Class<?> k = c; k != null; k = k.getSuperclass()) {
      try { Field f = k.getDeclaredField(name); f.setAccessible(true); return f.get(null); } catch (Throwable ignored) {}
    }
    return null;
  }

  static Object field(Object o, String name) {
    if (o == null) return null;
    for (Class<?> k = o.getClass(); k != null; k = k.getSuperclass()) {
      try { Field f = k.getDeclaredField(name); f.setAccessible(true); return f.get(o); } catch (Throwable ignored) {}
    }
    return null;
  }

  static Object fieldAny(Object o, String... names) {
    for (String n : names) { Object v = field(o, n); if (v != null) return v; }
    return null;
  }

  static int asInt(Object o) { return o instanceof Number ? ((Number) o).intValue() : 0; }
  static boolean asBool(Object o) { return Boolean.TRUE.equals(o); }
  static Object item(Object stack) { return call(stack, "func_77973_b"); }

  static String itemName(Object item) {
    if (item == null) return null;
    Object reg = field(item, "field_150901_e");
    if (reg == null) return null;
    Object n = call(reg, "func_148750_c", item);
    return n == null ? null : String.valueOf(n);
  }

  static String stackJson(Object s) {
    if (s == null) return "null";
    Object item = item(s);
    if (item == null) return "null";
    int id = 0;
    try { Method idm = find(item.getClass(), "func_150891_b", 1); if (idm != null) { idm.setAccessible(true); id = asInt(idm.invoke(null, item)); } } catch (Throwable t) {}
    int count = asInt(field(s, "field_77994_a"));
    int meta = asInt(field(s, "field_77991_e"));
    String nm = itemName(item);
    return "{\"id\":" + id + ",\"name\":" + (nm == null ? "null" : "\"" + nm.replace("\\", "\\\\").replace("\"", "\\\"") + "\"") + ",\"meta\":" + meta + ",\"count\":" + Math.max(count, 1) + "}";
  }

  /** 单个「格」→ 备选数组 JSON。空位返回 []。 */
  static String alt(Object cell) {
    if (cell == null) return "[]";
    if (cell.getClass().isArray()) {
      if (Array.getLength(cell) == 0) return "[]";
      // ItemStack[] 或 Object[]
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (int i = 0; i < Array.getLength(cell); i++) {
        String a = alt(Array.get(cell, i));
        if (a.equals("[]")) continue;
        if (!first) b.append(',');
        first = false;
        b.append(a, 1, a.length() - 1);
      }
      return b.append(']').toString();
    }
    if (cell instanceof String) return oreAlt((String) cell);
    if (cell instanceof Collection) {
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (Object e : (Collection<?>) cell) {
        String a = alt(e);
        if (a.equals("[]")) continue;
        if (!first) b.append(',');
        first = false;
        b.append(a, 1, a.length() - 1);
      }
      return b.append(']').toString();
    }
    // 只处理 ItemStack（有 func_77973_b 返回值）
    if (item(cell) != null) return "[" + stackJson(cell) + "]";
    return "[]";
  }

  static String oreAlt(String name) {
    if (oreDict != null) {
      try {
        Method m = find(oreDict, "getOres", 1);
        if (m != null) {
          Object r = m.invoke(null, name);
          if (r instanceof Collection && !((Collection<?>) r).isEmpty()) {
            StringBuilder b = new StringBuilder("[");
            boolean first = true;
            for (Object s : (Collection<?>) r) { if (!first) b.append(','); first = false; b.append(stackJson(s)); }
            return b.append(']').toString();
          }
        }
      } catch (Throwable t) { }
    }
    return "[{\"ore\":\"" + name.replace("\"", "\\\"") + "\"}]";
  }

  /** 一个 Object[] 输入网格 → ins 数组（逐格） */
  static String grid(Object arr) {
    if (arr == null) return "[]";
    int n = Array.getLength(arr);
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < n; i++) { if (i > 0) b.append(','); b.append(alt(Array.get(arr, i))); }
    return b.append(']').toString();
  }

  static String listCells(Object coll) {
    if (coll == null || !(coll instanceof Collection)) return "[]";
    StringBuilder b = new StringBuilder("[");
    boolean first = true;
    for (Object e : (Collection<?>) coll) { if (!first) b.append(','); first = false; b.append(alt(e)); }
    return b.append(']').toString();
  }

  static void emit(String mod, String kind, String outJson, String insJson, Integer time, String extraJson) {
    out.append("{\"mod\":\"").append(mod).append("\",\"kind\":\"").append(kind)
       .append("\",\"out\":").append(outJson).append(",\"ins\":").append(insJson)
       .append(",\"time\":").append(time == null ? "null" : time)
       .append(",\"extra\":").append(extraJson == null ? "null" : extraJson).append("}\n");
    lines++;
  }

  // ---------- Avaritia ----------
  static void avaritia() throws Exception {
    Object mgr = staticCall(cls("fox.spiteful.avaritia.crafting.ExtremeCraftingManager"), "getInstance");
    List<?> recipes = (List<?>) call(mgr, "getRecipeList");
    for (Object r : recipes) {
      if (fieldAny(r, "output", "recipeOutput") == null) continue;
      String cn = r.getClass().getSimpleName();
      String outs, ins, extra;
      if (cn.equals("ExtremeShapedOreRecipe")) {
        outs = "[" + stackJson(field(r, "output")) + "]";
        int w = asInt(field(r, "width")), h = asInt(field(r, "height"));
        ins = grid(field(r, "input"));
        extra = "{\"w\":" + w + ",\"h\":" + h + "}";
      } else if (cn.equals("ExtremeShapedRecipe")) {
        outs = "[" + stackJson(field(r, "recipeOutput")) + "]";
        int w = asInt(field(r, "recipeWidth")), h = asInt(field(r, "recipeHeight"));
        ins = grid(field(r, "recipeItems"));
        extra = "{\"w\":" + w + ",\"h\":" + h + "}";
      } else {
        outs = "[" + stackJson(field(r, "recipeOutput")) + "]";
        ins = listCells(field(r, "recipeItems"));
        extra = "{\"shapeless\":true}";
      }
      if (outs.equals("[null]") || ins.equals("[]")) continue;
      emit("avaritia", "extreme_crafting", outs, ins, null, extra);
    }
    System.err.println("[dump31] avaritia = " + recipes.size());
  }

  // ---------- HarvestCraft 切菜板 / 锅 ----------
  static String vanillaRecipe(Object r) throws Exception {
    String cn = r.getClass().getSimpleName();
    Object outp = callAny(r, "func_77571_b", "getRecipeOutput");
    String outs = "[" + stackJson(outp) + "]";
    String ins;
    if (cn.contains("Shapeless")) {
      Object items = fieldAny(r, "recipeItems", "field_77579_b", "input");
      ins = listCells(items);
    } else {
      Object items = fieldAny(r, "recipeItems", "field_77574_d", "input");
      ins = grid(items);
    }
    return outs + "\n" + ins;
  }

  static void harvestcraftBoards() throws Exception {
    String[][] targets = {
      { "com.pam.harvestcraft.CraftingManagerPamCuttingBoard", "cutting_board" },
      { "com.pam.harvestcraft.CraftingManagerPamPot", "cooking_pot" },
    };
    for (String[] t : targets) {
      Object mgr = staticCall(cls(t[0]), "getInstance");
      List<?> recipes = (List<?>) call(mgr, "getRecipeList");
      for (Object r : recipes) {
        String[] parts = vanillaRecipe(r).split("\n", 2);
        emit("harvestcraft", t[1], parts[0], parts[1],
             null, "{\"cls\":\"" + r.getClass().getSimpleName() + "\"}");
      }
      System.err.println("[dump31] hc " + t[1] + " = " + recipes.size());
    }
  }

  // ---------- HarvestCraft 陷阱掉落 ----------
  static void harvestcraftTraps() throws Exception {
    Class<?> c = cls("com.pam.harvestcraft.TrapRecipes");
    String[][] maps = { { "ANIMAL_TRAP_RECIPES", "animal_trap" }, { "FISH_TRAP_RECIPES", "fish_trap" } };
    for (String[] m : maps) {
      Map<?, ?> map = (Map<?, ?>) staticField(c, m[0]);
      if (map == null) continue;
      for (Map.Entry<?, ?> e : map.entrySet()) {
        Object bait = e.getKey();   // Item
        List<?> drops = (List<?>) e.getValue();
        StringBuilder b = new StringBuilder("[");
        boolean first = true;
        for (Object d : drops) {
          if (!first) b.append(',');
          first = false;
          Object stack = field(d, "stack");
          int weight = asInt(fieldAny(d, "itemWeight", "field_76292_a"));
          b.append("{\"stack\":").append(stackJson(stack)).append(",\"weight\":").append(weight).append('}');
        }
        b.append(']');
        // bait 是 Item，不是 ItemStack：用 new ItemStack(item) 取名字
        String baitJson = "null";
        try {
          Class<?> isCls = cls("net.minecraft.item.ItemStack");
          Object st = isCls.getConstructor(cls("net.minecraft.item.Item")).newInstance(bait);
          baitJson = stackJson(st);
        } catch (Throwable t) { }
        emit("harvestcraft", m[1], b.toString(), "[[" + baitJson + "]]", null, "{\"weighted\":true}");
      }
      System.err.println("[dump31] hc " + m[1] + " = " + map.size());
    }
  }

  // ---------- WitchingGadgets ----------
  static void wgInfernal() throws Exception {
    Class<?> c = cls("witchinggadgets.common.util.recipe.InfernalBlastfurnaceRecipe");
    List<?> recipes = (List<?>) staticField(c, "recipes");
    for (Object r : recipes) {
      String ins = "[" + alt(field(r, "input")) + "]";
      String outs = "[" + stackJson(field(r, "output")) + "]";
      String extra = "{\"special\":" + asBool(field(r, "isSpecial"));
      Object bonus = field(r, "bonus");
      if (bonus != null) extra += ",\"bonus\":" + stackJson(bonus);
      extra += "}";
      emit("witchinggadgets", "infernal_blast_furnace", outs, ins, asInt(field(r, "time")), extra);
    }
    System.err.println("[dump31] wg infernal = " + recipes.size());
  }

  static void wgSpinning() throws Exception {
    Class<?> c = cls("witchinggadgets.common.util.recipe.SpinningRecipe");
    List<?> recipes = (List<?>) staticField(c, "recipeList");
    for (Object r : recipes) {
      String ins = grid(field(r, "input"));
      String outs = "[" + stackJson(field(r, "output")) + "]";
      emit("witchinggadgets", "spinning_wheel", outs, ins, null, null);
    }
    System.err.println("[dump31] wg spinning = " + recipes.size());
  }

  // ---------- Et Futurum 锻造台 ----------
  static void etfuturumSmithing() throws Exception {
    Object mgr = staticCall(cls("ganymedes01.etfuturum.recipes.SmithingTableRecipes"), "getInstance");
    List<?> recipes = (List<?>) call(mgr, "getRecipes");
    for (Object r : recipes) {
      String ins = "[" + alt(field(r, "input")) + "," + alt(field(r, "material")) + "]";
      String outs = "[" + stackJson(field(r, "output")) + "]";
      String extra = "{\"copyNbt\":" + asBool(field(r, "copyNBT")) + "}";
      emit("etfuturum", "smithing_table", outs, ins, null, extra);
    }
    System.err.println("[dump31] ef smithing = " + recipes.size());
  }
}
