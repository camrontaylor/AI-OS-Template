"use client";

import Link from "next/link";
import { ArrowRight, Circle, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export interface MarketingSurfaceItem {
  label: string;
  value: string;
  status?: "native" | "build" | "connect";
}

export interface MarketingSurfaceSection {
  title: string;
  description: string;
  items: MarketingSurfaceItem[];
}

const statusLabel = {
  native: "Native",
  build: "Build",
  connect: "Connect",
};

export function MarketingSurface({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: MarketingSurfaceSection[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="m-0 text-2xl font-semibold tracking-normal text-foreground">
            {title}
          </h1>
          <p className="m-0 mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/docs?file=projects/briefs/magister-command-centre/brief.md">
            <FileText data-icon="inline-start" />
            Build brief
          </Link>
        </Button>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title} className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {section.items.map((item) => (
                <div
                  key={`${section.title}:${item.label}`}
                  className="flex items-start justify-between gap-3 rounded-lg border bg-background p-3"
                >
                  <div className="flex min-w-0 gap-3">
                    <Circle className="mt-1 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">
                        {item.label}
                      </div>
                      <div className="text-sm text-muted-foreground">{item.value}</div>
                    </div>
                  </div>
                  {item.status && (
                    <Badge variant={item.status === "native" ? "default" : "secondary"}>
                      {statusLabel[item.status]}
                    </Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex justify-end">
        <Button asChild>
          <Link href="/plan">
            Return to plan
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
