"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LayoutDashboard, Clock, Cpu, FileText, Settings, ChevronLeft, ChevronRight, History } from "lucide-react";
import { ClientSwitcher } from "./client-switcher";

const mainNavItems = [
  { label: "Overview", icon: Home, href: "/" },
  { label: "Board", icon: LayoutDashboard, href: "/board" },
  { label: "Scheduled Tasks", icon: Clock, href: "/scheduled" },
  { label: "History", icon: History, href: "/history" },
  { label: "Skills", icon: Cpu, href: "/skills" },
  { label: "Docs", icon: FileText, href: "/docs" },
];

const bottomNavItems = [
  { label: "Settings", icon: Settings, href: "/settings" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      style={{
        width: collapsed ? 56 : 220,
        backgroundColor: "var(--cc-surface-muted)",
        display: "flex",
        flexDirection: "column",
        padding: collapsed ? "16px 8px" : 16,
        gap: 24,
        flexShrink: 0,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        fontSize: 14,
        fontWeight: 500,
        transition: "width 200ms ease, padding 200ms ease",
        overflow: "hidden",
      }}
    >
      {/* Branding + collapse toggle */}
      <div style={{ padding: collapsed ? "16px 0" : "16px 8px", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between" }}>
        {collapsed ? (
          <button
            onClick={onToggle}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--cc-brand-primary)",
            }}
            title="Expand sidebar"
          >
            <ChevronRight size={20} />
          </button>
        ) : (
          <>
            <div>
              <h1
                style={{
                  fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                  fontWeight: 700,
                  fontSize: 22,
                  color: "var(--cc-brand-primary)",
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                AI-OS
              </h1>
              <p
                style={{
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.12em",
                  color: "var(--cc-text-secondary)",
                  marginTop: 4,
                }}
              >
                Operational Intelligence
              </p>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--cc-text-secondary)",
                borderRadius: 6,
                transition: "color 150ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--cc-brand-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-secondary)"; }}
              title="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
        {mainNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 12,
                padding: collapsed ? "10px 0" : "10px 12px",
                borderRadius: 12,
                cursor: isActive ? "default" : "pointer",
                backgroundColor: isActive ? "var(--cc-surface)" : "transparent",
                color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
                textDecoration: "none",
                transition: "all 200ms ease",
                boxShadow: isActive
                  ? "0px 4px 12px var(--cc-brand-alpha-06)"
                  : "none",
                width: collapsed ? 40 : "auto",
                height: 40,
                margin: collapsed ? "0 auto" : 0,
              }}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={20} />
              {!collapsed && <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{item.label}</span>}
            </Link>
          );
        })}

        {/* Divider before bottom nav */}
        <div style={{ borderTop: "1px solid var(--cc-line-alpha-20)", margin: "8px 0" }} />

        {bottomNavItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : "flex-start",
                gap: collapsed ? 0 : 12,
                padding: collapsed ? "10px 0" : "10px 12px",
                borderRadius: 12,
                cursor: isActive ? "default" : "pointer",
                backgroundColor: isActive ? "var(--cc-surface)" : "transparent",
                color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
                textDecoration: "none",
                transition: "all 200ms ease",
                boxShadow: isActive
                  ? "0px 4px 12px var(--cc-brand-alpha-06)"
                  : "none",
                width: collapsed ? 40 : "auto",
                height: 40,
                margin: collapsed ? "0 auto" : 0,
              }}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={20} />
              {!collapsed && <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Client switcher divider */}
      <div style={{ borderTop: "1px solid var(--cc-line-alpha-20)", margin: "16px 0" }} />

      {/* Client switcher */}
      <ClientSwitcher collapsed={collapsed} />
    </aside>
  );
}
