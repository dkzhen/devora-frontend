"use client";

import { ArrowUpRight, CreditCard, Lock, ReceiptText, WalletCards } from "lucide-react";

export default function BillingPage() {
  return <div className="page-stack">
    <div className="page-heading"><div><div className="eyebrow small-eyebrow"><CreditCard size={14}/> MAIN / BILLING</div><h1>Billing</h1><p>Manage your plan and subscription.</p></div></div>

    <section className="console-section billing-plan"><div className="billing-plan-top"><div><span className="section-tag">CURRENT PLAN</span><h2>Standard</h2><p>Standard access to the Devora workspace and AI Gateway.</p></div><div className="plan-decoration"><WalletCards size={32}/></div></div><div className="plan-details"><div><small>MONTHLY PRICE</small><strong>$0.00 <span>/ month</span></strong></div><div><small>RENEWAL DATE</small><strong>— <span>no active subscription</span></strong></div><button className="button button-ink" type="button" disabled aria-disabled="true" title="Plan changes are locked"><Lock size={15}/> Change plan <ArrowUpRight size={16}/></button></div></section>

    <section className="console-section invoice-section"><div className="section-title-row"><div><span className="section-index">01</span><div><h2>Invoice history</h2><p>Your billing history will appear here.</p></div></div></div><div className="invoice-empty"><span className="invoice-empty-icon"><ReceiptText size={19}/></span><strong>No invoices yet</strong><p>Once a subscription is active, invoices will show up in this list.</p></div></section>
  </div>;
}
