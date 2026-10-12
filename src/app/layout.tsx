import type { Metadata } from "next";
import { AppClerkProvider } from "@/components/clerk-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Devora — one platform, more ways to build",
  description: "One workspace for AI infrastructure, credits, billing, and the tools that help you build.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><head><link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" /><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700;12..96,800&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" /></head><body><AppClerkProvider>{children}</AppClerkProvider></body></html>;
}
