import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;

// 反射 gregtech.api.enums.ItemList 的静态字段，导出每个条目的 ItemStack(id/damage/name)。
// args = "<outFile>|<nameFilterRegex>"
public class DumpList2 {
    static PrintWriter out;

    public static void agentmain(String args, Instrumentation inst) {
        String[] a = args.split("\\|", 3);
        try {
            out = new PrintWriter(new FileWriter(a[0]));
            String filter = a.length > 1 ? a[1] : ".*";
            Class<?> il = null;
            for (Class<?> c : inst.getAllLoadedClasses()) {
                if (c.getName().equals("gregtech.api.enums.ItemList")) { il = c; break; }
            }
            if (il == null) il = Class.forName("gregtech.api.enums.ItemList", false, DumpList2.class.getClassLoader());
            out.println("# class " + il.getName());
            int n = 0;
            for (Field f : il.getDeclaredFields()) {
                if (!Modifier.isStatic(f.getModifiers())) continue;
                if (f.getType() != il) continue;
                f.setAccessible(true);
                Object entry = f.get(null);
                if (entry == null) continue;
                String nm = f.getName();
                if (filter.length() > 0 && !nm.matches(filter)) continue;
                out.println(nm + "\t" + stackOf(entry));
                n++;
            }
            out.println("# total " + n);
        } catch (Throwable t) {
            try { if (out != null) t.printStackTrace(out); } catch (Throwable ignored) {}
            try { PrintWriter e = new PrintWriter(new FileWriter(a[0] + ".err")); e.println(t.toString()); e.close(); } catch (Throwable ignored) {}
        } finally {
            if (out != null) out.close();
        }
    }

    static String stackOf(Object entry) {
        try {
            Object st = null;
            for (Method m : entry.getClass().getMethods()) {
                if (!m.getName().equals("get")) continue;
                Class<?>[] p = m.getParameterTypes();
                if (p.length != 1) continue;
                try {
                    if (p[0] == long.class) { st = m.invoke(entry, 1L); break; }
                    if (p[0] == int.class) { st = m.invoke(entry, 1); break; }
                } catch (Throwable ignored) {}
            }
            if (st == null) {
                for (Method m : entry.getClass().getMethods()) {
                    if (m.getName().equals("getItemStack") && m.getParameterCount() == 0) { st = m.invoke(entry); break; }
                }
            }
            if (st == null) return "null";
            return dumpStack(st);
        } catch (Throwable t) { return "ERR " + t; }
    }

    static String dumpStack(Object st) {
        try {
            Class<?> c = st.getClass();
            int damage = -1;
            try { damage = c.getField("field_77991_e").getInt(st); } catch (Throwable t) {}
            int id = -1;
            try {
                Class<?> itemCls = Class.forName("net.minecraft.item.Item", false, st.getClass().getClassLoader());
                Method m = itemCls.getMethod("func_150891_b", itemCls);
                Object it = c.getMethod("func_77973_b").invoke(st);
                id = (int) m.invoke(null, it);
            } catch (Throwable t) {}
            String name = "";
            try { name = String.valueOf(c.getMethod("getDisplayName").invoke(st)); } catch (Throwable t) {}
            return id + "\t" + damage + "\t" + name;
        } catch (Throwable t) { return "ERR2 " + t; }
    }
}
