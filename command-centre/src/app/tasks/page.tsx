"use client";

import { redirect } from "next/navigation";

// Tasks view is now embedded in the Board page — redirect any old links
export default function TasksPage() {
  redirect("/");
}
