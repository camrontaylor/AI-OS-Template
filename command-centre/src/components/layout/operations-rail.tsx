"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cpu,
  ExternalLink,
  FileStack,
  Link2,
  Mail,
  Monitor,
  ShieldCheck,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type RailKey =
  | "assets"
  | "integrations"
  | "workflows"
  | "permissions"
  | "skills"
  | "email"
  | "browser";

interface RailItem {
  key: RailKey;
  label: string;
  href: string;
  icon: LucideIcon;
}

interface RailPanel {
  title: string;
  eyebrow: string;
  summary: string;
  actionLabel: string;
  actionHref: string;
  stats: Array<{ label: string; value: string }>;
  sections: Array<{
    title: string;
    items: Array<{
      label: string;
      detail: string;
      status: "ready" | "build" | "watch";
    }>;
  }>;
}

const railItems: RailItem[] = [
  { key: "assets", label: "Assets", href: "/assets", icon: FileStack },
  { key: "integrations", label: "Integrations", href: "/integrations", icon: Link2 },
  { key: "workflows", label: "Workflows", href: "/workflows", icon: Workflow },
  { key: "permissions", label: "Permissions", href: "/permissions", icon: ShieldCheck },
  { key: "skills", label: "Skills", href: "/skills", icon: Cpu },
  { key: "email", label: "Email", href: "/email", icon: Mail },
  { key: "browser", label: "Browser Control", href: "/browser-control", icon: Monitor },
];

const panels: Record<RailKey, RailPanel> = {
  assets: {
    title: "Assets",
    eyebrow: "Workspace inputs",
    summary: "Brand files, generated audit docs, plan evidence, and publishable outputs.",
    actionLabel: "Open assets",
    actionHref: "/assets",
    stats: [
      { label: "Watched docs", value: "17" },
      { label: "Plan files", value: "4" },
    ],
    sections: [
      {
        title: "Active sources",
        items: [
          {
            label: "Magister replication brief",
            detail: "Feature inventory and teardown notes",
            status: "ready",
          },
          {
            label: "Generated plan docs",
            detail: "PLAN.md and light audit evidence",
            status: "ready",
          },
          {
            label: "Screenshot references",
            detail: "Live Magister UI captures saved locally",
            status: "watch",
          },
        ],
      },
    ],
  },
  integrations: {
    title: "Integrations",
    eyebrow: "Control plane",
    summary: "Connected tools and requested services that marketing workflows need before they run.",
    actionLabel: "Manage integrations",
    actionHref: "/integrations",
    stats: [
      { label: "Included", value: "18" },
      { label: "Native", value: "3" },
    ],
    sections: [
      {
        title: "Core stack",
        items: [
          { label: "GitHub", detail: "Repo context and PR state", status: "ready" },
          { label: "Vercel", detail: "Deployments and production checks", status: "ready" },
          { label: "Google Analytics / GSC", detail: "Traffic and search deltas", status: "build" },
        ],
      },
      {
        title: "Publishing",
        items: [
          { label: "LinkedIn / X / Threads", detail: "Social scheduling targets", status: "build" },
          { label: "Gmail / Resend", detail: "Email draft and send surfaces", status: "watch" },
        ],
      },
    ],
  },
  workflows: {
    title: "Workflows",
    eyebrow: "Scheduled loops",
    summary: "Repeatable operating procedures compiled from AI-OS skills into cron-ready runs.",
    actionLabel: "Open workflows",
    actionHref: "/workflows",
    stats: [
      { label: "Templates", value: "5" },
      { label: "Scheduled", value: "0" },
    ],
    sections: [
      {
        title: "Marketing loops",
        items: [
          { label: "Standard brief", detail: "Daily marketing action list", status: "build" },
          { label: "Audit refresh", detail: "Weekly evidence refresh", status: "build" },
          { label: "Plan execution", detail: "Claims next task and opens an agent run", status: "build" },
        ],
      },
    ],
  },
  permissions: {
    title: "Permissions",
    eyebrow: "Human gates",
    summary: "Approval rules for external writes, publishing, spend, account changes, and destructive actions.",
    actionLabel: "Review permissions",
    actionHref: "/permissions",
    stats: [
      { label: "Ask-before", value: "5" },
      { label: "Auto", value: "Local" },
    ],
    sections: [
      {
        title: "Protected actions",
        items: [
          { label: "Publish or schedule", detail: "Always asks before external posting", status: "watch" },
          { label: "Spend or upgrade", detail: "Blocked until explicit user approval", status: "ready" },
          { label: "Delete or reset", detail: "Escalates before destructive local actions", status: "ready" },
        ],
      },
    ],
  },
  skills: {
    title: "Skills",
    eyebrow: "AI-OS runtime",
    summary: "Local skill catalog used to produce audits, briefs, plans, social work, and checks.",
    actionLabel: "Open skills",
    actionHref: "/skills",
    stats: [
      { label: "Live skills", value: "80+" },
      { label: "Marketing", value: "30+" },
    ],
    sections: [
      {
        title: "Useful now",
        items: [
          { label: "ops-website", detail: "Website checks and deploy support", status: "ready" },
          { label: "mkt-copywriting", detail: "Copy surfaces for plan tasks", status: "ready" },
          { label: "str-ai-seo", detail: "AI visibility work", status: "ready" },
        ],
      },
    ],
  },
  email: {
    title: "Email",
    eyebrow: "Outbound surface",
    summary: "Draft, approval, send, and follow-up state for email-backed marketing workflows.",
    actionLabel: "Open email",
    actionHref: "/email",
    stats: [
      { label: "Drafts", value: "0" },
      { label: "Queued", value: "0" },
    ],
    sections: [
      {
        title: "Planned capabilities",
        items: [
          { label: "Gmail drafts", detail: "Create reviewable drafts before sending", status: "build" },
          { label: "Campaign tools", detail: "Customer.io, Kit, Klaviyo, Mailchimp map", status: "build" },
          { label: "Approval trail", detail: "Records who approved outward sends", status: "watch" },
        ],
      },
    ],
  },
  browser: {
    title: "Browser Control",
    eyebrow: "Live research",
    summary: "Codex in-app browser captures, DOM snapshots, and browser-backed workflow evidence.",
    actionLabel: "Open browser notes",
    actionHref: "/browser-control",
    stats: [
      { label: "Screens", value: "13" },
      { label: "DOM files", value: "13" },
    ],
    sections: [
      {
        title: "Captured reference",
        items: [
          { label: "Chat shell", detail: "Health card, tabs, prompts, chat rail", status: "ready" },
          { label: "Plan / Calendar / Analytics", detail: "Primary Magister workspaces", status: "ready" },
          { label: "Right rail", detail: "Assets through Browser Control panels", status: "ready" },
        ],
      },
    ],
  },
};

const pathToKey: Array<[string, RailKey]> = [
  ["/assets", "assets"],
  ["/integrations", "integrations"],
  ["/workflows", "workflows"],
  ["/permissions", "permissions"],
  ["/skills", "skills"],
  ["/email", "email"],
  ["/browser-control", "browser"],
];

const statusConfig = {
  ready: { label: "Ready", icon: CheckCircle2, className: "text-emerald-600 dark:text-emerald-400" },
  build: { label: "Build", icon: Clock3, className: "text-amber-600 dark:text-amber-400" },
  watch: { label: "Watch", icon: CircleAlert, className: "text-sky-600 dark:text-sky-400" },
};

function activeKeyForPath(pathname: string): RailKey {
  return pathToKey.find(([prefix]) => pathname.startsWith(prefix))?.[1] ?? "integrations";
}

export function OperationsRail() {
  const pathname = usePathname();
  const activeKey = activeKeyForPath(pathname);
  const panel = panels[activeKey];

  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 border-l bg-background xl:flex">
      <TooltipProvider>
        <nav className="flex w-[72px] flex-col items-center gap-1 border-r px-2 py-3">
          {railItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeKey === item.key;
            return (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant={isActive ? "secondary" : "ghost"}
                    size="icon"
                    className={cn("size-10 rounded-md", isActive && "text-foreground")}
                  >
                    <Link href={item.href} aria-label={item.label}>
                      <Icon className="size-4" />
                    </Link>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="left">{item.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </nav>
      </TooltipProvider>

      <ScrollArea className="w-[304px]">
        <div className="flex min-h-full flex-col gap-4 p-4">
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {panel.eyebrow}
            </div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="m-0 text-base font-semibold text-foreground">{panel.title}</h2>
                <p className="m-0 mt-1 text-sm text-muted-foreground">{panel.summary}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {panel.stats.map((stat) => (
              <div key={stat.label} className="rounded-lg border bg-card p-3">
                <div className="text-lg font-semibold leading-none text-foreground">
                  {stat.value}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href={panel.actionHref}>
              {panel.actionLabel}
              <ExternalLink data-icon="inline-end" />
            </Link>
          </Button>

          <Separator />

          <div className="flex flex-col gap-4">
            {panel.sections.map((section) => (
              <section key={section.title} className="flex flex-col gap-2">
                <h3 className="m-0 text-sm font-medium text-foreground">{section.title}</h3>
                {section.items.map((item) => {
                  const config = statusConfig[item.status];
                  const StatusIcon = config.icon;
                  return (
                    <div key={item.label} className="rounded-lg border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-foreground">
                            {item.label}
                          </div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            {item.detail}
                          </div>
                        </div>
                        <Badge variant="secondary" className="shrink-0 gap-1">
                          <StatusIcon className={cn("size-3", config.className)} />
                          {config.label}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      </ScrollArea>
    </aside>
  );
}
