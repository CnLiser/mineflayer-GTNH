import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * 探针：从 jar 里按正则挑类名，强制加载（initialize=false），列出 static 容器字段 + 单例里的小容器。
 * args = "<outFile>|<jar Path>|<classNameRegex>"
 */
public class ProbeLoad2 {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); } catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(args.split("\\|", 3)[0].trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String[] p = args.trim().split("\\|", 3);
    String out = p[0].trim(), jar = p[1].trim(), re = p[2].trim();
    Class<?> stack = null;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraft.item.ItemStack")) stack = c;
    ClassLoader cl = stack == null ? null : stack.getClassLoader();
    JarFile jf = new JarFile(jar);
    List<String> names = new ArrayList<>();
    for (JarEntry e : Collections.list(jf.entries())) {
      String n = e.getName();
      if (!n.endsWith(".class") || n.contains("$")) continue;
      String cn = n.substring(0, n.length() - 6).replace('/', '.');
      if (!cn.matches(re)) continue;
      names.add(cn);
    }
    Collections.sort(names);
    sb.append("## jar=").append(jar).append(" 匹配 ").append(names.size()).append(" 个类\n");
    for (String cn : names) {
      Class<?> c;
      try { c = Class.forName(cn, false, cl); } catch (Throwable t) { sb.append("LOADFAIL ").append(cn).append(' ').append(t.getClass().getSimpleName()).append('\n'); continue; }
      sb.append("== ").append(cn).append('\n');
      Field[] fs;
      try { fs = c.getDeclaredFields(); } catch (Throwable t) { sb.append("   (fields unavailable)\n"); continue; }
      for (Field f : fs) {
        if (!Modifier.isStatic(f.getModifiers())) continue;
        String d;
        try { f.setAccessible(true); Object v = f.get(null); d = desc(v); } catch (Throwable t) { d = "<err " + t.getClass().getSimpleName() + ">"; }
        if (d == null) continue;
        sb.append("   ").append(f.getName()).append(" : ").append(f.getType().getSimpleName()).append(" = ").append(d).append('\n');
      }
    }
    try (java.io.FileWriter w = new java.io.FileWriter(out)) { w.write(sb.toString()); }
    System.err.println("[probeload2] " + names.size() + " classes -> " + out);
  }

  static String desc(Object v) {
    if (v == null) return "null";
    if (v instanceof Map) return "Map(" + ((Map<?, ?>) v).size() + ")";
    if (v instanceof Collection) return "Collection(" + ((Collection<?>) v).size() + ")";
    if (v.getClass().isArray()) return "Array(" + Array.getLength(v) + ")";
    return null; // 只关心容器与 null
  }
}
