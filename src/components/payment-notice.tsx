"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

type Notice = { id: string; label: string; message: string };
const PIXELS_PER_SECOND = 48;

function ScrollingNotice({ notice, onComplete }: { notice: Notice; onComplete: () => void }) {
  const viewport = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLSpanElement>(null);
  const completed = useRef(false);

  useLayoutEffect(() => {
    const frame = viewport.current;
    const text = track.current;
    if (!frame || !text) return;
    let disposed = false;
    let previousWidth = "";
    const measure = () => {
      if (disposed) return;
      const frameWidth = frame.getBoundingClientRect().width;
      const textWidth = text.getBoundingClientRect().width;
      const signature = `${frameWidth}:${textWidth}`;
      if (!frameWidth || !textWidth || signature === previousWidth) return;
      previousWidth = signature;
      // Restart this same notice when layout/fonts change, never skip unread copy.
      text.style.animationName = "none";
      text.style.setProperty("--notice-start", `${frameWidth}px`);
      text.style.setProperty("--notice-duration", `${(frameWidth + textWidth) / PIXELS_PER_SECOND}s`);
      void text.offsetWidth;
      text.style.animationName = "payment-notice-scroll";
    };
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    observer.observe(text);
    measure();
    void document.fonts.ready.then(measure);
    return () => { disposed = true; observer.disconnect(); };
  }, []);

  return <aside className="payment-notice" role="status" aria-live="polite" aria-atomic="true" tabIndex={0}>
    <span className="payment-notice-label" aria-hidden="true"><span className="payment-notice-dot"/>{notice.label}</span>
    <span className="payment-notice-divider" aria-hidden="true"/>
    <span ref={viewport} className="payment-notice-viewport" aria-hidden="true">
      <span ref={track} className="payment-notice-track" onAnimationEnd={event => {
        if (event.target !== event.currentTarget || event.animationName !== "payment-notice-scroll" || completed.current) return;
        completed.current = true;
        onComplete();
      }}><span className="payment-notice-copy">{notice.message}</span></span>
    </span>
    <span className="sr-only">{notice.label}: {notice.message}</span>
  </aside>;
}

function NoticeSequence({ notices }: { notices: Notice[] }) {
  const [cycle, setCycle] = useState(0);
  return <ScrollingNotice key={cycle} notice={notices[cycle % notices.length]} onComplete={() => setCycle(value => value + 1)}/>;
}

export function PaymentNotice() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/backend/api/v1/announcements", { cache: "no-store", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Announcements unavailable");
        const data = await response.json() as { announcements?: Notice[] };
        if (!controller.signal.aborted && Array.isArray(data.announcements)) setNotices(data.announcements.filter(row => row && typeof row.id === "string" && typeof row.label === "string" && typeof row.message === "string" && row.message.trim().length > 0));
      }).catch(() => { if (!controller.signal.aborted) setNotices([]); });
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update(); media.addEventListener("change", update);
    return () => { controller.abort(); media.removeEventListener("change", update); };
  }, []);

  if (!notices.length) return null;
  if (reducedMotion) return <aside className="payment-notice payment-notice-static" aria-label="Announcements">
    {notices.map(notice => <div className="payment-notice-row" key={notice.id}>
      <span className="payment-notice-label"><span className="payment-notice-dot" aria-hidden="true"/>{notice.label}</span>
      <span className="payment-notice-divider" aria-hidden="true"/>
      <span className="payment-notice-copy">{notice.message}</span>
    </div>)}
  </aside>;
  // Replacing API data unmounts the old animation and its observer/event handler.
  return <NoticeSequence key={JSON.stringify(notices)} notices={notices}/>;
}
