import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/**
 * 探针：把 BetterQuesting 的任务数据库结构化 dump 成 JSON（纯反射 + 按签名找方法）。
 * args: "<outFile>@@<mode>"   mode = peek | all
 *
 * all 模式的输出：{ counts:{quests,lines}, quests:[{id, prereq:[uuid], nbt:{...}}], lines:[{id, quests:[uuid], nbt:{...}}] }
 */
public class DumpQuest13 {
  static StringBuilder sb = new StringBuilder();
  static ClassLoader cl;
  static Map<String, Method> cache = new HashMap<>();

  public static void main(String[] a) throws Exception { run(a[0]); }

  public static void agentmain(String a) {
    try { run(a); } catch (Throwable t) {
      System.out.println("FATAL " + t);
      try (PrintWriter pw = new PrintWriter(new FileWriter(a.split("@@")[0] + ".err"))) {
        t.printStackTrace(pw);
        pw.println("---partial---");
        if (sb.length() < 200000) pw.print(sb);
      } catch (Throwable ignored) {}
    }
  }

  static void run(String a) throws Exception {
    sb.setLength(0);
    String[] parts = a.split("@@");
    String out = parts[0];
    String mode = parts.length > 1 ? parts[1] : "peek";
    cl = null;
    try {
      Class<?> launch = Class.forName("net.minecraft.launchwrapper.Launch");
      cl = (ClassLoader) launch.getField("classLoader").get(null);
    } catch (Throwable ignored) {}
    if (cl == null) cl = Thread.currentThread().getContextClassLoader();
    if (cl == null) cl = ClassLoader.getSystemClassLoader();

    Class<?> tagCompound = Class.forName("net.minecraft.nbt.NBTTagCompound", true, cl);
    Object db = Class.forName("betterquesting.questing.QuestDatabase", true, cl).getField("INSTANCE").get(null);
    Object lineDb = Class.forName("betterquesting.questing.QuestLineDatabase", true, cl).getField("INSTANCE").get(null);
    List<E> quests = entries(db);
    List<E> lines = entries(lineDb);

    if ("peek".equals(mode)) {
      sb.append("quests ").append(quests.size()).append(" lines ").append(lines.size()).append('\n');
      for (int i = 0; i < Math.min(2, quests.size()); i++) {
        sb.append("\n=== quest ").append(quests.get(i).k).append(" ===\n");
        sb.append(nbt(writeObj(quests.get(i).v, tagCompound))).append('\n');
      }
      writeOut(out);
      return;
    }

    sb.append("{\n  \"counts\": {\"quests\": ").append(quests.size())
      .append(", \"lines\": ").append(lines.size()).append("},\n  \"quests\": [\n");
    for (int i = 0; i < quests.size(); i++) {
      Object q = quests.get(i).v;
      if (i > 0) sb.append(",\n");
      sb.append("    {\"id\": ").append(q(String.valueOf(quests.get(i).k)));
      sb.append(", \"prereq\": ").append(uuidList(callNoArg(q, "getRequirements")));
      sb.append(", \"nbt\": ").append(nbt(writeObj(q, tagCompound))).append('}');
    }
    sb.append("\n  ],\n  \"lines\": [\n");
    for (int i = 0; i < lines.size(); i++) {
      Object line = lines.get(i).v;
      if (i > 0) sb.append(",\n");
      sb.append("    {\"id\": ").append(q(String.valueOf(lines.get(i).k)));
      sb.append(", \"quests\": ").append(uuidList(line.getClass().getMethod("keySet").invoke(line)));
      sb.append(", \"nbt\": ").append(nbt(writeObj(line, tagCompound))).append('}');
    }
    sb.append("\n  ]\n}\n");
    writeOut(out);
  }

  static Object callNoArg(Object o, String name) throws Exception {
    Method m = null;
    for (Method cand : o.getClass().getMethods()) {
      if (cand.getName().equals(name) && cand.getParameterCount() == 0) { m = cand; break; }
    }
    if (m == null) throw new RuntimeException("没有方法 " + name + " on " + o.getClass());
    return m.invoke(o);
  }

  static String uuidList(Object col) {
    StringBuilder r = new StringBuilder("[");
    int i = 0;
    for (Object u : (Collection<?>) col) {
      if (i++ > 0) r.append(", ");
      r.append(q(String.valueOf(u)));
    }
    return r.append(']').toString();
  }

  static class E { final Object k, v; E(Object k, Object v) { this.k = k; this.v = v; } }

  static List<E> entries(Object db) throws Exception {
    Set<?> keys = (Set<?>) db.getClass().getMethod("keySet").invoke(db);
    Method get = db.getClass().getMethod("get", Object.class);
    List<E> r = new ArrayList<>();
    for (Object k : keys) r.add(new E(k, get.invoke(db, k)));
    return r;
  }

  static Object writeObj(Object o, Class<?> tagCompound) throws Exception {
    Object tag = tagCompound.getConstructor().newInstance();
    o.getClass().getMethod("writeToNBT", tagCompound).invoke(o, tag);
    return tag;
  }

  static void writeOut(String out) throws Exception {
    try (PrintWriter pw = new PrintWriter(new FileWriter(out))) { pw.print(sb); }
  }

  static Method findAny(Object o, String[] names, String retType, Class<?>... params) {
    for (String n : names) {
      try {
        Method m = o.getClass().getMethod(n, params);
        if (m.getReturnType().getName().equals(retType)) return m;
      } catch (Throwable ignored) {}
    }
    return find(o, retType, params);
  }

  /** 按「返回类型 + 参数类型」找方法，避开 SRG 名字 */
  static Method find(Object o, String retType, Class<?>... params) {
    String key = o.getClass().getName() + "#" + retType + "#" + params.length;
    Method cached = cache.get(key);
    if (cached != null) return cached;
    for (Method m : o.getClass().getMethods()) {
      if (m.getDeclaringClass() == Object.class) continue;
      if (m.getParameterCount() != params.length) continue;
      if (!m.getReturnType().getName().equals(retType)) continue;
      boolean ok = true;
      Class<?>[] ps = m.getParameterTypes();
      for (int i = 0; i < params.length; i++) {
        if (!ps[i].isAssignableFrom(params[i]) && !params[i].isAssignableFrom(ps[i])) { ok = false; break; }
      }
      if (!ok) continue;
      cached = m;
      break;
    }
    if (cached == null) throw new RuntimeException("找不到方法 " + key);
    cache.put(key, cached);
    return cached;
  }

  static String nbt(Object b) throws Exception {
    if (b == null) return "null";
    String cn = b.getClass().getSimpleName();
    if (cn.equals("NBTTagCompound")) {
      Set<?> keys = (Set<?>) find(b, "java.util.Set").invoke(b);
      List<String> sorted = new ArrayList<>();
      for (Object k : keys) sorted.add((String) k);
      Collections.sort(sorted);
      StringBuilder s = new StringBuilder("{");
      boolean first = true;
      for (String k : sorted) {
        Object v = find(b, "net.minecraft.nbt.NBTBase", String.class).invoke(b, k);
        if (!first) s.append(", ");
        first = false;
        s.append(q(k)).append(": ").append(nbt(v));
      }
      return s.append('}').toString();
    }
    if (cn.equals("NBTTagList")) {
      Field f = null;
      for (Field cand : b.getClass().getDeclaredFields()) {
        if (List.class.isAssignableFrom(cand.getType())) { f = cand; break; }
      }
      if (f == null) throw new RuntimeException("NBTTagList 没有 List 字段");
      f.setAccessible(true);
      List<?> l = (List<?>) f.get(b);
      StringBuilder s = new StringBuilder("[");
      for (int i = 0; i < l.size(); i++) {
        if (i > 0) s.append(", ");
        s.append(nbt(l.get(i)));
      }
      return s.append(']').toString();
    }
    if (cn.equals("NBTTagString")) return q(String.valueOf(find(b, "java.lang.String").invoke(b)));
    if (cn.equals("NBTTagByteArray")) return Arrays.toString((byte[]) find(b, "[B").invoke(b));
    if (cn.equals("NBTTagIntArray")) return Arrays.toString((int[]) find(b, "[I").invoke(b));
    Object v;
    if (cn.equals("NBTTagByte")) v = find(b, "byte").invoke(b);
    else if (cn.equals("NBTTagShort")) v = find(b, "short").invoke(b);
    else if (cn.equals("NBTTagInt")) v = find(b, "int").invoke(b);
    else if (cn.equals("NBTTagLong")) v = find(b, "long").invoke(b);
    else if (cn.equals("NBTTagFloat")) v = find(b, "float").invoke(b);
    else if (cn.equals("NBTTagDouble")) v = find(b, "double").invoke(b);
    else throw new RuntimeException("未知 NBT 类型 " + cn);
    if (v instanceof Float) {
      float x = (Float) v;
      if (x == Math.rint(x) && !Float.isInfinite(x)) return String.valueOf((long) x);
      return String.valueOf(x);
    }
    if (v instanceof Double) {
      double x = (Double) v;
      if (x == Math.rint(x) && !Double.isInfinite(x)) return String.valueOf((long) x);
      return String.valueOf(x);
    }
    return String.valueOf(v);
  }

  static String q(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
      }
    }
    return b.append('"').toString();
  }
}
