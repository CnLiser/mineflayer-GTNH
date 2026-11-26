import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/** 探针 3：Forestry getRecipes() 的 value 是 Object[]，看看里面装的是什么。 */
public class ProbeF3 {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static Class<?> find(Instrumentation inst, String name) {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(name)) return c;
    return null;
  }

  static Object getStatic(Class<?> cls, String field) {
    for (Class<?> c = cls; c != null; c = c.getSuperclass()) {
      try { Field f = c.getDeclaredField(field); f.setAccessible(true); return f.get(null); } catch (Throwable e) {}
    }
    return null;
  }

  static String brief(Object v) {
    try { String s = String.valueOf(v); return s.length() > 160 ? s.substring(0, 160) + "…" : s; } catch (Throwable t) { return "?"; }
  }

  static void run(String out, Instrumentation inst) throws Exception {
    Class<?> rm = find(inst, "forestry.api.recipes.RecipeManagers");
    String[][] mgrs = {{"carpenterManager", "carpenter"}, {"centrifugeManager", "centrifuge"}, {"squeezerManager", "squeezer"}};
    for (String[] p : mgrs) {
      Object mgr = getStatic(rm, p[0]);
      sb.append("=== ").append(p[1]).append(" mgr=").append(mgr == null ? "null" : mgr.getClass().getName()).append('\n');
      if (mgr == null) continue;
      Object recs = null;
      for (Method m : mgr.getClass().getDeclaredMethods()) {
        if (!m.getName().equals("getRecipes")) continue;
        m.setAccessible(true);
        try { recs = m.invoke(mgr); } catch (Throwable t) { sb.append("  threw ").append(t).append('\n'); }
      }
      sb.append("  recs=").append(recs == null ? "null" : recs.getClass().getName()).append('\n');
      if (!(recs instanceof Map)) continue;
      sb.append("  size=").append(((Map<?, ?>) recs).size()).append('\n');
      int n = 0;
      for (Map.Entry<?, ?> e : ((Map<?, ?>) recs).entrySet()) {
        if (n++ >= 3) break;
        sb.append("  -- entry ").append(n).append('\n');
        sb.append("     key  ").append(cls(e.getKey())).append("\n");
        Object v = e.getValue();
        sb.append("     value ").append(cls(v)).append("\n");
        if (v instanceof Object[]) {
          Object[] arr = (Object[]) v;
          sb.append("     arraylen=").append(arr.length).append('\n');
          for (int i = 0; i < arr.length; i++) {
            sb.append("       [").append(i).append("] ").append(cls(arr[i])).append("\n");
            if (arr[i] != null && !(arr[i] instanceof Object[])) sb.append("            ").append(brief(arr[i])).append('\n');
          }
        }
      }
    }
    try (Writer w = new FileWriter(out)) { w.write(sb.toString()); } catch (Throwable t) {}
  }

  static String cls(Object o) {
    return o == null ? "null" : o.getClass().getName() + " :: " + brief(o);
  }
}
