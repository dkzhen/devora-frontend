import { ModelsPage } from "@/components/models-page";

export const metadata = {
  title: "Models — Devora",
  description: "Every model in the Devora catalogue, with live pricing and context.",
};

/**
 * Public: no auth wrapper.
 *
 * The full catalogue lives here rather than on the landing page. A visitor comparing models
 * should not have to sign up to see a price, and the landing page should not carry forty rows
 * of table — so the landing shows a highlight and this page carries the detail.
 */
export default function Page() {
  return <ModelsPage />;
}
