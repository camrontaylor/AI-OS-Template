"use client";

import { redirect } from "next/navigation";

// Tasks view is now embedded in the Agent page. Redirect old links.
export default function TasksPage() {
  redirect("/agent");
}
