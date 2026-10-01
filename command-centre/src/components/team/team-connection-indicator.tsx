"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, CheckCircle2, CircleOff, Loader2, LogIn, LogOut, Server, UsersRound } from "lucide-react";
import { notifyLocalProfileChange } from "@/lib/profile-storage";
import {
  canReconnectLocalProfile,
  isLocalProfileLocked,
  isTeamNavigationAvailable,
  notifyTeamContextChange,
  TEAM_CONTEXT_CHANGE_EVENT,
  useTeamNavigationStore,
} from "@/store/team-navigation-store";

export function TeamConnectionIndicator({ onOpenTeam }: { onOpenTeam: (path?: string) => void }) {
  const status = useTeamNavigationStore((state) => state.status);
  const refreshTeamStatus = useTeamNavigationStore((state) => state.refresh);
  const selectTeam = useTeamNavigationStore((state) => state.selectTeam);
  const switchingTeamId = useTeamNavigationStore((state) => state.switchingTeamId);
  const navigationError = useTeamNavigationStore((state) => state.error);
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [team, setTeam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const serverInputRef = useRef<HTMLInputElement | null>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 52, right: 24 });

  const loadStatus = async () => {
    const next = await refreshTeamStatus();
    if (!next) return null;
    if (next.apiUrl) setApiUrl(next.apiUrl);
    if (next.user?.email) setEmail(next.user.email);
    if (next.team?.slug) setTeam(next.team.slug);
    return next;
  };

  useEffect(() => {
    void loadStatus();
    const refresh = () => void loadStatus();
    window.addEventListener(TEAM_CONTEXT_CHANGE_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(TEAM_CONTEXT_CHANGE_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshTeamStatus]);

  const profileLocked = isLocalProfileLocked(status);
  const reconnectableProfile = canReconnectLocalProfile(status);
  const connected = isTeamNavigationAvailable(status);
  const companyMembership = status.companyMembership?.status === "active"
    ? status.companyMembership
    : null;
  const noTeamCompanyAccess = connected && Boolean(companyMembership) && !status.selectedTeamId;
  const pendingCompanyRequests = companyMembership?.role === "owner"
    ? status.pendingAccessRequestCount
    : 0;
  const blocked = status.status === "blocked";
  const unavailable = status.status === "unavailable";
  const label = profileLocked
    ? reconnectableProfile ? "Reconnect required" : "Profile repair required"
    : connected
      ? "Connected"
      : blocked
        ? "Access blocked"
        : unavailable
          ? "Unavailable"
          : "Disconnected";
  const Icon = connected ? CheckCircle2 : CircleOff;

  const displayName = useMemo(() => {
    return status.user?.displayName || status.user?.email || status.user?.id || "Not signed in";
  }, [status.user]);

  const teamName = useMemo(() => {
    const selected = status.teams.find((item) => item.id === status.selectedTeamId);
    return status.team?.name || status.team?.slug || status.team?.id
      || selected?.name || selected?.slug || selected?.id
      || (status.companyMembership?.status === "active" ? "No Team access" : "No team selected");
  }, [status.companyMembership?.status, status.selectedTeamId, status.team, status.teams]);

  const roleLabel = companyMembership
    ? companyMembership.role === "owner" ? "Company Owner" : "Company Admin"
    : status.membership?.role || "local";

  const memoryState = status.health?.backend
    ? `${status.health.backend}${status.health.embedder?.model ? `, ${status.health.embedder.model}` : ""}`
    : "Memory status not loaded";
  const connectionState = profileLocked
    ? status.localProfileError?.message || "The local Team OS profile is locked."
    : connected
      ? `${status.apiUrl || "Connected server"}`
      : status.error || "No server connected";

  const handleLogin = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/team/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apiUrl, email, password, team }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = typeof body.error === "string"
          ? body.error
          : typeof body.error?.message === "string" ? body.error.message : "Could not sign in";
        throw new Error(message);
      }
      if (body.localProfile && notifyLocalProfileChange(body.localProfile)) return;
      setPassword("");
      setModalOpen(false);
      const next = await loadStatus();
      notifyTeamContextChange(next?.selectedTeamId ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/team/session", { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (body.localProfile && notifyLocalProfileChange(body.localProfile)) return;
      await loadStatus();
      notifyTeamContextChange(null);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectTeam = async (teamId: string) => {
    if (teamId === status.selectedTeamId || switchingTeamId) return;
    if (await selectTeam(teamId)) setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopoverPosition({
        top: Math.round(rect.bottom + 8),
        right: Math.max(16, Math.round(window.innerWidth - rect.right)),
      });
    };

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!modalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModalOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    window.setTimeout(() => serverInputRef.current?.focus(), 0);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen]);

  const popover = open && typeof document !== "undefined"
    ? createPortal(
      <div ref={popoverRef} style={popoverStyle(popoverPosition)}>
        <div style={popoverHeaderStyle}>
          <div style={popoverTitleStyle}>{label}</div>
          <span style={roleBadgeStyle}>{roleLabel}</span>
        </div>
        <Detail label="Connection" value={connectionState} />
        <Detail label="Signed In As" value={displayName} />
        <Detail label="Team" value={teamName} />
        {companyMembership && <Detail label="Company" value={roleLabel} />}
        <Detail label="Memory" value={memoryState} />
        {status.expiresAt && <Detail label="Session" value={`Expires ${new Date(status.expiresAt).toLocaleString()}`} />}
        {status.teams.length > 1 && (
          <div style={teamSwitcherStyle}>
            <div style={teamSwitcherTitleStyle}>Switch team</div>
            <div role="list" aria-label="Active Team OS teams">
              {status.teams.map((item) => {
                const selected = item.id === status.selectedTeamId;
                const switching = item.id === switchingTeamId;
                const disabled = Boolean(switchingTeamId) || unavailable || profileLocked;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="listitem"
                    onClick={() => void handleSelectTeam(item.id)}
                    onMouseEnter={(event) => {
                      if (!disabled && !selected) {
                        event.currentTarget.style.background = "var(--cc-surface-muted)";
                        event.currentTarget.style.color = "var(--cc-text-primary)";
                      }
                    }}
                    onMouseLeave={(event) => {
                      if (!selected) {
                        event.currentTarget.style.background = "transparent";
                        event.currentTarget.style.color = "var(--cc-text-secondary)";
                      }
                    }}
                    disabled={disabled || selected}
                    aria-current={selected ? "true" : undefined}
                    style={teamOptionStyle(selected, disabled || selected)}
                  >
                    <span style={teamOptionIdentityStyle}>
                      <span style={teamOptionNameStyle}>{item.name || item.slug || item.id}</span>
                      {item.membership.role && (
                        <span style={teamOptionRoleStyle}>{item.membership.role}</span>
                      )}
                    </span>
                    {switching
                      ? <Loader2 size={14} aria-label="Switching team" style={{ animation: "spin 800ms ease-in-out infinite" }} />
                      : selected ? <Check size={14} aria-label="Current team" /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {navigationError && <div style={errorTextStyle}>{navigationError}</div>}
        {status.localProfileError && <div style={warningStyle}>{status.localProfileError.message}</div>}
        {status.error && <div style={warningStyle}>{status.error}</div>}
        {status.tokenType === "dev-token" && (
          <div style={warningStyle}>Dev-only shared token. Use email login for normal users.</div>
        )}
        <div style={popoverActionsStyle}>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenTeam(noTeamCompanyAccess ? "/team?section=teams" : "/team");
            }}
            style={smallButtonStyle}
          >
            <UsersRound size={13} />
            {noTeamCompanyAccess ? "Teams" : "Team"}
          </button>
          {!profileLocked && !status.signedIn && (
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setOpen(false);
              }}
              style={smallButtonStyle}
            >
              <LogIn size={13} />
              Sign in
            </button>
          )}
          {profileLocked && reconnectableProfile && (
            <button
              type="button"
              onClick={() => {
                setModalOpen(true);
                setOpen(false);
              }}
              style={smallButtonStyle}
            >
              <LogIn size={13} />
              Reconnect
            </button>
          )}
          {status.signedIn && !profileLocked && (
            <button type="button" onClick={handleLogout} disabled={busy} style={smallButtonStyle}>
              <LogOut size={13} />
              Sign out
            </button>
          )}
        </div>
      </div>,
      document.body,
    )
    : null;

  const loginModal = modalOpen && typeof document !== "undefined"
    ? createPortal(
      <div style={modalOverlayStyle} onMouseDown={() => setModalOpen(false)}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="team-os-login-title"
          style={modalStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div style={modalHeaderStyle}>
            <div>
              <h3 id="team-os-login-title" style={modalTitleStyle}>
                {profileLocked ? "Reconnect Team OS" : "Team OS Login"}
              </h3>
              <div style={subtleTextStyle}>Use your email and password for this team server.</div>
            </div>
            <Server size={18} color="var(--cc-brand-primary)" />
          </div>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Server URL</span>
            <input ref={serverInputRef} value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Email</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Password</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabelStyle}>Team</span>
            <input value={team} onChange={(event) => setTeam(event.target.value)} placeholder="Optional slug" style={inputStyle} />
          </label>
          {error && <div style={errorTextStyle}>{error}</div>}
          <div style={modalActionsStyle}>
            <button type="button" onClick={() => setModalOpen(false)} style={smallButtonStyle}>
              Cancel
            </button>
            <button type="button" onClick={handleLogin} disabled={busy} style={primaryButtonStyle}>
              <LogIn size={14} />
              {busy ? "Signing in..." : profileLocked ? "Reconnect" : "Sign in"}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <div style={wrapperStyle}>
        <button
          ref={buttonRef}
          type="button"
          onClick={() => {
            const nextOpen = !open;
            setOpen(nextOpen);
            if (nextOpen) void loadStatus();
          }}
          style={buttonStyle(connected)}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={`Team OS connection status: ${label}${pendingCompanyRequests > 0 ? `. ${pendingCompanyRequests} pending access request${pendingCompanyRequests === 1 ? "" : "s"}` : ""}`}
        >
          <Icon size={15} />
          <span>{label}</span>
          {pendingCompanyRequests > 0 && (
            <span style={pendingSignalStyle} aria-hidden="true">
              {pendingCompanyRequests > 99 ? "99+" : pendingCompanyRequests}
            </span>
          )}
        </button>

        {popover}
      </div>

      {loginModal}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={detailRowStyle}>
      <span style={detailLabelStyle}>{label}</span>
      <span style={detailValueStyle}>{value}</span>
    </div>
  );
}

const wrapperStyle: CSSProperties = {
  position: "relative",
  flexShrink: 0,
};

function buttonStyle(connected: boolean): CSSProperties {
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minWidth: 132,
    height: 34,
    padding: "0 12px",
    border: connected ? "1px solid rgba(111, 111, 111, 0.48)" : "1px solid var(--cc-line-alpha-20)",
    borderRadius: 8,
    background: connected ? "rgba(111, 111, 111, 0.1)" : "var(--cc-surface)",
    color: connected ? "#6F6F6F" : "var(--cc-text-secondary)",
    boxShadow: connected ? "0 0 0 3px rgba(111, 111, 111, 0.08)" : "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 800,
  };
}

function popoverStyle(position: { top: number; right: number }): CSSProperties {
  return {
    position: "fixed",
    right: position.right,
    top: position.top,
    zIndex: 1000,
    width: 380,
    padding: 14,
    border: "1px solid var(--cc-line-alpha-20)",
    borderRadius: 8,
    background: "var(--cc-surface)",
    boxShadow: "0 18px 48px var(--cc-neutral-alpha-16)",
  };
}

const popoverHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 10,
};

const popoverTitleStyle: CSSProperties = {
  color: "var(--cc-text-primary)",
  fontSize: 14,
  fontWeight: 800,
};

const roleBadgeStyle: CSSProperties = {
  padding: "3px 8px",
  borderRadius: 999,
  border: "1px solid var(--cc-line-alpha-15)",
  color: "var(--cc-text-secondary)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
};

const detailRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "104px minmax(0, 1fr)",
  gap: 8,
  alignItems: "start",
  marginTop: 7,
};

const detailLabelStyle: CSSProperties = {
  color: "var(--cc-text-tertiary)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
};

const detailValueStyle: CSSProperties = {
  color: "var(--cc-text-secondary)",
  fontSize: 12,
  lineHeight: 1.4,
  overflowWrap: "anywhere",
};

const warningStyle: CSSProperties = {
  color: "var(--cc-status-warning-strong)",
  fontSize: 12,
  lineHeight: 1.4,
  marginTop: 9,
};

const teamSwitcherStyle: CSSProperties = {
  marginTop: 12,
  paddingTop: 12,
  borderTop: "1px solid var(--cc-line-alpha-15)",
};

const teamSwitcherTitleStyle: CSSProperties = {
  marginBottom: 6,
  color: "var(--cc-text-tertiary)",
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

function teamOptionStyle(selected: boolean, disabled: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    width: "100%",
    minHeight: 38,
    padding: "8px 10px",
    border: "none",
    borderRadius: 6,
    background: selected ? "var(--cc-brand-alpha-08)" : "transparent",
    color: selected ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled && !selected ? 0.58 : 1,
    textAlign: "left",
    transition: "background 120ms ease, color 120ms ease, opacity 120ms ease",
  };
}

const pendingSignalStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 18,
  height: 18,
  padding: "0 5px",
  borderRadius: 999,
  background: "var(--cc-status-warning-strong)",
  color: "var(--cc-surface)",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
};

const teamOptionIdentityStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  minWidth: 0,
};

const teamOptionNameStyle: CSSProperties = {
  overflow: "hidden",
  fontSize: 12,
  fontWeight: 700,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const teamOptionRoleStyle: CSSProperties = {
  color: "var(--cc-text-tertiary)",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
};

const popoverActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 13,
};

const smallButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  minHeight: 30,
  padding: "0 10px",
  border: "1px solid var(--cc-line-alpha-25)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};

const modalOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2400,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(24, 24, 24, 0.5)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
};

const modalStyle: CSSProperties = {
  width: "min(440px, 100%)",
  padding: 18,
  borderRadius: 8,
  border: "1px solid var(--cc-line-alpha-20)",
  background: "var(--cc-surface)",
  boxShadow: "0 24px 70px var(--cc-neutral-alpha-25)",
};

const modalHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 14,
  marginBottom: 14,
};

const modalTitleStyle: CSSProperties = {
  margin: 0,
  color: "var(--cc-text-primary)",
  fontSize: 18,
  fontWeight: 800,
};

const subtleTextStyle: CSSProperties = {
  color: "var(--cc-text-tertiary)",
  fontSize: 12,
  lineHeight: 1.4,
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  marginTop: 10,
};

const fieldLabelStyle: CSSProperties = {
  color: "var(--cc-text-tertiary)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
};

const inputStyle: CSSProperties = {
  height: 36,
  padding: "0 11px",
  border: "1px solid var(--cc-line-alpha-30)",
  borderRadius: 6,
  background: "var(--cc-surface)",
  color: "var(--cc-text-primary)",
  fontSize: 13,
  outline: "none",
};

const errorTextStyle: CSSProperties = {
  color: "var(--cc-status-danger-bright)",
  fontSize: 13,
  marginTop: 10,
};

const modalActionsStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 16,
};

const primaryButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minHeight: 32,
  padding: "0 12px",
  border: "none",
  borderRadius: 6,
  background: "var(--cc-brand-primary)",
  color: "var(--cc-surface)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 800,
};
