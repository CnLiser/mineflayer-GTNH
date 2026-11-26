import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * 探针：从若干 jar 里按正则挑顶层类，强制加载，列出
 *   1) static 容器字段（Map/Collection/Array 与大小）
 *   2) public static instance()/getInstance() 单例里的实例容器字段
 * 用途：快速定位一个 mod 把配方表放在哪里。
 *
 * args = "<outFile>@@<jar1;jar2;...>@@<classNameRegex>"
 *   —— 用 @@ 分隔（正则里可以放心用 |），jar 之间用 ; 分隔。
 */
public class ProbeScan1 {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); } catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(args.split("@@", 3)[0].trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String[] p = args.trim().split("@@", 3);
    String out = p[0].trim();
    String[] jars = p[1].trim().split(";");
    String re = p.length > 2 ? p[2].trim() : ".*";

    Class<?> stack = null;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraft.item.ItemStack")) stack = c;
    ClassLoader cl = stack == null ? null : stack.getClassLoader();
    sb.append("## classloader=").append(cl).append("  regex=").append(re).append('\n');

    for (String jarPath : jars) {
      jarPath = jarPath.trim();
      if (jarPath.isEmpty()) continue;
      sb.append("\n######## ").append(jarPath).append('\n');
      JarFile jf = new JarFile(jarPath);
      List<String> names = new ArrayList<>();
      for (JarEntry e : Collections.list(jf.entries())) {
        String n = e.getName();
        if (!n.endsWith(".class") || n.contains("$")) continue;
        String cn = n.substring(0, n.length() - 6).replace('/', '.');
        if (!cn.matches(re)) continue;
        names.add(cn);
      }
      jf.close();
      Collections.sort(names);
      if (names.isEmpty()) { sb.append("  (没有匹配的类)\n"); continue; }
      for (String cn : names) {
        Class<?> c;
        try { c = Class.forName(cn, false, cl); } catch (Throwable t) {
          sb.append("LOADFAIL ").append(cn).append(' ').append(t.getClass().getSimpleName()).append('\n');
          continue;
        }
        sb.append("== ").append(cn).append('\n');
        for (Field f : safeFields(c)) {
          if (!Modifier.isStatic(f.getModifiers())) continue;
          try { f.setAccessible(true); } catch (Throwable t) { continue; }
          Object v;
          try { v = f.get(null); } catch (Throwable t) { continue; }
          appendField("static", f, v);
        }
        Object single = singleton(c);
        if (single != null) {
          sb.append("   -- singleton ").append(single.getClass().getName()).append('\n');
          for (Field f : safeFields(single.getClass())) {
            if (Modifier.isStatic(f.getModifiers())) continue;
            try { f.setAccessible(true); } catch (Throwable t) { continue; }
            Object v;
            try { v = f.get(single); } catch (Throwable t) { continue; }
            appendField("inst", f, v);
          }
        }
      }
    }
    try (java.io.FileWriter w = new java.io.FileWriter(out)) { w.write(sb.toString()); }
  }

  static Field[] safeFields(Class<?> c) {
    try { return c.getDeclaredFields(); } catch (Throwable t) { return new Field[0]; }
  }

  static void appendField(String scope, Field f, Object v) {
    String d = desc(v);
    if (d == null) return;
    sb.append("   [").append(scope).append("] ").append(f.getName()).append(" : ")
      .append(f.getType().getSimpleName()).append(" = ").append(d);
    String sample = sample(v);
    if (sample != null) sb.append("   e.g. ").append(sample);
    sb.append('\n');
  }

  static String desc(Object v) {
    if (v == null) return null;
    if (v instanceof Map) return "Map(" + ((Map<?, ?>) v).size() + ")";
    if (v instanceof Collection) return "Collection(" + ((Collection<?>) v).size() + ")";
    if (v.getClass().isArray()) return "Array(" + Array.getLength(v) + ")";
    return null;
  }

  static String sample(Object v) {
    try {
      Object one = null;
      if (v instanceof Map) { Map<?, ?> m = (Map<?, ?>) v; if (m.isEmpty()) return null; one = m.entrySet().iterator().next(); }
      else if (v instanceof Collection) { Collection<?> c = (Collection<?>) v; if (c.isEmpty()) return null; one = c.iterator().next(); }
      else if (v.getClass().isArray()) { if (Array.getLength(v) == 0) return null; one = Array.get(v, 0); }
      if (one == null) return null;
      String s = String.valueOf(one).replace('\n', ' ');
      return s.length() > 160 ? s.substring(0, 160) + "…" : s;
    } catch (Throwable t) { return null; }
  }

  static Object singleton(Class<?> c) {
    for (String name : new String[] { "instance", "getInstance" }) {
      try {
        Method m = c.getMethod(name);
        if (!Modifier.isStatic(m.getModifiers()) || m.getParameterCount() != 0) continue;
        if (!c.isAssignableFrom(m.getReturnType())) continue;
        Object o = m.invoke(null);
        if (o != null) return o;
      } catch (Throwable t) { }
    }
    return null;
  }
}
