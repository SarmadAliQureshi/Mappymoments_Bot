import { redirect } from "next/navigation";

// Visitors land on AI Map Style first.
export default function Home() {
  redirect("/color-themes");
}
