import { redirect } from "next/navigation";

export default function AdminSignupsRedirect() {
  redirect("/console/admin/users");
}