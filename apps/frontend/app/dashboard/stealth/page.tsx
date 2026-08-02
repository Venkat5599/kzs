import { redirect } from "next/navigation";

export default function StealthRedirect() {
  redirect("/dashboard?tab=stealth");
}
