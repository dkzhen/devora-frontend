import { LandingNav } from "@/components/landing-nav";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Brand, PrimaryLink } from "@/components/brand";
import { GatewayStats } from "@/components/gateway-stats";
import { FeatureCards, productCards } from "@/components/feature-cards";
import { FeaturedEvents } from "@/components/featured-events";
import { HowItWorks } from "@/components/how-it-works";
import { LandingPricing } from "@/components/landing-pricing";
import { LandingFaq } from "@/components/landing-faq";
import { LandingFooter } from "@/components/landing-footer";
import { FeaturedModels } from "@/components/featured-models";
import { ModelSpotlights } from "@/components/model-spotlights";

export default function Home() {
  return <main className="landing"><LandingNav/>
    <section className="hero"><div className="hero-content"><div className="eyebrow"><span className="eyebrow-mark"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3L13.4302 8.31181C13.6047 8.96 13.692 9.28409 13.8642 9.54905C14.0166 9.78349 14.2165 9.98336 14.451 10.1358C14.7159 10.308 15.04 10.3953 15.6882 10.5698L21 12L15.6882 13.4302C15.04 13.6047 14.7159 13.692 14.451 13.8642C14.2165 14.0166 14.0166 14.2165 13.8642 14.451C13.692 14.7159 13.6047 15.04 13.4302 15.6882L12 21L10.5698 15.6882C10.3953 15.04 10.308 14.7159 10.1358 14.451C9.98336 14.2165 9.78349 14.0166 9.54905 13.8642C9.28409 13.692 8.96 13.6047 8.31181 13.4302L3 12L8.31181 10.5698C8.96 10.3953 9.28409 10.308 9.54905 10.1358C9.78349 9.98336 9.98336 9.78349 10.1358 9.54905C10.308 9.28409 10.3953 8.96 10.5698 8.31181L12 3Z"/></svg></span> A calmer way to build with AI</div><h1>One platform.<br/><span>More ways</span> to build.</h1><p className="hero-copy">Your AI stack, billing, and workspace tools. All in one place, so your ideas can move a little faster.</p><div className="hero-actions"><PrimaryLink href="/auth?next=%2Fconsole%2Fbilling">Get started</PrimaryLink><Link className="text-link" href="/models">Discover Models <ArrowUpRight size={16}/></Link></div><div className="hero-proof"><span className="proof-avatars"><i>R</i><i>M</i><i>A</i></span><span>Built for people who make things.</span><span className="proof-line"/></div></div>
      <div className="hero-art"><div className="hero-orbit-system">
        <div className="orbit-ring orbit-ring-outer"/>
        <div className="orbit-ring orbit-ring-inner"/>
        <div className="orbit-center-node">
          <img src="/devora-icon-red-nobg.png" alt="Devora" width="36" height="36"/>
        </div>
        <div className="orbit-track orbit-track-outer">
          <div className="node-pos" style={{transform:"rotate(0deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(0deg)"}}><div className="provider-node"><img src="/providers/openai.svg" alt="OpenAI" width="22" height="22" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(60deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(-60deg)"}}><div className="provider-node"><img src="/providers/anthropic.svg" alt="Anthropic" width="22" height="22" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(120deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(-120deg)"}}><div className="provider-node"><img src="/providers/deepseek.svg" alt="DeepSeek" width="22" height="22" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(180deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(-180deg)"}}><div className="provider-node"><img src="/providers/gemini.svg" alt="Gemini" width="22" height="22" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(240deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(-240deg)"}}><div className="provider-node"><img src="/providers/nvidia.svg" alt="NVIDIA" width="22" height="22" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(300deg) translate(36cqw)"}}><div className="node-counter" style={{transform:"rotate(-300deg)"}}><div className="provider-node"><img src="/providers/mistral.svg" alt="Mistral" width="22" height="22" loading="lazy"/></div></div></div>
        </div>
        <div className="orbit-track orbit-track-inner">
          <div className="node-pos" style={{transform:"rotate(30deg) translate(26cqw)"}}><div className="node-counter" style={{transform:"rotate(-30deg)"}}><div className="provider-node provider-node-sm"><img src="/providers/grok.svg" alt="Grok" width="18" height="18" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(150deg) translate(26cqw)"}}><div className="node-counter" style={{transform:"rotate(-150deg)"}}><div className="provider-node provider-node-sm"><img src="/providers/zai.svg" alt="Z.AI" width="18" height="18" loading="lazy"/></div></div></div>
          <div className="node-pos" style={{transform:"rotate(270deg) translate(26cqw)"}}><div className="node-counter" style={{transform:"rotate(-270deg)"}}><div className="provider-node provider-node-sm"><img src="/providers/stepfun.svg" alt="StepFun" width="18" height="18" loading="lazy"/></div></div></div>
        </div>
      </div></div>
    </section>
        <GatewayStats/>
    <ModelSpotlights/>
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
    <LandingPricing/>
    <LandingFaq/>
    <LandingFooter/>
  </main>;
}
