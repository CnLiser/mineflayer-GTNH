import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;

/** 探针：IC2 的 Recipes.macerator 到底是哪个类、内部 Map 有多大。 */
public class ProbeIC2 {
  static StringBuilder sb = new StringBuilder();

  public static void main(String[] a) { }

  public static void agentmain(String args, Instrumentation inst) {
    try { run(inst); } catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(args.split(" ")[0] + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(Instrumentation inst) throws Exception {
    Class<?> recipes = null;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("ic2.api.recipe.Recipes")) recipes = c;
    if (recipes == null) { write("no Recipes class"); return; }
    for (Field f : recipes.getFields()) {
      if (!f.getType().getName().equals("ic2.api.recipe.IMachineRecipeManager")) continue;
      Object mgr = null;
      try { mgr = f.get(null); } catch (Throwable t) {}
      if (mgr == null) { sb.append(f.getName()).append(" = null\n"); continue; }
      sb.append(f.getName()).append(" -> ").append(mgr.getClass().getName()).append('\n');
      for (Class<?> c = mgr.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
        for (Field ff : c.getDeclaredFields()) {
          if (Modifier.isStatic(ff.getModifiers())) continue;
          ff.setAccessible(true);
          Object v = null;
          try { v = ff.get(mgr); } catch (Throwable t) { continue; }
          String d = v == null ? "null" : (v instanceof Map ? "Map(" + ((Map<?, ?>) v).size() + ")" : (v instanceof Collection ? "Collection(" + ((Collection<?>) v).size() + ")" : v.getClass().getSimpleName()));
          sb.append("   ").append(c.getSimpleName()).append('.').append(ff.getName()).append(" = ").append(d).append('\n');
        }
      }
    }
    write(sb.toString());
  }

  static void write(String s) throws Exception {
    java.io.FileWriter w = new java.io.FileWriter("/tmp/ic2probe.txt");
    w.write(s); w.close();
    System.err.println("[probeic2]\n" + s);
  }
}
