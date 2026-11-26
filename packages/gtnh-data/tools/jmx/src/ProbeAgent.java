import java.lang.instrument.Instrumentation;
import java.io.*;
import java.util.*;
import java.lang.reflect.*;

public class ProbeAgent {
  public static void agentmain(String args, Instrumentation inst) throws Exception {
    StringBuilder sb = new StringBuilder();
    sb.append("loaded classes: ").append(inst.getAllLoadedClasses().length).append('\n');
    String[] needles = {"OreDictionary", "CraftingManager", "FurnaceRecipes", "IRecipe"};
    for (Class<?> c : inst.getAllLoadedClasses()) {
      String n = c.getName();
      for (String nd : needles) {
        if (n.contains(nd)) { sb.append("CLASS ").append(n).append(" loader=").append(c.getClassLoader()).append('\n'); break; }
      }
    }
    Class<?> od = null;
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals("net.minecraftforge.oredict.OreDictionary")) od = c;
    if (od != null) {
      for (Method m : od.getDeclaredMethods()) sb.append("OD ").append(m.getName()).append(" -> ").append(m.getReturnType().getSimpleName()).append(" | ").append(Arrays.toString(m.getParameterTypes())).append('\n');
      for (Field f : od.getDeclaredFields()) sb.append("ODF ").append(f.getName()).append(" : ").append(f.getType().getName()).append('\n');
    } else sb.append("NO OreDictionary\n");
    try (PrintWriter w = new PrintWriter(new FileWriter(args))) { w.write(sb.toString()); }
  }
}
