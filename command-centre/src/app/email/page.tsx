"use client";

import { AppShell } from "@/components/layout/app-shell";
import { MarketingSurface } from "@/components/marketing/marketing-surface";

export default function EmailPage() {
  return (
    <AppShell title="Email">
      <MarketingSurface
        title="Email"
        description="Draft, approval, scheduling, and follow-up state for outbound marketing runs."
        sections={[
          {
            title: "Drafting Flow",
            description: "Email work should be visible before it leaves the local command center.",
            items: [
              { label: "Gmail drafts", value: "Create reviewable drafts from approved briefs.", status: "build" },
              { label: "Send approvals", value: "Require explicit approval before any external send.", status: "native" },
              { label: "Follow-up queue", value: "Track reminders, replies, and unresolved next steps.", status: "build" },
            ],
          },
          {
            title: "Campaign Platforms",
            description: "Magister-inspired coverage for newsletters, lifecycle email, and SMS-adjacent tools.",
            items: [
              { label: "Kit / Mailchimp / beehiiv", value: "Newsletter draft and schedule targets.", status: "connect" },
              { label: "Customer.io / Klaviyo", value: "Lifecycle campaign mapping and evidence pulls.", status: "connect" },
              { label: "Resend", value: "Transactional email option for owned workflows.", status: "connect" },
            ],
          },
        ]}
      />
    </AppShell>
  );
}
