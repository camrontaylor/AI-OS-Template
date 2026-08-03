"use client";

import { useEffect, useMemo, useState } from "react";
import { FolderKanban, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClientId, appendClientId } from "@/hooks/use-client-id";

interface Project {
  id: string;
  slug: string;
  name: string;
  status: string;
  level: number | string;
  goal: string | null;
  taskCount: number;
  doneCount: number;
  createdAt?: string;
  updatedAt?: string;
}

function levelLabel(level: number | string): string {
  if (level === "Live" || level === "live") return "Live";
  return `Level ${level}`;
}

function ProjectCard({ project }: { project: Project }) {
  const href = `/docs?file=projects/briefs/${project.slug}/brief.md`;
  const title = project.name.replace(/-/g, " ");
  return (
    <a href={href} className="block">
      <Card className="cursor-pointer gap-3 rounded-lg p-4 shadow-none transition-colors hover:border-foreground/20 hover:bg-muted/40">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold capitalize text-foreground">
            {title}
          </span>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="px-2 py-0 text-[10px] font-medium uppercase tracking-wide">
            {project.status}
          </Badge>
          <Badge variant="outline" className="px-2 py-0 text-[10px] font-normal text-muted-foreground">
            {levelLabel(project.level)}
          </Badge>
        </div>

        {project.goal && (
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {project.goal.length > 160 ? project.goal.slice(0, 160).trimEnd() + "…" : project.goal}
          </p>
        )}

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {project.doneCount}/{project.taskCount} tasks done
          </span>
          {project.updatedAt && <span className="ml-auto">updated {project.updatedAt}</span>}
        </div>
      </Card>
    </a>
  );
}

export function ProjectsView() {
  const clientId = useClientId();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(appendClientId("/api/projects", clientId))
      .then((r) => r.json())
      .then((data) => {
        setProjects(Array.isArray(data) ? data : data?.projects ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  const grouped = useMemo(() => {
    const active = projects.filter((p) => p.status === "active");
    const other = projects.filter((p) => p.status !== "active");
    return { active, other };
  }, [projects]);

  if (loading) {
    return (
      <div className="p-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="gap-2 rounded-lg p-4 shadow-none">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-full" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="px-5 py-16 text-center">
        <FolderKanban className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h4 className="mb-2 text-base font-semibold text-foreground">No projects yet</h4>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          Level 2 and 3 work writes a brief under projects/briefs/. Those show up here.
        </p>
      </div>
    );
  }

  const Section = ({ title, items }: { title: string; items: Project[] }) =>
    items.length === 0 ? null : (
      <div className="mb-7">
        <div className="mb-4 flex items-center gap-2 border-b border-border pb-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">{title}</h4>
          <span className="text-[10px] font-medium text-muted-foreground">({items.length})</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      </div>
    );

  return (
    <div className="p-6">
      <p className="mb-5 text-[13px] text-muted-foreground">
        {projects.length} project{projects.length === 1 ? "" : "s"} in this workspace. Click one to open its brief.
      </p>
      <Section title="Active" items={grouped.active} />
      <Section title="Other" items={grouped.other} />
    </div>
  );
}
