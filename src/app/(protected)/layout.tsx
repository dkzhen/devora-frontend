import { ConsoleShell } from "@/components/console-shell";
import { Protected } from "@/components/protected";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <Protected><ConsoleShell>{children}</ConsoleShell></Protected>;
}
