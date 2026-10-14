"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2 } from "lucide-react";
import { Modal } from "@/components/modal";

/**
 * What the customer sees when a package cannot be redeemed because they already hold it live.
 *
 * The backend answers `409 already_subscribed` for that, and it is correct — but it is not the
 * whole story, and the difference matters. There are two distinct reasons to land here and the
 * customer's next move is different for each:
 *
 *   * The package is still serving them. Nothing is wrong; redeeming a second one would just
 *     stack two allowances for one product.
 *   * The package is spent. They are not trying to stack anything — they want more tokens, and
 *     the message "you already have an active subscription" answers a question they did not ask.
 *
 * The dialog resolves the live package's real state from `/users/me` rather than guessing from
 * the code, so the second case can be told apart and given the route that actually works.
 */

type Live = { packageId: string; name: string; category: string; exhausted: boolean; expiresAt: string | null };

export function AlreadySubscribedDialog({
  open, onClose, packageId, message, getToken,
}: {
  open: boolean;
  onClose: () => void;
  /** The package the code was for, when the server names it. */
  packageId: string | null;
  message: string;
  getToken: () => Promise<string | null>;
}) {
  const [live, setLive] = useState<Live | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Fetched when the dialog opens: the answer changes — a package can lapse or be removed while
  // this dialog sits closed — so a cached "still serving" would be worse than a moment's wait.
  useEffect(() => {
    if (!open) { setLoaded(false); setLive(null); return; }
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/backend/api/v1/users/me", {
          headers: { Authorization: `Bearer ${token ?? ""}` }, cache: "no-store",
        });
        const data = res.ok ? await res.json() as { subscriptions?: Live[] } : null;
        if (!alive) return;
        setLive((data?.subscriptions ?? []).find(s => packageId === null || s.packageId === packageId) ?? null);
      } catch { if (alive) setLive(null); }
      finally { if (alive) { setLoading(false); setLoaded(true); } }
    })();
    return () => { alive = false; };
  }, [open, packageId, getToken]);

  const spent = live?.exhausted === true;
  const days = live?.expiresAt ? Math.ceil((new Date(live.expiresAt).getTime() - Date.now()) / 86_400_000) : null;

  return <Modal
    open={open}
    title={spent ? "This package has no allowance left" : "You already have this package"}
    subtitle={<>{live?.name ?? packageId ?? "Active package"}</>}
    tone={spent ? "danger" : "default"}
    onClose={onClose}
    footer={<>
      <button className="button button-outline compact-button" type="button" onClick={onClose}>Close</button>
      <Link className="button button-ink compact-button" href="/console/billing" onClick={onClose}>
        Open billing <ArrowUpRight size={14}/>
      </Link>
    </>}
  >
    {loading && <p className="confirm-lead"><Loader2 size={14} className="spin"/> Checking your package…</p>}

    {!loading && spent && <>
      <p className="confirm-lead"><AlertTriangle size={14}/> The code is valid. The package is the problem — its tokens are used up, and the window is still open.</p>
      <ul className="confirm-list">
        <li><strong>Nothing is wrong with the code.</strong> Keep it. It works the moment this package leaves your account.</li>
        <li><strong>Why it cannot stack.</strong> One account holds one live package of each kind at a time, so a second one would mean two allowances for one product.</li>
        <li><strong>To get more tokens now</strong> — open billing and use <strong>Top up allowance</strong>. The ceiling doubles and your usage count is kept.</li>
        <li><strong>To use the code right away</strong> — open billing and <strong>remove</strong> the package first. Read the warning there: your plan and any leftover allowance go with it, and re-buying does not reset the tokens you have already used.</li>
        <li><strong>Or wait it out.</strong> It lapses on its own{days !== null && <> in <strong>{days} day{days === 1 ? "" : "s"}</strong></>}, and the code will go through then.</li>
      </ul>
      <p className="confirm-note">Removing a package is not a formality — we ask you to confirm it twice for a reason.</p>
    </>}

    {!loading && !spent && <>
      <p className="confirm-lead">{message}</p>
      <ul className="confirm-list">
        <li><strong>It is still serving you.</strong> Requests to its covered models use its free allowance before touching your credits.</li>
        <li><strong>A code cannot stack on it.</strong> Redeem it after this package lapses or is removed{days !== null && <> — with {days} day{days === 1 ? "" : "s"} left on the current window</>}.</li>
        <li><strong>You are not blocked.</strong> Credits work in the meantime, and billing shows what is left of the allowance.</li>
      </ul>
      <p className="confirm-note">Codes are not consumed while a package is live — the one you entered is untouched.</p>
    </>}

    {!loading && loaded && live === null && <>
      <p className="confirm-lead">{message}</p>
      <p className="confirm-note">Open billing to see what is active on your account.</p>
    </>}
  </Modal>;
}
