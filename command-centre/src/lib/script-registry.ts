export interface ArgDefinition {
  name: string;
  label: string;
  required: boolean;
  placeholder?: string;
}

export interface ScriptDefinition {
  id: string;
  label: string;
  description: string;
  file: string;
  args: ArgDefinition[];
  destructive: boolean;
  longRunning?: boolean;
  helpUrl?: string;
}

export const SCRIPT_REGISTRY: ScriptDefinition[] = [
  {
    id: "add-client",
    label: "Add Client",
    description: "Create a new client workspace with brand context, memory, and project folders",
    file: "add-client.sh",
    args: [{ name: "clientName", label: "Client Name", required: true, placeholder: "e.g. Acme Corp" }],
    destructive: false,

  },
  {
    id: "update",
    label: "Update AI-OS",
    description: "Check for updates, compare changes against your local repo, and safely pull the latest version — your user data is always protected",
    file: "update.sh",
    args: [],
    destructive: true,
    longRunning: true,

  },
  {
    id: "memory-setup",
    label: "Memory Setup",
    description: "Check memory status, choose local PGLite or hosted Postgres, and migrate or re-index memory",
    file: "setup-memory.sh",
    args: [],
    destructive: false,
    longRunning: true,

  },
];

export function getScriptById(id: string): ScriptDefinition | undefined {
  return SCRIPT_REGISTRY.find((s) => s.id === id);
}
