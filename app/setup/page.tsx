import { redirect } from "next/navigation";

/** The old address of the settings page, kept working for bookmarks. */
export default function SetupPage() {
  redirect("/settings");
}
