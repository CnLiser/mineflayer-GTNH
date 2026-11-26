import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;
import java.util.*;

/**
 * 探针：导出每个方块 (id, meta) 的挖掘工具与等级。
 *
 * 1.7.10 的 Block 有 getHarvestTool(int) / getHarvestLevel(int)（SRG 名随映射变，
 * 所以运行时按签名找：一个参数是 int 的方法，返回 String 的叫 tool，返回 int 的叫 level）。
 * GT 的矿石按 meta 走材料等级，机器/线缆则把 wrench / wire cutter 当成工具类型报出来。
 *
 * args = "<outFile>"
 */
public class DumpHarvest6 {
  static StringBuilder sb = new StringBuilder();

  public static void agentmain(String args, Instrumentation inst) {
    try { run(args, inst); } catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.trim() + ".err"))) { t.printStackTrace(w); } catch (Throwable x) {}
    }
  }

  static void run(String args, Instrumentation inst) throws Exception {
    String out = args.trim();
    sb.setLength(0);

    Class<?> blockCls = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      if (c.getName().equals("net.minecraft.block.Block")) { blockCls = c; break; }
    }
    if (blockCls == null) { sb.append("no Block class\n"); write(out); return; }

    // 1.7.10 的方块注册表：Block.blockRegistry（FMLControlledNamespacedRegistry，Iterable）
    Object registry = null;
    for (Field f : blockCls.getDeclaredFields()) {
      if (!Modifier.isStatic(f.getModifiers())) continue;
      try { f.setAccessible(true); Object v = f.get(null); if (v instanceof Iterable) { registry = v; break; } } catch (Throwable t) {}
    }
    if (registry == null) { sb.append("no block registry\n"); write(out); return; }

    Method nameOf = null;
    for (Method m : blockCls.getMethods()) {
      Class<?>[] pt = m.getParameterTypes();
      if (pt.length == 1 && pt[0] == blockCls && m.getReturnType() == String.class) nameOf = m;
    }
    sb.append("# nameMethod=").append(nameOf).append('\n');
    if (nameOf == null) { write(out); return; }

    List<Object[]> blocks = new ArrayList<>();
    for (Object b : (Iterable<?>) registry) {
      if (b == null || !blockCls.isInstance(b)) continue;
      try { blocks.add(new Object[] { nameOf.invoke(null, b), b }); } catch (Throwable t) {}
    }
    sb.append("# blocks=").append(blocks.size()).append('\n');

    Method toolM = null, levelM = null;
    for (Method m : blockCls.getMethods()) {
      Class<?>[] pt = m.getParameterTypes();
      if (pt.length != 1 || pt[0] != int.class) continue;
      if (m.getReturnType() == String.class && m.getName().toLowerCase().contains("arvest")) toolM = m;
      if (m.getReturnType() == int.class && m.getName().toLowerCase().contains("arvest")) levelM = m;
    }
    sb.append("# toolMethod=").append(toolM).append(" levelMethod=").append(levelM).append('\n');
    if (toolM == null || levelM == null) { write(out); return; }

    int n = 0;
    for (Object[] row : blocks) {
      String name = (String) row[0];
      Object b = row[1];
      if (name == null) continue;
      for (int meta = 0; meta < 16; meta++) {
        String tool;
        int level;
        try {
          tool = (String) toolM.invoke(b, meta);
          level = (Integer) levelM.invoke(b, meta);
        } catch (Throwable t) { continue; }
        if (tool == null || tool.isEmpty()) continue;
        sb.append("{\"name\":\"").append(esc(name)).append("\",\"meta\":").append(meta)
          .append(",\"tool\":\"").append(esc(tool)).append("\",\"level\":").append(level).append("}\n");
        n++;
      }
    }
    sb.append("# total=").append(n).append('\n');
    write(out);
  }

  static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

  static void write(String out) throws IOException {
    try (Writer w = new OutputStreamWriter(new FileOutputStream(out), "UTF-8")) { w.write(sb.toString()); }
  }
}
