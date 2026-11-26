import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/** 探针：Forestry 第一条 carpenter 配方到底长什么样、为什么方法调用都空。 */
public class ProbeF2 {
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

  static void run(String out, Instrumentation inst) throws Exception {
    Class<?> rm = find(inst, "forestry.api.recipes.RecipeManagers");
    sb.append("rm=").append(rm).append('\n');
    if (rm == null) { write(out); return; }
    Object mgr = getStatic(rm, "carpenterManager");
    sb.append("mgr=").append(mgr == null ? "null" : mgr.getClass().getName()).append('\n');
    if (mgr == null) { write(out); return; }

    Object recs = null;
    for (Method m : mgr.getClass().getDeclaredMethods()) {
      if (!m.getName().equals("getRecipes")) continue;
      m.setAccessible(true);
      try { recs = m.invoke(mgr); sb.append("getRecipes() -> ").append(recs == null ? "null" : recs.getClass().getName()).append('\n'); }
      catch (Throwable t) { sb.append("getRecipes threw ").append(t).append('\n'); }
    }
    Map<?, ?> map = (Map<?, ?>) recs;
    if (map == null || map.isEmpty()) { write(out); return; }
    Map.Entry<?, ?> e = map.entrySet().iterator().next();
    sb.append("key=").append(e.getKey() == null ? "null" : e.getKey().getClass().getName()).append('\n');
    Object r = e.getValue();
    sb.append("value=").append(r == null ? "null" : r.getClass().getName()).append('\n');
    if (r == null) { write(out); return; }
    sb.append("--- all methods and invocations\n");
    Set<String> seen = new LinkedHashSet<>();
    for (Class<?> c = r.getClass(); c != null; c = c.getSuperclass()) {
      for (Method m : c.getDeclaredMethods()) {
        if (!m.getName().startsWith("get") && !m.getName().startsWith("is")) continue;
        if (m.getParameterCount() != 0) continue;
        if (!seen.add(m.getName())) continue;
        String res;
        try { m.setAccessible(true); Object v = m.invoke(r); res = String.valueOf(v == null ? "null" : v.getClass().getName() + " " + brief(v)); }
        catch (Throwable t) { res = "THREW " + t; }
        sb.append("  ").append(c.getSimpleName()).append('.').append(m.getName()).append("() = ").append(res).append('\n');
      }
    }
    write(out);
  }

  static String brief(Object v) {
    try { String s = String.valueOf(v); return s.length() > 120 ? s.substring(0, 120) + "…" : s; } catch (Throwable t) { return "?"; }
  }

  static void write(String out) {
    try (Writer w = new FileWriter(out)) { w.write(sb.toString()); } catch (Throwable t) {}
  }
}
