import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

public class ProbeTB2 {
  static StringBuilder out = new StringBuilder();
  static Class<?> C(Instrumentation inst, String n) throws Exception {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(n)) return c;
    throw new ClassNotFoundException(n);
  }
  public static void agentmain(String args, Instrumentation inst) {
    String file = args;
    try {
      Class<?> forge = C(inst, "net.minecraftforge.common.MinecraftForge");
      ClassLoader cl = forge.getClassLoader();
      Class<?> itemCls = Class.forName("add", false, cl);
      Class<?> itemDef = Class.forName("adb", false, cl);
      Method getItem = null;
      for (Method m : itemDef.getMethods()) if (m.getName().equals("func_150899_d") && m.getParameterCount() == 1) getItem = m;
      getItem.setAccessible(true);
      Class<?> tb = Class.forName("tconstruct.library.crafting.ToolBuilder", true, cl);
      Object builder = tb.getField("instance").get(null);
      Method match = null;
      for (Method m : tb.getMethods()) if (m.getName().equals("getMatchingRecipe") && m.getParameterCount() == 4) { match = m; break; }
      match.setAccessible(true);
      int[][] combos = { {4523,4508,4509,4509}, {4503,4501,4506,-1}, {4522,4508,4509,4507}, {4523,4508,4509,-1} };
      for (int[] c : combos) {
        Object[] items = new Object[4];
        for (int i = 0; i < 4; i++) items[i] = c[i] < 0 ? null : getItem.invoke(null, c[i]);
        String cls = "";
        for (int i = 0; i < 4; i++) cls += (items[i] == null ? "null" : items[i].getClass().getName()) + ",";
        Object r = null; String err = "";
        try { r = match.invoke(builder, items[0], items[1], items[2], items[3]); } catch (Throwable t) { err = String.valueOf(t.getCause()); }
        out.append("combo ").append(java.util.Arrays.toString(c)).append(" [").append(cls).append("] -> ").append(r == null ? ("null" + (err.isEmpty() ? "" : " " + err)) : r.getClass().getName()).append("\n");
      }
    } catch (Throwable t) {
      out.append("ERR ").append(t).append("\n");
      for (StackTraceElement e : t.getStackTrace()) out.append("  ").append(e).append("\n");
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(file, true))) { w.print(out); }
    catch (Throwable t) {}
    System.err.println("[probetb2]\n" + out);
  }
}
