import { redirect } from "next/navigation";

export default function SessionKeysRedirect() {
  redirect("/dashboard?tab=session-keys");
}
