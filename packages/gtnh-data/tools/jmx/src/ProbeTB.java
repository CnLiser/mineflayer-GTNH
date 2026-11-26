import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

public class ProbeTB {
  static StringBuilder out = new StringBuilder();
  static Class<?> C(Instrumentation inst, String n) throws Exception {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(n)) return c;
    throw new ClassNotFoundException(n);
  }
  public static void agentmain(String args, Instrumentation inst) {
    String file = args;
    try {
      Class<?> itemCls = C(inst, "add");                     // ItemStack
      Class<?> itemDef = C(inst, "adb");                     // Item
      Class<?> reg = C(inst, "TConstructRegistry");
      // 取物品 id -> Item
      Method getItem = null;
      for (Method m : itemDef.getMethods()) if (m.getName().equals("func_150899_d") && m.getParameterCount() == 1) getItem = m;
      getItem.setAccessible(true);
      Class<?> tb = C(inst, "tconstruct.library.crafting.ToolBuilder");
      Field instF = tb.getField("instance"); instF.setAccessible(true);
      Object builder = instF.get(null);
      Method match = null;
      for (Method m : tb.getMethods()) if (m.getName().equals("getMatchingRecipe")) { match = m; break; }
      match.setAccessible(true);
      int[][] combos = { {4523,4508,4509,4509}, {4503,4501,4506,-1}, {4522,4508,4509,4507} };
      for (int[] c : combos) {
        Object[] items = new Object[4];
        for (int i = 0; i < 4; i++) items[i] = c[i] < 0 ? null : getItem.invoke(null, c[i]);
        Object r = match.invoke(builder, items[0], items[1], items[2], items[3]);
        out.append("combo ").append(java.util.Arrays.toString(c)).append(" -> ").append(r == null ? "null" : r.getClass().getName()).append("\n");
      }
    } catch (Throwable t) {
      out.append("ERR ").append(t).append("\n");
      for (StackTraceElement e : t.getStackTrace()) out.append("  ").append(e).append("\n");
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(file, true))) { w.print(out); }
    catch (Throwable t) {}
    System.err.println("[probetb]\n" + out);
  }
}
