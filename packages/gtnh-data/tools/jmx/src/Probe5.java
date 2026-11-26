import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

public class Probe5 {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try {
      run(args, inst);
    } catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    Class<?> rm = null;
    Class<?> rec = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      String n = c.getName();
      if (n.equals("gregtech.api.recipe.RecipeMap")) rm = c;
      if (n.equals("gregtech.api.util.GTRecipe")) rec = c;
    }
    sb.append("RecipeMap=").append(rm).append(" GTRecipe=").append(rec).append('\n');
    if (rm != null) {
      for (Field f : rm.getDeclaredFields()) {
        sb.append("  RMF ").append(Modifier.toString(f.getModifiers())).append(' ')
          .append(f.getName()).append(" : ").append(f.getType().getName()).append('\n');
      }
      for (Method m : rm.getDeclaredMethods()) {
        sb.append("  RMM ").append(m.getName()).append(" | ")
          .append(Arrays.toString(m.getParameterTypes())).append(" -> ")
          .append(m.getReturnType().getSimpleName()).append('\n');
      }
    }
    if (rec != null) {
      for (Field f : rec.getDeclaredFields()) {
        sb.append("  GF ").append(f.getName()).append(" : ").append(f.getType().getSimpleName()).append('\n');
      }
      for (Method m : rec.getDeclaredMethods()) {
        sb.append("  GM ").append(m.getName()).append(" | ")
          .append(Arrays.toString(m.getParameterTypes())).append(" -> ")
          .append(m.getReturnType().getSimpleName()).append('\n');
      }
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(args))) { w.write(sb.toString()); }
  }
}
