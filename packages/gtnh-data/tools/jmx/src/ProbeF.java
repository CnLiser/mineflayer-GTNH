import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;

/** 探针：Forestry 的 RecipeManagers 到底是谁、字段是不是 null。 */
public class ProbeF {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String out, Instrumentation inst) throws Exception {
    Class<?> rm = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      String n = c.getName();
      if (n.contains("RecipeManagers") && n.startsWith("forestry")) {
        sb.append("classes: ").append(n).append(" loader=").append(c.getClassLoader()).append('\n');
        if (n.equals("forestry.api.recipes.RecipeManagers")) rm = c;
      }
    }
    if (rm == null) { sb.append("forestry.api.recipes.RecipeManagers NOT LOADED\n"); }
    else {
      sb.append("--- fields of ").append(rm.getName()).append(" (loader=").append(rm.getClassLoader()).append(")\n");
      for (Field f : rm.getDeclaredFields()) {
        f.setAccessible(true);
        Object v = null; String err = "";
        try { v = f.get(null); } catch (Throwable t) { err = " <" + t + ">"; }
        sb.append("  ").append(Modifier.toString(f.getModifiers())).append(' ')
          .append(f.getType().getName()).append(' ').append(f.getName())
          .append(" = ").append(v == null ? "null" : v.getClass().getName()).append(err).append('\n');
      }
    }
    // 找实现类
    for (Class<?> c : inst.getAllLoadedClasses()) {
      String n = c.getName();
      if (n.contains("CarpenterRecipeManager") || n.contains("CentrifugeRecipeManager")) {
        sb.append("impl: ").append(n).append('\n');
        for (Method m : c.getMethods()) if (m.getName().equals("getRecipes")) sb.append("   getRecipes -> ").append(m).append('\n');
      }
    }
    try (Writer w = new FileWriter(out)) { w.write(sb.toString()); }
  }
}
