import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

public class Probe2 {
  static StringBuilder sb = new StringBuilder();
  static void dumpClass(Instrumentation inst, String name) {
    for (Class<?> c : inst.getAllLoadedClasses()) {
      if (!c.getName().equals(name)) continue;
      sb.append("== ").append(name).append('\n');
      for (Method m : c.getDeclaredMethods()) sb.append("  M ").append(m.getName()).append(" | ").append(Arrays.toString(m.getParameterTypes())).append(" -> ").append(m.getReturnType().getSimpleName()).append('\n');
      for (Field f : c.getDeclaredFields()) sb.append("  F ").append(f.getName()).append(" : ").append(f.getType().getSimpleName()).append('\n');
      return;
    }
    sb.append("== ").append(name).append(" NOT LOADED\n");
  }
  public static void agentmain(String args, Instrumentation inst) throws Exception {
    String[] names = {"net.minecraft.item.crafting.CraftingManager","net.minecraft.item.crafting.ShapedRecipes","net.minecraft.item.crafting.ShapelessRecipes","net.minecraft.item.crafting.FurnaceRecipes","net.minecraft.item.ItemStack","net.minecraft.item.Item"};
    for (String n : names) dumpClass(inst, n);
    try (PrintWriter w = new PrintWriter(new FileWriter(args))) { w.write(sb.toString()); }
  }
}
