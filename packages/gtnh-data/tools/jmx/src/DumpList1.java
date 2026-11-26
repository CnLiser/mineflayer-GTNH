import java.lang.instrument.Instrumentation;
import java.lang.reflect.*;
import java.io.*;
import java.util.*;

// 反射 gregtech.api.enums.ItemList 的静态字段，把每个 ItemList 的 ItemStack(id/damage/name) 导出。
// args = "<outFile>|<nameFilterRegex>"
public class DumpList1 {
    static PrintWriter out;
    public static void agentmain(String args, Instrumentation inst) {
        String[] a = args.split("\\|", 3);
        try {
            out = new PrintWriter(new FileWriter(a[0]));
            String filter = a.length > 1 ? a[1] : "Extruder";
            Class<?> il = null;
            for (Class<?> c : inst.getAllLoadedClasses()) {
                if (c.getName().equals("gregtech.api.enums.ItemList")) { il = c; break; }
            }
            if (il == null) il = Class.forName("gregtech.api.enums.ItemList", false, ItemStack0.loader());
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
                String stack = stackOf(entry);
                out.println(nm + "\t" + stack);
                n++;
            }
            out.println("# total " + n);
        } catch (Throwable t) {
            try { if (out != null) { t.printStackTrace(out); } } catch (Throwable ignored) {}
            try { new PrintWriter(new FileWriter(a[0] + ".err")).println(t.toString()); } catch (Throwable ignored) {}
        } finally {
            if (out != null) out.close();
        }
    }
    static String stackOf(Object entry) {
        try {
            Method m = entry.getClass().getMethod("get", int.class);
            Object st = m.invoke(entry, 1);
            if (st == null) return "null";
            return dumpStack(st);
        } catch (Throwable t) { return "ERR " + t; }
    }
    static String dumpStack(Object st) {
        try {
            Class<?> c = st.getClass();
            Method getId = null;
            for (Method m : c.getMethods()) if (m.getParameterTypes().length == 0 && m.getReturnType() == int.class && m.getName().contains("getId")) { getId = m; break; }
            int damage = -1;
            try { damage = c.getField("field_77991_e").getInt(st); } catch (Throwable t) { for (Method m : c.getMethods()) if (m.getParameterCount()==0 && m.getReturnType()==int.class && m.getName().contains("Damage")) damage = (int) m.invoke(st); }
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
    static class ItemStack0 {
        static ClassLoader loader() { return DumpList1.class.getClassLoader(); }
    }
}
