import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

public class ProbeTB6 {
  static StringBuilder out = new StringBuilder();
  static Class<?> byName(Instrumentation inst, String n) throws Exception {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(n)) return c;
    throw new ClassNotFoundException(n);
  }
  public static void agentmain(String args, Instrumentation inst) {
    String file = args;
    try {
      Class<?> tb = byName(inst, "tconstruct.library.crafting.ToolBuilder");
      ClassLoader cl = tb.getClassLoader();
      Object builder = tb.getField("instance").get(null);
      Method build = null; Method mat = null; Method match = null;
      for (Method m : tb.getMethods()) {
        if (m.getName().equals("buildTool") && m.getParameterCount() == 5) build = m;
        if (m.getName().equals("getMaterialID") && m.getParameterCount() == 1) mat = m;
        if (m.getName().equals("getMatchingRecipe")) match = m;
      }
      Class<?> itemCls = mat.getParameterTypes()[0].getDeclaredMethod("func_77973_b").getReturnType();
      Class<?> stackCls = mat.getParameterTypes()[0];
      Method getItem = itemCls.getMethod("func_150899_d", int.class);
      Constructor<?> ctor = null;
      for (Constructor<?> c : stackCls.getConstructors()) if (c.getParameterCount() == 3 && c.getParameterTypes()[0] == itemCls) ctor = c;
      out.append("ctor=").append(ctor).append("\n");
      int[][] combos = { {4523,4508,4509,4509}, {4523,4508,4509,4509}, {4523,4508,4509,4509}, {4523,4508,4509,4509}, {4523,4508,4509,4509}, {4523,4508,4509,4509} };
      int[][] metas = { {0,0,0,0}, {4,4,4,4}, {5,5,5,5}, {3,0,3,3}, {1,0,1,1}, {7,0,7,7} };
      for (int i = 0; i < combos.length; i++) {
        Object[] stacks = new Object[4];
        for (int k = 0; k < 4; k++) {
          if (combos[i][k] < 0) { stacks[k] = null; continue; }
          Object it = getItem.invoke(null, combos[i][k]);
          stacks[k] = ctor.newInstance(it, 1, metas[i][k] < 0 ? 0 : metas[i][k]);
        }
        String mats = "";
        for (int k = 0; k < 4; k++) mats += (stacks[k] == null ? "null" : String.valueOf(mat.invoke(builder, stacks[k]))) + ",";
        Object r = null; String err = "";
        try { r = build.invoke(builder, stacks[0], stacks[1], stacks[2], stacks[3], ""); } catch (Throwable t) { err = String.valueOf(t.getCause()); }
        out.append("combo ").append(java.util.Arrays.toString(combos[i])).append(" meta ").append(java.util.Arrays.toString(metas[i]))
           .append(" matIDs[").append(mats).append("] -> ").append(r == null ? ("null " + err) : r.getClass().getName()).append("\n");
      }
      // 打印 Hammer 的 recipe 要求 material 类型
      Class<?> rec = byName(inst, "tconstruct.library.crafting.ToolRecipe");
      out.append("recipe class=").append(rec.getName()).append("\n");
    } catch (Throwable t) {
      out.append("ERR ").append(t).append("\n");
      for (StackTraceElement e : t.getStackTrace()) out.append("  ").append(e).append("\n");
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(file, true))) { w.print(out); } catch (Throwable t) {}
    System.err.println("[probetb4]\n" + out);
  }
}
