import java.lang.instrument.Instrumentation;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

/** GTNH 服务端数据导出 agent：矿辞 + 原版合成配方 + 熔炉配方。
 *  运行时 MC 类是 SRG 名（func_/field_），Forge 类是明文名，全部走反射。 */
public class DumpAgent {
  static ClassLoader cl;
  static Class<?> clsStack, clsItem, clsOreDict, clsCrafting, clsFurnace, clsShaped, clsShapeless;
  static Method mGetOreNames, mGetOres, mGetRecipeList, mGetRecipeOutput, mGetSmelting, mGetSmeltList;
  static Method mGetItem, mGetIdFromItem, mGetUnlocalized;
  static Field fStackSize, fDamage, fWidth, fHeight, fShapedItems, fShapelessItems, fRegistry;
  static Method mRegistryName;
  static StringBuilder out = new StringBuilder();
  static int oreCount, craftCount, smeltCount;

  static Class<?> find(Instrumentation inst, String name) {
    for (Class<?> c : inst.getAllLoadedClasses()) if (c.getName().equals(name)) return c;
    return null;
  }

  static void resolve(Instrumentation inst) throws Exception {
    String[] need = {"net.minecraft.item.ItemStack","net.minecraft.item.Item","net.minecraftforge.oredict.OreDictionary",
      "net.minecraft.item.crafting.CraftingManager","net.minecraft.item.crafting.FurnaceRecipes",
      "net.minecraft.item.crafting.ShapedRecipes","net.minecraft.item.crafting.ShapelessRecipes"};
    Class<?>[] got = new Class<?>[need.length];
    for (int i = 0; i < need.length; i++) got[i] = find(inst, need[i]);
    clsStack = got[0]; clsItem = got[1]; clsOreDict = got[2]; clsCrafting = got[3];
    clsFurnace = got[4]; clsShaped = got[5]; clsShapeless = got[6];
    cl = clsOreDict.getClassLoader();
    mGetOreNames = clsOreDict.getMethod("getOreNames");
    mGetOres = clsOreDict.getMethod("getOres", String.class);
    mGetRecipeList = clsCrafting.getDeclaredMethod("func_77592_b");
    mGetRecipeOutput = clsShaped.getDeclaredMethod("func_77571_b");
    mGetSmelting = clsFurnace.getDeclaredMethod("func_77602_a");
    Object inst2 = mGetSmelting.invoke(null);
    mGetSmeltList = inst2.getClass().getDeclaredMethod("func_77599_b");
    mGetItem = clsStack.getDeclaredMethod("func_77973_b");
    mGetIdFromItem = clsItem.getDeclaredMethod("func_150891_b", clsItem);
    fStackSize = clsStack.getDeclaredField("field_77994_a");
    fDamage = clsStack.getDeclaredField("field_77991_e");
    fWidth = clsShaped.getDeclaredField("field_77576_b");
    fHeight = clsShaped.getDeclaredField("field_77577_c");
    fShapedItems = clsShaped.getDeclaredField("field_77574_d");
    fShapelessItems = clsShapeless.getDeclaredField("field_77579_b");
    for (Method m : clsStack.getDeclaredMethods()) if (m.getName().equals("func_77973_b")) mGetItem = m;
    try { mGetUnlocalized = clsItem.getMethod("getUnlocalizedName"); } catch (Throwable t) { mGetUnlocalized = null; }
    try {
      for (Field f : clsItem.getDeclaredFields()) if (f.getType().getName().endsWith("RegistryNamespaced")) { fRegistry = f; break; }
      if (fRegistry != null) {
        fRegistry.setAccessible(true);
        Object reg = fRegistry.get(null);
        for (Method m : reg.getClass().getMethods()) {
          String n = m.getName();
          if ((n.equals("getNameForObject") || n.equals("func_148750_c")) && m.getParameterTypes().length == 1) { mRegistryName = m; break; }
        }
      }
    } catch (Throwable t) { mRegistryName = null; }
  }

  static String itemName(Object item) {
    if (item == null) return null;
    try { if (mRegistryName != null) return (String) mRegistryName.invoke(fRegistry.get(null), item); } catch (Throwable t) {}
    try { if (mGetUnlocalized != null) return (String) mGetUnlocalized.invoke(item); } catch (Throwable t) {}
    return null;
  }

  static String esc(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c < 32) b.append(String.format("\\u%04x", (int) c));
      else b.append(c);
    }
    return b.append('"').toString();
  }

  /** ItemStack -> {"id":n,"name":"mod:id","meta":n,"count":n}，空栈返回 null */
  static String stack(Object st) {
    if (st == null) return "null";
    try {
      Object item = mGetItem.invoke(st);
      if (item == null) return "null";
      int id = (Integer) mGetIdFromItem.invoke(null, item);
      int meta = fDamage.getInt(st);
      int count = fStackSize.getInt(st);
      String name = itemName(item);
      return "{\"id\":" + id + ",\"name\":" + esc(name) + ",\"meta\":" + meta + ",\"count\":" + count + "}";
    } catch (Throwable t) { return "null"; }
  }

  static String stackArray(Object arr) {
    StringBuilder b = new StringBuilder("[");
    int n = Array.getLength(arr);
    for (int i = 0; i < n; i++) { if (i > 0) b.append(','); b.append(stack(Array.get(arr, i))); }
    return b.append(']').toString();
  }

  static String stackList(List<?> list) {
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < list.size(); i++) { if (i > 0) b.append(','); b.append(stack(list.get(i))); }
    return b.append(']').toString();
  }

  static void dumpOredict() throws Exception {
    String[] names = (String[]) mGetOreNames.invoke(null);
    Arrays.sort(names);
    for (String name : names) {
      if (name == null || name.isEmpty()) continue;
      String items;
      try { items = stackList((List<?>) mGetOres.invoke(null, name)); } catch (Throwable t) { continue; }
      out.append("{\"name\":").append(esc(name)).append(",\"items\":").append(items).append("}\n");
      oreCount++;
    }
  }

  static void dumpCrafting() throws Exception {
    List<?> recipes = (List<?>) mGetRecipeList.invoke(clsCrafting.getDeclaredMethod("func_77594_a").invoke(null));
    for (Object r : recipes) {
      try {
        String outStack = stack(mGetRecipeOutput.invoke(r));
        String inputs;
        String shape;
        if (clsShaped.isInstance(r)) {
          shape = "{\"shaped\":true,\"w\":" + fWidth.getInt(r) + ",\"h\":" + fHeight.getInt(r) + ",";
          inputs = stackArray(fShapedItems.get(r));
        } else if (clsShapeless.isInstance(r)) {
          shape = "{\"shaped\":false,";
          inputs = stackList((List<?>) fShapelessItems.get(r));
        } else {
          continue; // 其它 IRecipe（GT 自定义/模组）暂不导出
        }
        out.append(shape).append("\"in\":").append(inputs).append(",\"out\":").append(outStack)
           .append(",\"cls\":").append(esc(r.getClass().getName())).append("}\n");
        craftCount++;
      } catch (Throwable t) {}
    }
  }

  static void dumpSmelting() throws Exception {
    Object inst2 = mGetSmelting.invoke(null);
    Map<?, ?> map = (Map<?, ?>) mGetSmeltList.invoke(inst2);
    for (Map.Entry<?, ?> e : map.entrySet()) {
      out.append("{\"in\":").append(stack(e.getKey())).append(",\"out\":").append(stack(e.getValue())).append("}\n");
      smeltCount++;
    }
  }

  public static void agentmain(String args, Instrumentation inst) throws Exception {
    String dir = args;
    try {
      resolve(inst);
      dumpOredict();
      dumpCrafting();
      dumpSmelting();
    } catch (Throwable t) {
      StringWriter sw = new StringWriter(); t.printStackTrace(new PrintWriter(sw));
      out.insert(0, "{\"error\":").append(esc(sw.toString())).append("}\n");
    }
    File f = new File(dir, "gtnh-dump.jsonl");
    try (Writer w = new OutputStreamWriter(new FileOutputStream(f), "UTF-8")) { w.write(out.toString()); }
    try (Writer w = new OutputStreamWriter(new FileOutputStream(new File(dir, "gtnh-dump-meta.json")), "UTF-8")) {
      w.write("{\"oredict\":" + oreCount + ",\"crafting\":" + craftCount + ",\"smelting\":" + smeltCount + "}\n");
    }
  }
}
