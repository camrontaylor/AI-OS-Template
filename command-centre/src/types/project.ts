export interface ProjectBrief {
  slug: string;
  name: string;
  status: string;
  level: number;
  created: string;
  goal: string | null;
  path: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  status: "active" | "paused" | "complete" | "archived";
  level: number;
  briefPath: string | null;
  goal: string | null;
  clientId: string | null;
  createdAt: string;
  updatedAt: string;
  // Computed from JOIN
  taskCount?: number;
  doneCount?: number;
}
