"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function PermissionsPage() {
  return (
    <AppShell title="Permissions">
      <MarketingSurface
        title="Permissions"
        description="Seven ask-before categories for outward-facing actions, drafts, spend, code, and destructive changes."
        sections={[
          {
            title: "Ask Before",
            description: "The categories that stop for explicit review.",
            items: [
              { label: "Email", value: "Approve/send, edit/send, request rewrite, reject.", status: "build" },
              { label: "Social publishing", value: "Draft and schedule before live publishing.", status: "build" },
              { label: "Content publishing", value: "CMS and website publish actions.", status: "build" },
              { label: "Paid ads", value: "Campaigns created paused; activation is separate.", status: "build" },
              { label: "Code and pull requests", value: "PR creation, merge, deploy, and file mutation gates.", status: "native" },
              { label: "Destructive actions", value: "Delete, archive, revoke, and irreversible changes.", status: "native" },
              { label: "Other external changes", value: "Catch-all for connected-service mutations.", status: "build" },
            ],
          },
          {
            title: "History",
            description: "Every approval request keeps an auditable state.",
            items: [
              { label: "Pending", value: "Requests waiting on the user.", status: "native" },
              { label: "Resolved", value: "Allowed, denied, running, successful, failed, expired.", status: "build" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}
