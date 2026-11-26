import com.sun.tools.attach.VirtualMachine;
public class AgentMain {
  public static void main(String[] a) throws Exception {
    VirtualMachine vm = VirtualMachine.attach(a[0]);
    try { vm.loadAgent(a[1], a[2]); } finally { vm.detach(); }
    System.out.println("attached to " + a[0]);
  }
}
