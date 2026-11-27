import java.io.*; import java.lang.reflect.*; import java.util.*; import java.util.jar.*;
public class ProbeScan5 {
  static StringBuilder sb = new StringBuilder();
  static ClassLoader cl;
  public static void main(String[] a) throws Exception {
    run(a);
  }
  public static void agentmain(String a) {
    try { run(new String[]{a}); }
    catch (Throwable t) {
      System.out.println("FATAL " + t);
      try (PrintWriter pw = new PrintWriter(new FileWriter(a.split("@@")[0] + ".err"))) {
        t.printStackTrace(pw);
        pw.println("---partial---");
        pw.print(sb);
      } catch (Throwable ignored) {}
    }
  }
  static void run(String[] a) throws Exception {
    sb.setLength(0);
    String[] outAnd = a[0].split("@@");
    String out = outAnd[0];
    String[] jars = outAnd[1].split(";");
    cl = null;
    try {
      Class<?> launch = Class.forName("net.minecraft.launchwrapper.Launch");
      cl = (ClassLoader) launch.getField("classLoader").get(null);
    } catch (Throwable ignored) {}
    if (cl == null) cl = Thread.currentThread().getContextClassLoader();
    if (cl == null) cl = ClassLoader.getSystemClassLoader();
    sb.append("loader ").append(cl.getClass().getName()).append('\n');
    for (String jp : jars) {
      sb.append("\n##### ").append(new File(jp).getName()).append("\n");
      try (JarFile jf = new JarFile(jp)) {
        Enumeration<JarEntry> en = jf.entries();
        while (en.hasMoreElements()) {
          JarEntry e = en.nextElement();
          String n = e.getName();
          if (!n.endsWith(".class") || n.contains("$")) continue;
          String cn = n.substring(0, n.length() - 6).replace('/', '.');
          Class<?> c;
          try { c = Class.forName(cn, false, cl); } catch (Throwable t) { continue; }
          Class<?> c2;
          try { c2 = Class.forName(cn, true, cl); } catch (Throwable t) { continue; }
          List<String> f = staticFields(c2);
          if (f.isEmpty()) continue;
          sb.append(cn).append(" => ").append(f).append("\n");
          for (String m : new String[]{"instance", "getInstance"}) {
            List<String> inst = instanceFields(c2, m);
            if (!inst.isEmpty()) sb.append("  .").append(m).append("() => ").append(inst).append("\n");
          }
        }
      } catch (Throwable t) { sb.append("ERR ").append(jp).append(' ').append(t).append('\n'); }
    }
    try (PrintWriter pw = new PrintWriter(new FileWriter(out))) { pw.print(sb); }
  }
  static List<String> staticFields(Class<?> c) {
    List<String> r = new ArrayList<>();
    try {
      for (Field f : c.getDeclaredFields()) {
        int m = f.getModifiers();
        if (!Modifier.isStatic(m) || Modifier.isFinal(m) && !Modifier.isPublic(m)) continue;
        Class<?> t = f.getType();
        if (!Map.class.isAssignableFrom(t) && !Collection.class.isAssignableFrom(t) && !t.isArray()) continue;
        f.setAccessible(true);
        try {
          Object v = f.get(null);
          String d = desc(v);
          if (d == null) continue;
          r.add(f.getName() + ":" + t.getSimpleName() + "=" + d);
        } catch (Throwable ignored) {}
      }
    } catch (Throwable ignored) {}
    return r;
  }
  static List<String> instanceFields(Class<?> c, String m) {
    List<String> r = new ArrayList<>();
    try {
      Method mm = c.getMethod(m);
      Object inst = mm.invoke(null);
      if (inst == null) return r;
      for (Field f : inst.getClass().getFields()) r.add("pubfield " + f.getName() + ":" + f.getType().getSimpleName());
      for (Field f : inst.getClass().getDeclaredFields()) r.add("field " + f.getName() + ":" + f.getType().getSimpleName());
      for (Method x : inst.getClass().getMethods()) {
        if (x.getParameterCount() == 0 && !x.getName().startsWith("hash") && !x.getName().startsWith("equals") && !x.getName().startsWith("toString") && !x.getName().startsWith("getClass")) r.add("method " + x.getName() + "():" + x.getReturnType().getSimpleName());
      }
    } catch (Throwable ignored) {}
    return r;
  }
  static String desc(Object v) {
    if (v == null) return null;
    if (v instanceof Map) {
      Map<?,?> m = (Map<?,?>) v;
      String s = "Map(" + m.size() + ")";
      int i = 0;
      for (Map.Entry<?,?> e : m.entrySet()) { if (i++ >= 2) break; s += " [" + e.getKey() + " -> " + brief(e.getValue()) + "]"; }
      return s;
    }
    if (v instanceof Collection) {
      Collection<?> c = (Collection<?>) v;
      String s = "Collection(" + c.size() + ")";
      int i = 0;
      for (Object o : c) { if (i++ >= 2) break; s += " [" + brief(o) + "]"; }
      return s;
    }
    if (v.getClass().isArray()) {
      int n = java.lang.reflect.Array.getLength(v);
      String s = "Array(" + n + ")";
      for (int i = 0; i < Math.min(2, n); i++) s += " [" + brief(java.lang.reflect.Array.get(v, i)) + "]";
      return s;
    }
    return null;
  }
  static String brief(Object o) { return o == null ? "null" : o.getClass().getSimpleName(); }
}
