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
public class DumpHarvest2 {
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

    // 1.7.10 没有 blocksList：方块挂在 Block.blockRegistry（RegistryNamespaced）里，
    // 它的 registryObjects 才是 Map<名字, Block>。字段名随映射变，按类型找。
    Map<String, Object> byId = new TreeMap<>();
    Map<String, Object> byName = new LinkedHashMap<>();
    for (Field f : blockCls.getDeclaredFields()) {
      if (!Modifier.isStatic(f.getModifiers())) continue;
      Object reg;
      try { f.setAccessible(true); reg = f.get(null); } catch (Throwable t) { continue; }
      if (reg == null) continue;
      if (reg instanceof Map) collect((Map<?, ?>) reg, blockCls, byId, byName);
      else {
        for (Field g : reg.getClass().getDeclaredFields()) {
          try { g.setAccessible(true); Object m = g.get(reg); if (m instanceof Map) collect((Map<?, ?>) m, blockCls, byId, byName); } catch (Throwable t) {}
        }
      }
    }
    sb.append("# blocks=").append(byId.size()).append(" names=").append(byName.size()).append('\n');

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
    for (Map.Entry<String, Object> e : byId.entrySet()) {
      int id = Integer.parseInt(e.getKey());
      Object b = e.getValue();
      if (b == null) continue;
      for (int meta = 0; meta < 16; meta++) {
        String tool;
        int level;
        try {
          tool = (String) toolM.invoke(b, meta);
          level = (Integer) levelM.invoke(b, meta);
        } catch (Throwable t) { continue; }
        if (tool == null || tool.isEmpty()) continue;
        sb.append("{\"id\":").append(id).append(",\"meta\":").append(meta)
          .append(",\"tool\":\"").append(esc(tool)).append("\",\"level\":").append(level).append("}\n");
        n++;
      }
    }
    sb.append("# total=").append(n).append('\n');
    write(out);
  }

  static void collect(Map<?, ?> m, Class<?> blockCls, Map<String, Object> byId, Map<String, Object> byName) {
    for (Map.Entry<?, ?> e : m.entrySet()) {
      if (!blockCls.isInstance(e.getValue())) continue;
      String key = String.valueOf(e.getKey());
      if (key.matches("-?\\d+")) byId.put(key, e.getValue());
      else if (!byName.containsKey(key)) byName.put(key, e.getValue());
    }
  }

  static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

  static void write(String out) throws IOException {
    try (Writer w = new OutputStreamWriter(new FileOutputStream(out), "UTF-8")) { w.write(sb.toString()); }
  }
}
