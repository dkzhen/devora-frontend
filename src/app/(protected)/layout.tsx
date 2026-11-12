import type { Metadata } from "next";
import { ConsoleShell } from "@/components/console-shell";
import { Protected } from "@/components/protected";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return <Protected><ConsoleShell>{children}</ConsoleShell></Protected>;
}
