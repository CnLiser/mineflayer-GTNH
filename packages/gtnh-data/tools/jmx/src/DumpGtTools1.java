import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;
import java.util.*;

/**
 * 探针：GT 的工具都塞在同一个物品里（gregtech:gt.metatool.01 + damage），
 * 名字靠 lang、工具类靠 Forge 的 Item.getHarvestLevel(stack, toolClass)。
 * 这里对 damage 0..60 逐个问一遍常见工具类，导出 { dmg, classes }。
 *
 * args = "<outFile>"
 */
public class DumpGtTools1 {
  static StringBuilder sb = new StringBuilder();
  static final String[] CLASSES = {
    "pickaxe", "axe", "shovel", "sword", "shears", "wrench", "crowbar", "scoop",
    "saw", "file", "hammer", "screwdriver", "wire_cutter", "cutter", "drill", "hoe"
  };

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); } catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String out = args.trim();
    Class<?> itemCls = null, stackCls = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      if (c.getName().equals("net.minecraft.item.Item")) itemCls = c;
      if (c.getName().equals("net.minecraft.item.ItemStack")) stackCls = c;
    }
    sb.append("# item=").append(itemCls).append(" stack=").append(stackCls).append('\n');
    if (itemCls == null || stackCls == null) { write(out); return; }

    // 注册表：Item.itemRegistry 是 Iterable
    Object registry = null;
    for (Field f : itemCls.getDeclaredFields()) {
      if (!Modifier.isStatic(f.getModifiers())) continue;
      try { f.setAccessible(true); Object v = f.get(null); if (v instanceof Iterable) { registry = v; break; } } catch (Throwable t) {}
    }
    if (registry == null) { sb.append("no item registry\n"); write(out); return; }

    Method nameOf = null;
    for (Class<?> k = registry.getClass(); k != null && k != Object.class && nameOf == null; k = k.getSuperclass()) {
      for (Method m : k.getDeclaredMethods()) {
        Class<?>[] pt = m.getParameterTypes();
        if (pt.length == 1 && m.getReturnType() == String.class && (pt[0] == Object.class || pt[0] == itemCls)) { nameOf = m; break; }
      }
    }
    if (nameOf == null) { sb.append("no name method\n"); write(out); return; }
    nameOf.setAccessible(true);

    Object meta = null;
    for (Object o : (Iterable<?>) registry) {
      if (!itemCls.isInstance(o)) continue;
      try { if ("gregtech:gt.metatool.01".equals(nameOf.invoke(registry, o))) { meta = o; break; } } catch (Throwable t) {}
    }
    if (meta == null) { sb.append("no metatool\n"); write(out); return; }

    Constructor<?> ctor = stackCls.getConstructor(itemCls, int.class, int.class);
    Method harvestLevel = null;
    for (Method m : itemCls.getMethods()) {
      Class<?>[] pt = m.getParameterTypes();
      if (pt.length == 2 && pt[0] == stackCls && pt[1] == String.class && m.getReturnType() == int.class) harvestLevel = m;
    }
    sb.append("# harvestLevel=").append(harvestLevel).append('\n');
    if (harvestLevel == null) { write(out); return; }

    for (int dmg = 0; dmg <= 60; dmg++) {
      Object stack;
      try { stack = ctor.newInstance(meta, 1, dmg); } catch (Throwable t) { continue; }
      List<String> hits = new ArrayList<>();
      for (String c : CLASSES) {
        try {
          int lv = (Integer) harvestLevel.invoke(meta, stack, c);
          if (lv >= 0) hits.add(c + ":" + lv);
        } catch (Throwable t) {}
      }
      if (!hits.isEmpty()) sb.append("{\"dmg\":").append(dmg).append(",\"classes\":\"").append(String.join(",", hits)).append("\"}\n");
    }
    write(out);
  }

  static void write(String out) throws IOException {
    try (Writer w = new OutputStreamWriter(new FileOutputStream(out), "UTF-8")) { w.write(sb.toString()); }
  }
}
