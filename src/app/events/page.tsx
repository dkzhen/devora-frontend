import { EventsPage } from "@/components/events-page";

export const metadata = {
  title: "Events — Devora",
  description: "Limited-time offers on models in the Devora catalogue.",
};

/**
 * Public: no auth wrapper, and deliberately so.
 *
 * A visitor should be able to see what is free before creating an account — that is what
 * makes an event a shop window rather than a loyalty perk.
 */
export default function Page() {
  return <EventsPage />;
}
