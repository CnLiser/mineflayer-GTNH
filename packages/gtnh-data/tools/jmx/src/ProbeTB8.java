import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

public class ProbeTB8 {
  static StringBuilder out = new StringBuilder();
  static Class<?> byName(Instrumentation inst, String n) throws Exception {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(n)) return c;
    throw new ClassNotFoundException(n);
  }
  public static void agentmain(String args, Instrumentation inst) {
    try {
      Class<?> tb = byName(inst, "tconstruct.library.crafting.ToolBuilder");
      ClassLoader cl = tb.getClassLoader();
      Object builder = tb.getField("instance").get(null);
      Method build = null; Method mat = null;
      for (Method m : tb.getMethods()) {
        if (m.getName().equals("buildTool") && m.getParameterCount() == 5) build = m;
        if (m.getName().equals("getMaterialID") && m.getParameterCount() == 1) mat = m;
      }
      Class<?> stackCls = mat.getParameterTypes()[0];
      Class<?> itemCls = stackCls.getMethod("func_77973_b").getReturnType();
      Method getItem = itemCls.getMethod("func_150899_d", int.class);
      Constructor<?> ctor = null;
      for (Constructor<?> c : stackCls.getConstructors()) if (c.getParameterCount() == 3 && c.getParameterTypes()[0] == itemCls) ctor = c;
      Class<?> reg = Class.forName("tconstruct.library.TConstructRegistry", true, cl);
      Method getMat = null;
      for (Method m : reg.getMethods()) if (m.getName().equals("getMaterial") && m.getParameterCount() == 1) getMat = m;
      for (int mid = 0; mid <= 20; mid++) {
        Object matObj = getMat.invoke(null, mid);
        String name = "?";
        if (matObj != null) { try { name = String.valueOf(matObj.getClass().getField("materialName").get(matObj)); } catch (Throwable t) { name = "?"; } }
        Object[] s = new Object[4];
        int[] ids = {4523,4508,4509,4509};
        for (int k = 0; k < 4; k++) s[k] = ctor.newInstance(getItem.invoke(null, ids[k]), 1, mid);
        Object r = null; String err = "";
        try { r = build.invoke(builder, s[0], s[1], s[2], s[3], ""); } catch (Throwable t) { err = String.valueOf(t.getCause()); }
        out.append("mid=").append(mid).append(" name=").append(name).append(" -> ").append(r == null ? ("null " + err) : "OK").append("\n");
      }
    } catch (Throwable t) {
      out.append("ERR ").append(t).append("\n");
      for (StackTraceElement e : t.getStackTrace()) out.append("  ").append(e).append("\n");
    }
    try (PrintWriter w = new PrintWriter(new FileWriter(args, true))) { w.print(out); } catch (Throwable t) {}
    System.err.println("[probetb8]\n" + out);
  }
}
