import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

public class ProbeTB3 {
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
      Method match = null; Method mat = null;
      for (Method m : tb.getMethods()) {
        if (m.getName().equals("getMatchingRecipe") && m.getParameterCount() == 4) match = m;
        if (m.getName().equals("getMaterialID") && m.getParameterCount() == 1) mat = m;
      }
      Class<?> itemCls = match.getParameterTypes()[0];
      Class<?> stackCls = mat.getParameterTypes()[0];
      out.append("Item=").append(itemCls.getName()).append(" ItemStack=").append(stackCls.getName()).append("\n");
      Method getItem = null;
      for (Method m : itemCls.getMethods()) if (m.getName().startsWith("func_150899") && m.getParameterCount() == 1 && m.getReturnType() == itemCls) getItem = m;
      out.append("getItem=").append(getItem).append("\n");
      getItem.setAccessible(true);
      int[][] combos = { {4523,4508,4509,4509}, {4503,4501,4506,-1}, {4522,4508,4509,4507}, {4523,4508,4509,-1}, {4509,4509,-1,-1} };
      for (int[] c : combos) {
        Object[] items = new Object[4];
        for (int i = 0; i < 4; i++) items[i] = c[i] < 0 ? null : getItem.invoke(null, c[i]);
        Object r = null; String err = "";
        try { r = match.invoke(builder, items[0], items[1], items[2], items[3]); } catch (Throwable t) { err = String.valueOf(t.getCause()); }
        out.append("combo ").append(java.util.Arrays.toString(c)).append(" -> ").append(r == null ? ("null " + err) : r.getClass().getName()).append("\n");
      }
    } catch (Throwable t) {
      out.append("ERR ").append(t).append("\n");
      for (StackTraceElement e : t.getStackTrace()) out.append("  ").append(e).append("\n");
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(file, true))) { w.print(out); } catch (Throwable t) {}
    System.err.println("[probetb3]\n" + out);
  }
}
