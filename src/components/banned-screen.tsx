"use client";

import { Ban, LogOut } from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import { Brand } from "@/components/brand";

export function BannedScreen() {
  const { signOut } = useAuth();

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "var(--paper, #faf9f6)", fontFamily: "var(--body)" }}>
      {/* Nav bar — same height/style as landing nav */}
      <nav style={{
        height: 76,
        maxWidth: 1240,
        margin: "0 auto",
        width: "100%",
        padding: "0 38px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid rgba(23,20,13,.11)",
      }}>
        <Brand />
      </nav>

      {/* Content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 20,
        padding: "40px 20px",
        textAlign: "center",
      }}>
        <div style={{
          width: 64,
          height: 64,
          display: "grid",
          placeItems: "center",
          borderRadius: "50%",
          background: "#fce0e0",
          border: "2px solid #b32320",
          color: "#b32320",
        }}>
          <Ban size={32} />
        </div>

        <h1 style={{
          fontFamily: "var(--display)",
          fontSize: "28px",
          fontWeight: 700,
          letterSpacing: "-0.5px",
          margin: 0,
          color: "var(--ink, #17140d)",
        }}>
          Account banned
        </h1>

        <p style={{
          fontSize: "15px",
          lineHeight: 1.6,
          color: "var(--muted, #827c71)",
          maxWidth: 420,
          margin: 0,
        }}>
          Your account has been banned by an administrator.
          You can still sign in, but all access to Devora services is restricted.
          If you believe this is a mistake, please contact support.
        </p>

        <button
          onClick={() => void signOut({ redirectUrl: "/" })}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 20px",
            fontFamily: "var(--body)",
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--paper, #faf9f6)",
            background: "var(--ink, #17140d)",
            border: "1.5px solid var(--ink, #17140d)",
            cursor: "pointer",
          }}
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}
