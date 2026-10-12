import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Blocks, Boxes, Code2, Fingerprint, Layers3, Zap } from "lucide-react";
import { Brand, DemoNote, PrimaryLink } from "@/components/brand";
import { LandingEvents, LandingPricing } from "@/components/landing-sections";
import { LandingSpotlight } from "@/components/landing-spotlight";

const features = [
  { icon: Code2, color: "mint", tag: "01 / ROUTE", title: "One endpoint.\nEvery model.", body: "Bring the models you already love together behind one clean, familiar API." },
  { icon: Layers3, color: "coral", tag: "02 / CONTROL", title: "Know where it goes.", body: "Keep usage, keys, and spend in one place. Clear enough to make the next call with confidence." },
  { icon: Blocks, color: "violet", tag: "03 / BUILD", title: "Less setup. More shipping.", body: "Skip the glue work and spend your time on what your product does best." },
];

function ProductPeek() {
  /* The console mockup, deliberately sparse.
     It used to carry a sidebar, a breadcrumb bar, a greeting, three stat tiles, a three-row
     table and a floating badge inside 600px — which put thirteen pieces of text below 8px.
     Text that small reads as grey noise, so the illustration looked muddy rather than sharp.
     The section's own headline asks for less scatter, so the mockup now keeps one of each
     thing: one stat that matters, two rows, and type no smaller than 9px. Fewer parts at a
     readable size look more finished than all the parts squeezed down. */
  const rows = [
    { dot: "mint-dot", name: "Claude 3.7 Sonnet", tag: "anthropic", n: "4,208" },
    { dot: "violet-dot", name: "GPT-4o", tag: "openai", n: "3,592" },
  ];
  return <div className="product-peek" aria-label="Illustration of the Devora console">
    <div className="peek-sidebar">
      <div className="peek-brand"><span>◈</span> devora</div>
      <div className="peek-menu active"><i className="peek-dot"/> AI Gateway</div>
      <div className="peek-menu"><i className="peek-dot"/> Billing</div>
      <div className="peek-menu"><i className="peek-dot"/> Credits</div>
      <div className="peek-sidebar-bottom">DS · Demo</div>
    </div>
    <div className="peek-main">
      <div className="peek-bar"><span>AI Gateway</span><span className="peek-status"><i/> Live</span></div>
      <div className="peek-welcome">
        <div><span className="peek-kicker">THIS MONTH</span><h3>Everything,<br/>in one view.</h3></div>
        <div className="peek-asterisk">✳</div>
      </div>
      {/* One stat, and the number is the largest thing in the panel — the eye should land
          somewhere definite instead of having to choose between three equal tiles. */}
      <div className="peek-hero-stat">
        <div><small>REQUESTS</small><strong>12,840</strong></div>
        <em>↑ 18% vs last week</em>
        <div className="peek-bars" aria-hidden>{[38, 62, 45, 80, 58, 92, 71].map((h, i) => <i key={i} style={{ height: `${h}%` }}/>)}</div>
      </div>
      <div className="peek-table">
        <div className="peek-table-title">Top models <span>View all ↗</span></div>
        {rows.map(r => <div key={r.name}>
          <b className={`model-dot ${r.dot}`}/>{r.name}<code>{r.tag}</code><strong>{r.n}</strong>
        </div>)}
      </div>
    </div>
    <div className="peek-float"><Zap size={15} fill="currentColor"/> One key. Many models.</div>
  </div>;
}

export default function Home() {
  return <main className="landing"><nav className="landing-nav"><Brand/><div className="landing-links"><Link href="#why">Why Devora</Link><Link href="#how">How it works</Link><Link href="/stats">Stats</Link></div><PrimaryLink href="/console/billing">Open console</PrimaryLink></nav>
    <section className="hero"><div className="hero-content"><div className="eyebrow"><span className="eyebrow-mark">✳</span> A calmer way to build with AI</div><h1>One platform.<br/><span>More ways</span> to build.</h1><p className="hero-copy">Your AI stack, billing, and workspace tools. All in one place, so your ideas can move a little faster.</p><div className="hero-actions"><PrimaryLink href="/auth?next=%2Fconsole%2Fbilling">Get started</PrimaryLink><Link className="text-link" href="#how">Take a look <ArrowDownRight size={16}/></Link></div><div className="hero-proof"><span className="proof-avatars"><i>R</i><i>M</i><i>A</i></span><span>Built for people who make things.</span><span className="proof-line"/></div></div>
      <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-star star-one">✳</div><div className="hero-star star-two">✦</div><div className="hero-cube"><div className="cube-face cube-top">✳</div><div className="cube-face cube-front">✦</div><div className="cube-face cube-side"/></div><div className="art-label art-label-top">ONE PLATFORM<br/>MORE WAYS</div><div className="art-label art-label-bottom">LESS CONTEXT<br/>SWITCHING</div><div className="hero-bubble">✳</div></div>
    </section>
    <section className="peek-section" id="how"><div className="section-intro"><div className="section-tag">MEET YOUR NEW WORKSPACE</div><h2>A little less scattered.<br/><span>A lot more focused.</span></h2><p>One thoughtful home for the tools and services behind your next big thing.</p></div><ProductPeek/></section>
    <section className="ticker" aria-label="Devora product values"><div className="ticker-track">{[0,1].map(x=><div className="ticker-run" key={x}><span>AI GATEWAY</span><i>✳</i><span>CREDITS THAT MAKE SENSE</span><i>✳</i><span>ONE CLEAR VIEW</span><i>✳</i><span>ROOM TO BUILD</span><i>✳</i></div>)}</div></section>
    <LandingSpotlight/>
    <LandingEvents/>
    <section className="features-section" id="why"><div className="features-heading"><div><div className="section-tag">MADE TO WORK TOGETHER</div><h2>The moving parts,<br/>moving <span>in sync.</span></h2></div><p>Good tools should get out of your way. Devora brings the essentials into one friendly workspace.</p></div><div className="feature-grid">{features.map(f=>{const Icon=f.icon;return <article key={f.tag} className={`feature-card feature-${f.color}`}><div className="feature-top"><div className="feature-icon"><Icon size={20}/></div><span>{f.tag}</span><ArrowUpRight size={18}/></div><h3>{f.title.split("\n").map((line,i)=><span key={i}>{line}{i===0&&f.title.includes("\n")?<br/>:null}</span>)}</h3><p>{f.body}</p><div className="feature-decoration">{f.color==="mint"?<Fingerprint size={38}/>:f.color==="coral"?<Zap size={40}/>:<Boxes size={40}/>}</div></article>})}</div></section>
    <LandingPricing/>
    <section className="cta-section"><div className="cta-spark">✳</div><div className="section-tag">YOUR NEXT THING STARTS HERE</div><h2>Make space<br/>for <span>the good work.</span></h2><p>See what your ideas can do with a little more room.</p><PrimaryLink href="/auth?next=%2Fconsole%2Fbilling">Step inside</PrimaryLink><span className="cta-star">✦</span></section>
    <footer className="landing-footer"><Brand/><p>One platform. More ways to build.</p><span className="landing-footer-copy">© 2026 Devora</span></footer>
  </main>;
}
