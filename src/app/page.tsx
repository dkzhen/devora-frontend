import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { GatewayStats } from "@/components/gateway-stats";
import { FeatureCards, productCards } from "@/components/feature-cards";
import { FeaturedEvents } from "@/components/featured-events";
import { HowItWorks } from "@/components/how-it-works";
import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { FeaturedModels } from "@/components/featured-models";

export default function Home() {
  return <main className="landing"><nav className="landing-nav"><Brand/><div className="landing-links"><Link href="#how">How it works</Link><Link href="/models">Models</Link><Link href="/stats">Stats</Link><Link href="/pricing">Pricing</Link></div><PrimaryLink href="/console/billing">Open console</PrimaryLink></nav>
    <section className="hero"><div className="hero-content"><div className="eyebrow"><span className="eyebrow-mark">✳</span> A calmer way to build with AI</div><h1>One platform.<br/><span>More ways</span> to build.</h1><p className="hero-copy">Your AI stack, billing, and workspace tools. All in one place, so your ideas can move a little faster.</p><div className="hero-actions"><PrimaryLink href="/auth?next=%2Fconsole%2Fbilling">Get started</PrimaryLink><Link className="text-link" href="/models">Discover Models <ArrowUpRight size={16}/></Link></div><div className="hero-proof"><span className="proof-avatars"><i>R</i><i>M</i><i>A</i></span><span>Built for people who make things.</span><span className="proof-line"/></div></div>
      <div className="hero-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-star star-one">✳</div><div className="hero-star star-two">✦</div><div className="hero-cube"><div className="cube-face cube-top">✳</div><div className="cube-face cube-front">✦</div><div className="cube-face cube-side"/></div><div className="art-label art-label-top">ONE PLATFORM<br/>MORE WAYS</div><div className="art-label art-label-bottom">LESS CONTEXT<br/>SWITCHING</div><div className="hero-bubble">✳</div></div>
    </section>
        <GatewayStats/>
    <FeatureCards
      id="why"
      tag="MADE TO WORK TOGETHER"
      heading="The moving parts,"
      headAccent="in sync."
      cards={productCards}
    />
    <FeaturedModels/>
    <FeaturedEvents/>
    <HowItWorks/>
    <LandingFaq/>
    <LandingFooter/>
  </main>;
}
