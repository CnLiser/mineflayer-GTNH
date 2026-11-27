import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.util.*;
import java.io.*;

/**
 * 看 ModularUI2 服务端到底把 GUI session 存在哪个 networkId 下。
 *
 * 走 ModularNetwork.SERVER（ServerManager）-> playerHandlers(Map<UUID, Server>)
 * -> 每个 Server 的父类 ModularNetworkSide.activeScreens(Int2ReferenceOpenHashMap) 的 keySet。
 *
 * args = "<outFile>"
 */
public class ProbeMui2 {
  public static void agentmain(String args, Instrumentation inst) {
    try { run(args.trim(), inst); }
    catch (Throwable t) {
      try (PrintWriter w = new PrintWriter(new FileWriter(args.trim() + ".err"))) { t.printStackTrace(w); }
      catch (Throwable x) {}
    }
  }

  static Object stat(Class<?> c, String name) throws Exception {
    Field f = c.getDeclaredField(name);
    f.setAccessible(true);
    return f.get(null);
  }

  static Object inst(Object o, Class<?> c, String name) throws Exception {
    Field f = c.getDeclaredField(name);
    f.setAccessible(true);
    return f.get(o);
  }

  static void run(String outFile, Instrumentation inst) throws Exception {
    StringBuilder sb = new StringBuilder();
    Class<?> mn = null, side = null, server = null, mgr = null;
    for (Class<?> c : inst.getAllLoadedClasses()) {
      String n = c.getName();
      if (n.equals("com.cleanroommc.modularui.network.ModularNetwork")) mn = c;
      else if (n.equals("com.cleanroommc.modularui.network.ModularNetworkSide")) side = c;
      else if (n.equals("com.cleanroommc.modularui.network.ModularNetwork$Server")) server = c;
      else if (n.equals("com.cleanroommc.modularui.network.ModularNetwork$ServerManager")) mgr = c;
    }
    sb.append("loaded: ModularNetwork=").append(mn != null)
      .append(" Side=").append(side != null)
      .append(" Server=").append(server != null)
      .append(" ServerManager=").append(mgr != null).append('\n');
    if (mn == null || mgr == null) { write(outFile, sb); return; }

    Object serverManager = null;
    for (Field f : mn.getDeclaredFields()) {
      if (!Modifier.isStatic(f.getModifiers())) continue;
      if (!mgr.isAssignableFrom(f.getType())) continue;
      f.setAccessible(true);
      serverManager = f.get(null);
      sb.append("SERVER field: ").append(f.getName()).append(" -> ").append(serverManager).append('\n');
      break;
    }
    if (serverManager == null) { write(outFile, sb); return; }

    Map<?, ?> players = null;
    for (Field f : mgr.getDeclaredFields()) {
      if (Map.class.isAssignableFrom(f.getType())) {
        f.setAccessible(true);
        players = (Map<?, ?>) f.get(serverManager);
        sb.append("players field: ").append(f.getName()).append(" size=").append(players.size()).append('\n');
        break;
      }
    }
    if (players == null) { write(outFile, sb); return; }

    for (Map.Entry<?, ?> e : players.entrySet()) {
      Object srv = e.getValue();
      sb.append("player ").append(e.getKey()).append(" -> ").append(srv.getClass().getName()).append('\n');
      // Server 自己的 nextId
      for (Class<?> c = srv.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
        for (Field f : c.getDeclaredFields()) {
          if (f.getType() == int.class) {
            f.setAccessible(true);
            sb.append("  int ").append(f.getName()).append(" = ").append(f.getInt(srv)).append('\n');
          }
        }
      }
      // 同一条继承链上的 activeScreens
      for (Class<?> c = srv.getClass(); c != null && c != Object.class; c = c.getSuperclass()) {
        for (Field f : c.getDeclaredFields()) {
          if (!Map.class.isAssignableFrom(f.getType()) && !f.getType().getName().contains("OpenHashMap")) continue;
          f.setAccessible(true);
          Object v = f.get(srv);
          if (v == null) continue;
          if (v instanceof Map) {
            sb.append("  map ").append(f.getName()).append(" keys=").append(((Map<?, ?>) v).keySet()).append('\n');
          } else {
            Method ks = v.getClass().getMethod("keySet");
            ks.setAccessible(true);
            sb.append("  ").append(v.getClass().getSimpleName()).append(' ').append(f.getName())
              .append(" keys=").append(ks.invoke(v)).append('\n');
          }
        }
      }
    }
    write(outFile, sb);
  }

  static void write(String outFile, StringBuilder sb) throws Exception {
    try (PrintWriter w = new PrintWriter(new FileWriter(outFile))) { w.print(sb); }
  }
}
