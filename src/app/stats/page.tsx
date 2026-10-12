import { StatsPage } from "@/components/stats-page";

export const metadata = {
  title: "Stats — Devora",
  description: "What the Devora gateway has served: requests, tokens, models and providers.",
};

/**
 * Public: no auth wrapper, and deliberately so.
 *
 * These are throughput and catalogue figures — nothing here identifies an account. A
 * visitor deciding whether to build on the service should be able to see it is running
 * without creating an account first.
 */
export default function Page() {
  return <StatsPage />;
}
