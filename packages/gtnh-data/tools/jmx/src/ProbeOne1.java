import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;

/** 探针：打印某个 static List 字段里前 N 个元素的某个字段的值与类型。args = "<out>@@<class>@@<listField>@@<elemField>" */
public class ProbeOne1 {
  public static void agentmain(String args, Instrumentation inst) {
    try {
      String[] p = args.trim().split("@@", 4);
      String out = p[0];
      ClassLoader cl = null;
      for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraft.item.ItemStack")) cl = c.getClassLoader();
      Class<?> c = Class.forName(p[1], false, cl);
      Field lf = c.getDeclaredField(p[2]);
      lf.setAccessible(true);
      List<?> list = (List<?>) lf.get(null);
      StringBuilder sb = new StringBuilder("size=" + list.size() + "\n");
      int n = Math.min(8, list.size());
      for (int i = 0; i < n; i++) {
        Object e = list.get(i);
        Field ef = null;
        for (Class<?> k = e.getClass(); k != null && ef == null; k = k.getSuperclass()) {
          try { ef = k.getDeclaredField(p[3]); } catch (Throwable t) {}
        }
        if (ef == null) { sb.append(i).append(" no field\n"); continue; }
        ef.setAccessible(true);
        Object v = ef.get(e);
        sb.append(i).append(" type=").append(v == null ? "null" : v.getClass().getName())
          .append(" value=").append(String.valueOf(v).replace('\n', ' ')).append('\n');
      }
      try (java.io.FileWriter w = new java.io.FileWriter(out)) { w.write(sb.toString()); }
    } catch (Throwable t) {
      try (java.io.PrintWriter w = new java.io.PrintWriter(new java.io.FileWriter(args.split("@@")[0] + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }
}
