import { redirect } from "next/navigation";

export default function CreateRedirect() {
  redirect("/dashboard?tab=apis");
}
