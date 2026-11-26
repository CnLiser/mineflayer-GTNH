import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/**
 * 探针：按类名前缀列出已加载的类，以及它们的 public static 字段（名字/类型/是不是 null/容器大小）。
 * 用途：快速找到各 mod 把配方表放在哪个类的哪个字段，再写对应的导出逻辑。
 *
 * args = "<outFile> <prefix1,prefix2,...>"
 */
public class ProbeInv {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.split(" ")[0] + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String[] p = args.trim().split("\\s+");
    String out = p[0];
    String[] prefixes = p.length > 1 ? p[1].split(",") : new String[] { "forestry" };
    Class<?>[] all = inst.getAllLoadedClasses();
    Arrays.sort(all, Comparator.comparing(Class::getName));

    for (String prefix : prefixes) {
      sb.append("########## ").append(prefix).append('\n');
      int n = 0;
      for (Class<?> c : all) {
        if (!c.getName().startsWith(prefix)) continue;
        if (c.isInterface() || c.getName().contains("$")) continue;
        StringBuilder line = new StringBuilder();
        boolean any = false;
        for (Field f : c.getDeclaredFields()) {
          if (!Modifier.isStatic(f.getModifiers())) continue;
          f.setAccessible(true);
          Object v = null;
          try { v = f.get(null); } catch (Throwable t) { }
          String desc;
          if (v == null) desc = "null";
          else if (v instanceof Collection) desc = v.getClass().getSimpleName() + "(" + ((Collection<?>) v).size() + ")";
          else if (v instanceof Map) desc = v.getClass().getSimpleName() + "(" + ((Map<?, ?>) v).size() + ")";
          else if (v.getClass().isArray()) desc = v.getClass().getSimpleName() + "[" + Array.getLength(v) + "]";
          else desc = v.getClass().getName();
          if (!(v instanceof Collection) && !(v instanceof Map) && !v.getClass().isArray()) continue; // 只关心容器
          line.append("\n    ").append(f.getType().getSimpleName()).append(' ').append(f.getName()).append(" = ").append(desc);
          any = true;
        }
        if (!any) continue;
        sb.append("  ").append(c.getName()).append(line).append('\n');
        if (++n > 400) break;
      }
    }
    try (Writer w = new FileWriter(out)) { w.write(sb.toString()); }
  }
}
