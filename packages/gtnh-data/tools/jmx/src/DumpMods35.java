import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;

/**
 * 导出第三批 mod 配方：
 *   galaxyspace   火箭工作台（T1..T8，每个 4 条，3x3 保位）
 *   binnie        培养器（Incubator 160）/ 蜜蜂突变（153）/ 花突变（37）
 *
 * args = "<outFile>"
 * 输出 JSONL：{mod, kind, out:[stack|species], ins:[[alt...]], fluidIn, fluidOut, time, extra}
 */
public class DumpMods35 {
  static final StringBuilder out = new StringBuilder();
  static final StringBuilder notes = new StringBuilder();
  static int lines = 0;
  static ClassLoader cl;
  static Class<?> oreDict;
  static Class<?> itemStackCls;
  static Class<?> fluidStackCls;

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(args.split("\\|")[0].trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String outFile = args.split("\\|")[0].trim();
    out.setLength(0);
    notes.setLength(0);
    lines = 0;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      if (c.getName().equals("net.minecraft.item.ItemStack")) { cl = c.getClassLoader(); itemStackCls = c; }
      if (c.getName().equals("net.minecraftforge.fluids.FluidStack")) fluidStackCls = c;
    }
    if (cl == null) throw new IllegalStateException("no ItemStack class loader");
    try { oreDict = cls("net.minecraftforge.oredict.OreDictionary"); } catch (Throwable t) { oreDict = null; }
    if (fluidStackCls == null) { try { fluidStackCls = cls("net.minecraftforge.fluids.FluidStack"); } catch (Throwable t) {} }

    try { galaxySpace(); } catch (Throwable t) { note("galaxyspace", t); }
    try { binnieIncubator(); } catch (Throwable t) { note("binnie-incubator", t); }
    try { binnieBeeMutations(); } catch (Throwable t) { note("binnie-bee", t); }
    try { binnieFlowerMutations(); } catch (Throwable t) { note("binnie-flower", t); }

    try (java.io.FileWriter w = new java.io.FileWriter(outFile)) { w.write(out.toString()); }
    try (java.io.FileWriter w = new java.io.FileWriter(outFile + ".notes")) { w.write(notes.toString()); }
    System.err.println("[dump35] " + lines + " lines -> " + outFile);
  }

  static void note(String what, Throwable t) {
    System.err.println("[dump35] " + what + " failed: " + t);
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
  static float asFloat(Object o) { return o instanceof Number ? ((Number) o).floatValue() : 0f; }
  static boolean asBool(Object o) { return Boolean.TRUE.equals(o); }
  static Object item(Object stack) { return call(stack, "func_77973_b"); }

  static String esc(String s) { return s == null ? "null" : "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""; }

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
    return "{\"id\":" + id + ",\"name\":" + esc(nm) + ",\"meta\":" + meta + ",\"count\":" + Math.max(count, 1) + "}";
  }

  /** 物种（蜜蜂/花）没有物品形态：写成 {species:"forestry.speciesX"}。 */
  static String speciesJson(Object allele) {
    if (allele == null) return "null";
    Object n = callAny(allele, "getName", "getUID");
    String nm = n == null ? null : String.valueOf(n);
    if (nm == null) return "null";
    return "{\"species\":" + esc(nm) + "}";
  }

  static String fluidJson(Object fs) {
    if (fs == null) return "null";
    Object fluid = fieldAny(fs, "fluid", "field_75161_e");
    int amount = asInt(fieldAny(fs, "amount", "field_75159_c"));
    String name = null;
    if (fluid != null) {
      Object n = callAny(fluid, "getName", "func_77664_a");
      if (n != null) name = String.valueOf(n);
    }
    return "{\"name\":" + esc(name) + ",\"amount\":" + amount + "}";
  }

  static String alt(Object cell) {
    if (cell == null) return "[]";
    if (cell.getClass().isArray()) {
      if (Array.getLength(cell) == 0) return "[]";
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
    return "[{\"ore\":" + esc(name) + "}]";
  }

  static void emit(String mod, String kind, String outJson, String insJson, String fluidIn, String fluidOut, Integer time, String extraJson) {
    out.append("{\"mod\":\"").append(mod).append("\",\"kind\":\"").append(kind)
       .append("\",\"out\":").append(outJson).append(",\"ins\":").append(insJson)
       .append(",\"fluidIn\":").append(fluidIn == null ? "[]" : fluidIn)
       .append(",\"fluidOut\":").append(fluidOut == null ? "[]" : fluidOut)
       .append(",\"time\":").append(time == null ? "null" : time)
       .append(",\"extra\":").append(extraJson == null ? "null" : extraJson).append("}\n");
    lines++;
  }

  // ---------- GalaxySpace 火箭 ----------
  static void galaxySpace() throws Exception {
    Class<?> c = cls("galaxyspace.core.recipe.RocketRecipes");
    for (int tier = 1; tier <= 8; tier++) {
      Object v = staticField(c, "RECIPES_ROCKET_T" + tier);
      if (!(v instanceof List)) continue;
      List<?> recipes = (List<?>) v;
      for (Object r : recipes) {
        Object output = callAny(r, "getRecipeOutput", "func_77571_b");
        Object input = callAny(r, "getRecipeInput");
        int slots = 0;
        try { slots = asInt(callAny(r, "getRecipeSize")); } catch (Throwable t) {}
        // NasaWorkbenchRecipe 的 input 是 HashMap<槽位, ItemStack>：key 可能是 0..8 也可能 1..9；
        // 跨度 <= 9 时按 3x3 保位，否则按 key 升序平铺（并在 extra.keys 里记原 key）。
        List<Map.Entry<?, ?>> entries = new ArrayList<>();
        int minKey = Integer.MAX_VALUE, maxKey = Integer.MIN_VALUE;
        if (input instanceof Map) {
          for (Map.Entry<?, ?> e : ((Map<?, ?>) input).entrySet()) {
            entries.add(e);
            int k = asInt(e.getKey());
            minKey = Math.min(minKey, k);
            maxKey = Math.max(maxKey, k);
          }
          entries.sort(Comparator.comparingInt(e -> asInt(e.getKey())));
        }
        int span = entries.isEmpty() ? 0 : (maxKey - minKey + 1);
        boolean grid = span > 0 && span <= 9;
        StringBuilder ins = new StringBuilder("[");
        String extra;
        if (grid) {
          Object[] cells9 = new Object[9];
          for (Map.Entry<?, ?> e : entries) {
            int idx = asInt(e.getKey()) - minKey;
            if (idx >= 0 && idx < 9) cells9[idx] = e.getValue();
          }
          for (int i = 0; i < 9; i++) {
            if (i > 0) ins.append(',');
            ins.append(cells9[i] == null ? "[]" : alt(cells9[i]));
          }
          extra = "{\"tier\":" + tier + ",\"w\":3,\"h\":3,\"slots\":" + entries.size() + "}";
        } else {
          StringBuilder keys = new StringBuilder("[");
          boolean first = true;
          for (Map.Entry<?, ?> e : entries) {
            if (!first) ins.append(',');
            first = false;
            ins.append(alt(e.getValue()));
            if (keys.length() > 1) keys.append(',');
            keys.append(asInt(e.getKey()));
          }
          keys.append(']');
          extra = "{\"tier\":" + tier + ",\"slots\":" + entries.size() + ",\"keys\":" + keys + "}";
        }
        ins.append(']');
        emit("galaxyspace", "rocket", "[" + stackJson(output) + "]", ins.toString(), null, null, null, extra);
      }
      System.err.println("[dump35] galaxyspace T" + tier + " = " + recipes.size());
    }
  }

  // ---------- Binnie 培养器 ----------
  static void binnieIncubator() throws Exception {
    Class<?> c = cls("binnie.genetics.machine.incubator.Incubator");
    List<?> recipes = (List<?>) staticField(c, "RECIPES");
    if (recipes == null) throw new IllegalStateException("Incubator.RECIPES is null");
    for (Object r : recipes) {
      Object outStack = callAny(r, "getExpectedOutput", "getOutputStack");
      Object inStack = callAny(r, "getInputStack");
      String ins = "[[" + (inStack == null ? "" : stackJson(inStack)) + "]]";
      if (ins.equals("[[null]]") ) continue;
      String fi = "[" + fluidJson(callAny(r, "getInput")) + "]";
      String fo = "[" + fluidJson(callAny(r, "getOutput")) + "]";
      String extra = "{\"chance\":" + asFloat(callAny(r, "getChance")) + ",\"lossChance\":" + asFloat(callAny(r, "getLossChance")) + "}";
      emit("binnie", "incubator", outStack == null ? "[]" : "[" + stackJson(outStack) + "]", ins, fi, fo, null, extra);
    }
    System.err.println("[dump35] binnie incubator = " + recipes.size());
  }

  // ---------- Binnie 蜜蜂突变 ----------
  static void binnieBeeMutations() throws Exception {
    Class<?> c = cls("binnie.extrabees.genetics.ExtraBeeMutation");
    List<?> mutations = (List<?>) staticField(c, "mutations");
    if (mutations == null) throw new IllegalStateException("ExtraBeeMutation.mutations is null");
    emitMutations("binnie", "bee_mutation", mutations);
    System.err.println("[dump35] binnie bee mutations = " + mutations.size());
  }

  static void binnieFlowerMutations() throws Exception {
    Class<?> c = cls("binnie.botany.genetics.FlowerHelper");
    List<?> mutations = (List<?>) staticField(c, "flowerMutations");
    if (mutations == null) throw new IllegalStateException("FlowerHelper.flowerMutations is null");
    emitMutations("binnie", "flower_mutation", mutations);
    System.err.println("[dump35] binnie flower mutations = " + mutations.size());
  }

  /** IMutation：getAllele0/getAllele1 → 物种；getTemplate()[0] → 产物物种；getBaseChance()。 */
  static void emitMutations(String mod, String kind, List<?> mutations) throws Exception {
    for (Object m : mutations) {
      Object a0 = callAny(m, "getAllele0");
      Object a1 = callAny(m, "getAllele1");
      Object tpl = callAny(m, "getTemplate");
      Object result = null;
      if (tpl != null && tpl.getClass().isArray() && Array.getLength(tpl) > 0) result = Array.get(tpl, 0);
      if (a0 == null || a1 == null) continue;
      String ins = "[[" + speciesJson(a0) + "],[" + speciesJson(a1) + "]]";
      String outs = result == null ? "[]" : "[" + speciesJson(result) + "]";
      Object secret = callAny(m, "isSecret");
      String extra = "{\"chance\":" + asFloat(callAny(m, "getBaseChance")) + ",\"secret\":" + asBool(secret) + "}";
      emit(mod, kind, outs, ins, null, null, null, extra);
    }
  }
}
