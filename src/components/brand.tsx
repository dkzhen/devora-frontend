import Link from "next/link";
import { ArrowUpRight, Command } from "lucide-react";

export function Brand({ light = false }: { light?: boolean }) {
  return <Link href="/" aria-label="Devora home" className={`brand ${light ? "brand-light" : ""}`}><span className="brand-mark"><img src="/devora-icon-black-nobg.png" alt="Devora" width={17} height={17}/></span><span>Devora</span></Link>;
}

export function DemoNote({ children = "Prototype preview · sample data only" }: { children?: React.ReactNode }) {
  return <div className="demo-note"><span className="demo-dot" />{children}</div>;
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link className="button button-ink" href={href}>{children}<ArrowUpRight size={17} /></Link>;
}
