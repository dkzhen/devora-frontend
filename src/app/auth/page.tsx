"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, LockKeyhole, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth, useSignIn, useSignUp } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
import { AuthSetupRequired } from "@/components/auth-setup-required";
import { CLERK_ENABLED } from "@/lib/clerk-config";

function safeNextPath(value: string) {
  try {
    const destination = new URL(value, window.location.origin);
    if (destination.origin !== window.location.origin) return "/console/billing";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/console/billing";
  }
}

function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next") || "/console/billing");
  const [mode, setMode] = useState<"register" | "signin">("register");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [verification, setVerification] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { getToken } = useAuth();

  const syncBackendAndNavigate = async () => {
    const token = await getToken();
    if (!token) {
      setError("We could not create a session. Please try again.");
      return;
    }

    try {
      const response = await fetch("/backend/api/v1/users/me", {
        method: "GET",
        headers: { "Authorization": `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `Backend returned ${response.status}.`);
      }
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Unknown backend error.";
      setError(`Your account is signed in, but setup could not be completed: ${detail}`);
      return;
    }

    router.replace(next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (mode === "register" && !firstName.trim()) {
      setError("Enter your first name.");
      return;
    }
    if (mode === "register" && !lastName.trim()) {
      setError("Enter your last name.");
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (!CLERK_ENABLED) {
      setError("Sign-in is not configured yet. Add the required publishable key, then restart the app.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "register") {
        if (!signUp) throw new Error("Sign-up is still loading. Please try again in a moment.");
        const { error: signupError } = await signUp.create({
          emailAddress: email,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        });
        if (signupError) throw signupError;
        const { error: verificationError } = await signUp.verifications.sendEmailCode();
        if (verificationError) throw verificationError;
        setVerification(true);
        return;
      }

      if (!signIn) throw new Error("Sign-in is still loading. Please try again in a moment.");
      const { error: signinError } = await signIn.password({ emailAddress: email, password });
      if (signinError) throw signinError;
      if (signIn.status === "complete") {
        const { error: finalizeError } = await signIn.finalize({ navigate: () => {} });
        if (finalizeError) throw finalizeError;
        await syncBackendAndNavigate();
      } else if (signIn.status === "needs_second_factor" || signIn.status === "needs_client_trust") {
        setError("This account requires an additional verification step. Please try again or use a different account.");
      } else {
        setError("We could not complete sign-in. Check your details and try again.");
      }
    } catch (cause) {
      const clerkError = cause as { errors?: Array<{ longMessage?: string; message?: string }> };
      const message = clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || (cause instanceof Error ? cause.message : "Authentication failed. Please try again.");
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const verifyEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    if (!code.trim()) {
      setError("Enter the verification code sent to your email.");
      return;
    }
    setBusy(true);
    try {
      if (!signUp) throw new Error("Sign-up is still loading. Please try again in a moment.");
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({ code: code.trim() });
      if (verifyError) throw verifyError;
      if (signUp.status !== "complete") throw new Error("Email verification is not complete. Check the code and try again.");
      const { error: finalizeError } = await signUp.finalize({ navigate: () => {} });
      if (finalizeError) throw finalizeError;
      await syncBackendAndNavigate();
    } catch (cause) {
      const clerkError = cause as { errors?: Array<{ longMessage?: string; message?: string }> };
      const message = clerkError.errors?.[0]?.longMessage || clerkError.errors?.[0]?.message || (cause instanceof Error ? cause.message : "Email verification failed. Please try again.");
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return <main className="auth-page"><div className="auth-brandbar"><Brand/><Link href="/" className="back-link"><ArrowLeft size={15}/> Back to Devora</Link></div><div className="auth-layout"><section className="auth-panel"><div className="auth-heading"><div className="auth-icon"><LockKeyhole size={19}/></div><h1>{verification ? "Check your inbox." : mode === "register" ? "Make yourself at home." : "Welcome back."}</h1><p>{verification ? `Enter the verification code we sent to ${email}.` : mode === "register" ? "Create your Devora account with email and password." : "Sign in with your email and password to continue."}</p></div>{!verification && <div className="auth-tabs" role="tablist" aria-label="Authentication mode"><button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "selected" : ""} onClick={() => { setMode("register"); setError(""); }}>Create account</button><button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "selected" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button></div>}{verification ? <form className="auth-form" onSubmit={verifyEmail} noValidate><label htmlFor="verification-code">Email verification code</label><div className="input-shell"><Mail size={16}/><input id="verification-code" type="text" inputMode="numeric" autoComplete="one-time-code" placeholder="Enter your code" value={code} onChange={e => setCode(e.target.value)} required/></div>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={busy} className="button button-ink auth-submit">{busy ? <><Loader2 size={15} className="row-spinner"/> Verifying…</> : <>Verify email<ArrowRight size={17}/></>}</button><button type="button" className="auth-back-button" onClick={() => { setVerification(false); setError(""); }}>Use a different email</button></form> : <form className="auth-form" onSubmit={submit} noValidate>{mode === "register" && <><label htmlFor="first-name">First name</label><div className="input-shell"><input id="first-name" type="text" autoComplete="given-name" placeholder="Ada" value={firstName} onChange={e => setFirstName(e.target.value)} required/></div><label htmlFor="last-name">Last name</label><div className="input-shell"><input id="last-name" type="text" autoComplete="family-name" placeholder="Lovelace" value={lastName} onChange={e => setLastName(e.target.value)} required/></div></>}<label htmlFor="email">Email address</label><div className="input-shell"><Mail size={16}/><input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required/></div><label htmlFor="password">Password</label><div className="input-shell"><LockKeyhole size={16}/><input id="password" type={show ? "text" : "password"} autoComplete={mode === "register" ? "new-password" : "current-password"} placeholder="At least 8 characters" value={password} onChange={e => setPassword(e.target.value)} required minLength={8}/><button className="password-toggle" type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>{error && <p className="form-error" role="alert">{error}</p>}<button type="submit" disabled={busy || (mode === "signin" ? !signIn : !signUp)} className="button button-ink auth-submit">{busy ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}<ArrowRight size={17}/></button></form>}<p className="auth-terms">Powered by Clerk.</p></section><aside className="auth-aside"><div className="aside-pattern">✳</div><div className="aside-overline">A HOME FOR WHAT YOU’RE BUILDING</div><h2>Bring your<br/>moving parts<br/><span>together.</span></h2><p>Explore the workspace for your AI stack, credits, and more. Everything you see is demo-only.</p><div className="aside-bottom"><div className="aside-rule"/><span>DEVORA / PREVIEW 01</span></div></aside></div></main>;
}

export default function AuthPage() {
  if (!CLERK_ENABLED) return <AuthSetupRequired/>;
  return <Suspense fallback={<div className="route-loading">Loading sign in…</div>}><AuthForm/></Suspense>;
}
