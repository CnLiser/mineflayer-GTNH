import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;

/**
 * 导出 Galacticraft（电路制造机 / 压缩机）与 Witchery（蒸馏 / 坩埚 / 纺车）的配方。
 * 纯反射，不依赖编译期 MC 类名。
 * args = "<outFile>|<mods 逗号分隔>"
 */
public class DumpMods22 {
  static final StringBuilder out = new StringBuilder();
  static int lines = 0;
  static ClassLoader cl;

  public static void agentmain(String args, Instrumentation inst) {
    String outFile = args.split("\\|")[0].trim();
    try {
      run(args, inst);
    } catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(outFile + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String[] p = args.split("\\|");
    String outFile = p[0].trim();
    Set<String> mods = new HashSet<>(Arrays.asList(p[1].split(",")));
    out.setLength(0);
    lines = 0;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraft.item.ItemStack")) cl = c.getClassLoader();
    if (cl == null) throw new IllegalStateException("no ItemStack class loader");

    if (mods.contains("galacticraft")) { try { gcCircuit(); } catch (Throwable t) { note("gc-circuit", t); } try { gcCompressor(); } catch (Throwable t) { note("gc-compressor", t); } }
    if (mods.contains("toolbuild")) { try { tconToolBuild(); } catch (Throwable t) { note("tcon-toolbuild", t); } }
    if (mods.contains("tconstruct")) { try { tconCasting("getTableCasting", "casting_table"); } catch (Throwable t) { note("tcon-table", t); } try { tconCasting("getBasinCasting", "casting_basin"); } catch (Throwable t) { note("tcon-basin", t); } }
    if (mods.contains("witchery")) { try { witDistillery(); } catch (Throwable t) { note("wit-distillery", t); } try { witKettle(); } catch (Throwable t) { note("wit-kettle", t); } try { witSpinning(); } catch (Throwable t) { note("wit-spinning", t); } try { witBrazier(); } catch (Throwable t) { note("wit-brazier", t); } try { witBrew(); } catch (Throwable t) { note("wit-brew", t); } }

    try (java.io.FileWriter w = new java.io.FileWriter(outFile)) { w.write(out.toString()); }
    System.err.println("[dump18] " + lines + " lines -> " + outFile);
  }

  static void note(String what, Throwable t) {
    System.err.println("[dump18] " + what + " failed: " + t);
    out.append("{\"error\":\"").append(what).append("\",\"msg\":\"").append(String.valueOf(t).replace("\"", "'")).append("\"}\n");
  }

  // ---------- helpers ----------
  static Class<?> cls(String n) throws Exception { return Class.forName(n, false, cl); }
  static Class<?> clsLazy(String n) { try { return cls(n); } catch (Throwable t) { return null; } }

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

  static Object field(Object o, String name) {
    if (o == null) return null;
    for (Class<?> k = o.getClass(); k != null; k = k.getSuperclass()) {
      try { Field f = k.getDeclaredField(name); f.setAccessible(true); return f.get(o); } catch (Throwable ignored) {}
    }
    return null;
  }

  static int asInt(Object o) { return o instanceof Number ? ((Number) o).intValue() : 0; }
  static float asFloat(Object o) { return o instanceof Number ? ((Number) o).floatValue() : 0f; }

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
    return "{\"id\":" + id + ",\"name\":" + (nm == null ? "null" : "\"" + nm + "\"") + ",\"meta\":" + meta + ",\"count\":" + Math.max(count, 1) + "}";
  }

  static String stackArray(Object arr) {
    StringBuilder b = new StringBuilder("[");
    int n = arr == null ? 0 : Array.getLength(arr);
    for (int i = 0; i < n; i++) { if (i > 0) b.append(','); b.append(stackJson(Array.get(arr, i))); }
    return b.append(']').toString();
  }

  static String listOrArray(Object o) {
    if (o == null) return "[]";
    if (o.getClass().isArray()) return stackArray(o);
    if (o instanceof Collection) {
      StringBuilder b = new StringBuilder("[");
      boolean first = true;
      for (Object e : (Collection<?>) o) { if (!first) b.append(','); first = false; b.append(stackJson(e)); }
      return b.append(']').toString();
    }
    return "[" + stackJson(o) + "]";
  }

  static void emit(String mod, String kind, String outJson, String insJson, String extraJson) {
    out.append("{\"mod\":\"").append(mod).append("\",\"kind\":\"").append(kind)
       .append("\",\"out\":").append(outJson).append(",\"ins\":").append(insJson)
       .append(",\"extra\":").append(extraJson == null ? "null" : extraJson).append("}\n");
    lines++;
  }

  // ---------- Galacticraft ----------
  static void gcCircuit() throws Exception {
    Class<?> c = cls("micdoodle8.mods.galacticraft.api.recipe.CircuitFabricatorRecipes");
    Field f = c.getDeclaredField("recipes");
    f.setAccessible(true);
    Map<?, ?> map = (Map<?, ?>) f.get(null);
    for (Map.Entry<?, ?> e : map.entrySet()) {
      Object in = e.getKey();   // ItemStack[]
      Object out = e.getValue(); // ItemStack
      emit("galacticraft", "circuit_fabricator", "[" + stackJson(out) + "]", listOrArray(in), null);
    }
    System.err.println("[dump18] gc circuit fabricator = " + map.size());
  }

  static void gcCompressor() throws Exception {
    Class<?> c = cls("micdoodle8.mods.galacticraft.api.recipe.CompressorRecipes");
    for (String fname : new String[]{"recipes", "recipesAdventure"}) {
      Field f = c.getDeclaredField(fname);
      f.setAccessible(true);
      List<?> list = (List<?>) f.get(null);
      String kind = fname.equals("recipes") ? "compressor" : "compressor_adventure";
      for (Object r : list) {
        Object outp = callAny(r, "func_77571_b", "getRecipeOutput");
        String ins = "[]";
        Object input = field(r, "field_77574_d");
        if (input == null) input = field(r, "input");
        if (input != null) ins = listOrArray(input);
        emit("galacticraft", kind, "[" + stackJson(outp) + "]", ins, "{\"cls\":\"" + r.getClass().getSimpleName() + "\"}");
      }
      System.err.println("[dump18] gc " + kind + " = " + list.size());
    }
  }
    // ---------- Witchery ----------
  static Object witSingleton(String cn, String method) throws Exception {
    Class<?> c = cls(cn);
    Method m = find(c, method, 0);
    if (m == null) throw new NoSuchMethodException(cn + '.' + method);
    m.setAccessible(true);
    return m.invoke(null);
  }

  static void witDistillery() throws Exception {
    Object inst = witSingleton("com.emoniph.witchery.crafting.DistilleryRecipes", "instance");
    List<?> recipes = (List<?>) field(inst, "recipes");
    for (Object r : recipes) {
      String ins = listOrArray(field(r, "inputs"));
      String outs = listOrArray(field(r, "outputs"));
      emit("witchery", "distillery", outs, ins, "{\"jars\":" + asInt(field(r, "jars")) + "}");
    }
    System.err.println("[dump18] wit distillery = " + recipes.size());
  }

  static void witKettle() throws Exception {
    Object inst = witSingleton("com.emoniph.witchery.crafting.KettleRecipes", "instance");
    List<?> recipes = (List<?>) field(inst, "recipes");
    for (Object r : recipes) {
      String ins = listOrArray(field(r, "inputs"));
      String outs = "[" + stackJson(field(r, "output")) + "]";
      emit("witchery", "kettle", outs, ins, "{\"power\":" + asFloat(field(r, "power")) + ",\"inBook\":" + field(r, "inBook") + "}");
    }
    System.err.println("[dump18] wit kettle = " + recipes.size());
  }

  static void witSpinning() throws Exception {
    Object inst = witSingleton("com.emoniph.witchery.crafting.SpinningRecipes", "instance");
    List<?> recipes = (List<?>) field(inst, "recipes");
    for (Object r : recipes) {
      Object fibre = field(r, "fibre");
      Object result = field(r, "result");
      Object mods = field(r, "modifiers");
      String ins = "[" + stackJson(fibre) + "," + listOrArray(mods) + "]";
      emit("witchery", "spinning", "[" + stackJson(result) + "]", ins, null);
    }
    System.err.println("[dump20] wit spinning = " + recipes.size());
  }

  // 火盆：effect 不是物品，out 为空，效果名放 extra
  static void witBrazier() throws Exception {
    Object inst = witSingleton("com.emoniph.witchery.crafting.BrazierRecipes", "instance");
    List<?> recipes = (List<?>) field(inst, "recipes");
    for (Object r : recipes) {
      String ins = listOrArray(field(r, "items"));
      String effect = String.valueOf(field(r, "unlocalizedName"));
      emit("witchery", "brazier", "[]", ins, "{\"effect\":\"" + effect.replace("\"", "'") + "\",\"burnTicks\":" + asInt(field(r, "burnTicks")) + ",\"inBook\":" + field(r, "inBook") + "}");
    }
    System.err.println("[dump20] wit brazier = " + recipes.size());
  }

  // 酿造仪式：WitcheryBrewRegistry.INSTANCE.getRecipes() -> BrewActionRitualRecipe.getExpandedRecipes()
  static void witBrew() throws Exception {
    Class<?> reg = cls("com.emoniph.witchery.brewing.WitcheryBrewRegistry");
    Object singleton = null;
    for (Field f : reg.getDeclaredFields()) {
      if (Modifier.isStatic(f.getModifiers()) && f.getType() == reg) { f.setAccessible(true); singleton = f.get(null); }
    }
    if (singleton == null) throw new IllegalStateException("no INSTANCE");
    Object list = call(singleton, "getRecipes");
    List<?> actions = (List<?>) list;
    int n = 0;
    for (Object a : actions) {
      Object expanded = call(a, "getExpandedRecipes");
      if (!(expanded instanceof List)) continue;
      for (Object rec : (List<?>) expanded) {
        Object result = field(rec, "result");
        Object ings = field(rec, "ingredients");
        emit("witchery", "brew_ritual", "[" + stackJson(result) + "]", listOrArray(ings), "{\"action\":\"" + a.getClass().getSimpleName() + "\"}");
        n++;
      }
    }
    System.err.println("[dump20] wit brew = " + n + " (actions " + actions.size() + ")");
  }

  // TConstruct 浇筑：TConstructRegistry.getTableCasting()/getBasinCasting() 的 casts 列表
  static void tconCasting(String accessor, String kind) throws Exception {
    Class<?> reg = cls("tconstruct.library.TConstructRegistry");
    Method m = find(reg, accessor, 0);
    if (m == null) throw new NoSuchMethodException(accessor);
    m.setAccessible(true);
    Object casting = m.invoke(null);
    Object casts = field(casting, "casts");
    List<?> list = (List<?>) casts;
    for (Object r : list) {
      Object output = field(r, "output");
      Object metal = field(r, "castingMetal");
      Object cast = field(r, "cast");
      String fluid = fluidJson(metal);
      String ins = "[" + stackJson(cast) + "]";
      String extra = "{\"fluid\":" + fluid + ",\"consumeCast\":" + field(r, "consumeCast") + ",\"coolTime\":" + asInt(field(r, "coolTime")) + "}";
      emit("tconstruct", kind, "[" + stackJson(output) + "]", ins, extra);
    }
    System.err.println("[dump21] tcon " + kind + " = " + list.size());
  }

  static String fluidJson(Object fs) {
    if (fs == null) return "null";
    Object fluid = call(fs, "getFluid");
    Object name = fluid == null ? null : call(fluid, "getName");
    int amount = asInt(field(fs, "amount"));
    return "{\"fluid\":\"" + (name == null ? "?" : name) + "\",\"amount\":" + amount + "}";
  }

  // TConstruct 工具组装：ToolBuilder.instance.combos 里每条 = 可接受的头部/手柄/附件 Item 列表 + 成品 ToolCore
  static void tconToolBuild() throws Exception {
    Class<?> tb = cls("tconstruct.library.crafting.ToolBuilder");
    Object inst = tb.getField("instance").get(null);
    Object combos = field(inst, "combos");
    List<?> list = (List<?>) combos;
    for (Object r : list) {
      Object result = field(r, "result");
      Object head = field(r, "headList");
      Object handle = field(r, "handleList");
      Object acc = field(r, "accessoryList");
      Object extra = field(r, "extraList");
      String out = "[" + itemFreeze(result) + "]";
      StringBuilder ins = new StringBuilder("[");
      StringBuilder ex = new StringBuilder("{\"head\":");
      int cells = 0;
      Object[][] groups = { {head, "head"}, {handle, "handle"}, {acc, "accessory"}, {extra, "extra"} };
      StringBuilder exb = new StringBuilder("{");
      for (Object[] g : groups) {
        List<?> items = (List<?>) g[0];
        if (items == null || items.isEmpty()) continue;
        if (cells++ > 0) ins.append(",");
        ins.append("[");
        StringBuilder names = new StringBuilder("[");
        int i = 0;
        for (Object it : items) {
          if (i++ > 0) { ins.append(","); names.append(","); }
          ins.append(itemFreeze(it));
          names.append("\"").append(itemName(it)).append("\"");
        }
        ins.append("]");
        names.append("]");
        if (exb.length() > 1) exb.append(",");
        exb.append("\"").append(g[1]).append("\":").append(names);
      }
      ins.append("]");
      exb.append("}");
      emit("tconstruct", "tool_build", out, ins.toString(), exb.toString());
    }
    System.err.println("[dump22] tool_build = " + list.size());
  }

  static int itemIdOf(Object item) {
    if (item == null) return 0;
    Class<?> c = item.getClass();
    while (c != null) {
      for (Method m : c.getDeclaredMethods()) {
        if (m.getName().equals("func_150891_b") && m.getParameterTypes().length == 1 && java.lang.reflect.Modifier.isStatic(m.getModifiers())) {
          try { m.setAccessible(true); return asInt(m.invoke(null, item)); } catch (Throwable t) {}
        }
      }
      c = c.getSuperclass();
    }
    return 0;
  }

  static String itemFreeze(Object item) {
    if (item == null) return "null";
    return "{\"id\":" + itemIdOf(item) + ",\"name\":\"" + itemName(item) + "\",\"meta\":0,\"count\":1}";
  }
}
