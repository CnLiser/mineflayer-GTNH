import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;
import java.io.*;

/**
 * 导出 1.7.10（GTNH 装完 mod 后）的实体注册表：
 *   net.minecraft.entity.EntityList 的 id→Class 与 Class→名字两张静态 Map 对起来。
 *
 * 这两个字段的 SRG 名在不同版本里不一样，所以不写死名字：遍历所有 static Map，
 * 按 key/value 的类型自动认出「Integer→Class」和「Class→String」两张。
 *
 * args = "<outFile>"
 * 输出 JSONL：{"id":1,"name":"Bat","cls":"net.minecraft.entity.passive.EntityBat"}
 */
public class DumpEntity1 {
  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  @SuppressWarnings("unchecked")
  static void run(String args, Instrumentation inst) throws Exception {
    String outFile = args.trim();
    Class<?> entityList = null;
    Class<?> itemStack = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      if (c.getName().equals("net.minecraft.entity.EntityList")) entityList = c;
      if (c.getName().equals("net.minecraft.item.ItemStack")) itemStack = c;
    }
    if (entityList == null) throw new IllegalStateException("EntityList not loaded");
    if (itemStack == null) throw new IllegalStateException("ItemStack not loaded");
    // 用 minecraft 自己的类加载器（EntityList 可能来自不同 loader）
    ClassLoader cl = entityList.getClassLoader() != null ? entityList.getClassLoader() : itemStack.getClassLoader();

    Map<Integer, Class<?>> idToClass = new TreeMap<>();
    Map<Class<?>, String> classToName = new HashMap<>();
    StringBuilder notes = new StringBuilder();

    for (Field f : entityList.getDeclaredFields()) {
      if (!Modifier.isStatic(f.getModifiers())) continue;
      f.setAccessible(true);
      Object v;
      try { v = f.get(null); } catch (Throwable t) { continue; }
      if (!(v instanceof Map)) continue;
      Map<Object, Object> m = (Map<Object, Object>) v;
      if (m.isEmpty()) continue;
      Object k = m.keySet().iterator().next();
      Object val = m.values().iterator().next();
      notes.append("# field ").append(f.getName()).append(" size=").append(m.size())
           .append(" key=").append(k.getClass().getSimpleName())
           .append(" val=").append(val.getClass().getSimpleName()).append('\n');
      if (k instanceof Integer && val instanceof Class) {
        for (Map.Entry<Object, Object> e : m.entrySet()) idToClass.put((Integer) e.getKey(), (Class<?>) e.getValue());
      } else if (k instanceof Class && val instanceof String) {
        for (Map.Entry<Object, Object> e : m.entrySet()) classToName.put((Class<?>) e.getKey(), (String) e.getValue());
      }
    }

    try (PrintWriter w = new PrintWriter(new OutputStreamWriter(new FileOutputStream(outFile), "UTF-8"))) {
      w.print(notes);
      for (Map.Entry<Integer, Class<?>> e : idToClass.entrySet()) {
        String name = classToName.get(e.getValue());
        if (name == null) name = e.getValue().getSimpleName();
        w.print("{\"id\":" + e.getKey() + ",\"name\":" + j(name) + ",\"cls\":" + j(e.getValue().getName()) + "}\n");
      }
    }
  }

  static String j(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }
}
