import type { FeedPanelType } from "./feed-canvas-state";

export interface FeedPanelDescriptor {
  type: FeedPanelType;
  title: string;
  shortTitle: string;
  enabled: boolean;
  addable: boolean;
  availability: "available" | "coming-soon";
  singleton: boolean;
  menuOrder: number;
  icon: "chat" | "terminal" | "subchats" | "file" | "files" | "plan" | "changes";
}

export const FEED_PANEL_REGISTRY: Record<FeedPanelType, FeedPanelDescriptor> = {
  chat: { type: "chat", title: "Chat", shortTitle: "Chat", enabled: true, addable: false, availability: "available", singleton: false, menuOrder: 0, icon: "chat" },
  subchats: { type: "subchats", title: "Subchats", shortTitle: "Subchats", enabled: true, addable: true, availability: "available", singleton: true, menuOrder: 10, icon: "subchats" },
  file: { type: "file", title: "File viewer", shortTitle: "File", enabled: true, addable: true, availability: "available", singleton: true, menuOrder: 20, icon: "file" },
  files: { type: "files", title: "Files", shortTitle: "Files", enabled: true, addable: true, availability: "available", singleton: true, menuOrder: 30, icon: "files" },
  plan: { type: "plan", title: "Plan", shortTitle: "Plan", enabled: true, addable: true, availability: "available", singleton: true, menuOrder: 40, icon: "plan" },
  changes: { type: "changes", title: "Changes", shortTitle: "Changes", enabled: true, addable: true, availability: "available", singleton: true, menuOrder: 50, icon: "changes" },
  terminal: { type: "terminal", title: "Terminal", shortTitle: "Terminal", enabled: true, addable: true, availability: "coming-soon", singleton: false, menuOrder: 60, icon: "terminal" },
};

export const AVAILABLE_FEED_PANELS = Object.values(FEED_PANEL_REGISTRY).filter(
  (descriptor) => descriptor.enabled && descriptor.addable,
).sort((first, second) => first.menuOrder - second.menuOrder);

export function getFeedPanelTitle(type: FeedPanelType): string {
  return FEED_PANEL_REGISTRY[type].title;
}
