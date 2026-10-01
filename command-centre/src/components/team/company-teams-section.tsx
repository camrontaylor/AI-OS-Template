"use client";

import {
  Archive,
  Check,
  Crown,
  KeyRound,
  LockKeyhole,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  accessLabel,
  canPermanentlyDeleteTeam,
  filterCompanyTeams,
  filterExistingUsers,
  normalizeCompanyAccessState,
  normalizeCompanyMembershipsState,
  normalizeCompanyTeamsState,
  slugifyTeamName,
  type CompanyAccessRequest,
  type CompanyAdmin,
  type CompanyAdminTeamAccess,
  type CompanyPerson,
  type CompanyTeam,
  type CompanyTeamAccessFilter,
  type CompanyTeamStatusFilter,
  type CompanyAccessState,
  type CompanyMembershipsState,
  type CompanyTeamsState,
} from "./company-teams-state";
import styles from "./company-teams-section.module.css";
import { useTeamNavigationStore } from "@/store/team-navigation-store";

type CompanyTab = "all" | "requests" | "admins" | "my-access";
type CompanyEndpoint = "teams" | "memberships" | "access";
type TeamDialogTab = "members" | "settings";

interface CompanyTeamsSectionProps {
  selectedTeamId: string | null;
  onSelectedTeamId: (teamId: string | null) => void;
}

interface MutationOptions {
  busyKey: string;
  success: string | ((body: unknown) => string);
  targetTeamId?: string | null;
  closeDetail?: boolean;
}

interface DialogFeedback {
  error: string | null;
  notice: string | null;
}

const EMPTY_TEAMS = normalizeCompanyTeamsState({});
const EMPTY_MEMBERSHIPS = normalizeCompanyMembershipsState({});
const EMPTY_ACCESS = normalizeCompanyAccessState({});

export function CompanyTeamsSection({ selectedTeamId, onSelectedTeamId }: CompanyTeamsSectionProps) {
  const navigationStatus = useTeamNavigationStore((state) => state.status);
  const refreshNavigationStatus = useTeamNavigationStore((state) => state.refresh);
  const [tab, setTab] = useState<CompanyTab>("all");
  const [teamsState, setTeamsState] = useState<CompanyTeamsState>(EMPTY_TEAMS);
  const [membershipsState, setMembershipsState] = useState<CompanyMembershipsState>(EMPTY_MEMBERSHIPS);
  const [accessState, setAccessState] = useState<CompanyAccessState>(EMPTY_ACCESS);
  const [selectedTeam, setSelectedTeam] = useState<CompanyTeam | null>(null);
  const [teamDialogTab, setTeamDialogTab] = useState<TeamDialogTab>("members");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CompanyTeamStatusFilter>("all");
  const [accessFilter, setAccessFilter] = useState<CompanyTeamAccessFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [requestTeam, setRequestTeam] = useState<CompanyTeam | null>(null);
  const [deleteTeam, setDeleteTeam] = useState<CompanyTeam | null>(null);
  const [addAdminOpen, setAddAdminOpen] = useState(false);
  const [adminAccessTarget, setAdminAccessTarget] = useState<CompanyAdmin | null>(null);
  const [confirmAdmin, setConfirmAdmin] = useState<{ admin: CompanyAdmin; action: "transfer" | "remove" } | null>(null);
  const [memberRemoval, setMemberRemoval] = useState<{ team: CompanyTeam; member: CompanyPerson } | null>(null);
  const [ownerRoleChange, setOwnerRoleChange] = useState<{ team: CompanyTeam; owner: CompanyPerson } | null>(null);
  const loadGenerationRef = useRef(0);
  const detailGenerationRef = useRef(0);
  const mutationGenerationRef = useRef<Record<CompanyEndpoint, number>>({ teams: 0, memberships: 0, access: 0 });
  const contextKey = `${navigationStatus.serverId ?? "none"}:${navigationStatus.user?.id ?? "none"}`;
  const [stateContextKey, setStateContextKey] = useState(contextKey);
  const previousContextKeyRef = useRef(contextKey);
  const contextKeyRef = useRef(contextKey);
  const selectedTeamIdRef = useRef(selectedTeamId);
  contextKeyRef.current = contextKey;
  selectedTeamIdRef.current = selectedTeamId;

  const companyMembership = navigationStatus.companyMembership
    ?? teamsState.companyMembership
    ?? accessState.companyMembership
    ?? membershipsState.companyMembership;
  const isCompanyOwner = companyMembership?.role === "owner" && companyMembership.status === "active";
  const isCompanyAdmin = companyMembership?.role === "admin" && companyMembership.status === "active";
  const allowedTabs: CompanyTab[] = isCompanyOwner
    ? ["all", "requests", "admins"]
    : ["all", "my-access"];
  const activeTab = allowedTabs.includes(tab) ? tab : "all";

  const loadAll = async (showFeedback = false) => {
    const generation = ++loadGenerationRef.current;
    const requestContext = contextKeyRef.current;
    setLoading(true);
    if (showFeedback) {
      setError(null);
      setNotice(null);
    }
    const [teamsResult, membershipsResult, accessResult] = await Promise.allSettled([
      fetchCompanyJson("teams"),
      fetchCompanyJson("memberships"),
      fetchCompanyJson("access"),
    ]);
    if (generation !== loadGenerationRef.current || requestContext !== contextKeyRef.current) return;
    if (teamsResult.status === "fulfilled") setTeamsState(normalizeCompanyTeamsState(teamsResult.value));
    if (membershipsResult.status === "fulfilled") setMembershipsState(normalizeCompanyMembershipsState(membershipsResult.value));
    if (accessResult.status === "fulfilled") setAccessState(normalizeCompanyAccessState(accessResult.value));
    const firstFailure = [teamsResult, accessResult, membershipsResult].find((result) => result.status === "rejected");
    if (teamsResult.status === "rejected") {
      setError(errorMessage(teamsResult.reason, "Company Teams unavailable"));
    } else if (accessResult.status === "rejected") {
      setError(errorMessage(accessResult.reason, "Company access controls could not be loaded"));
    } else if (firstFailure && isCompanyOwner) {
      setError(errorMessage(firstFailure.reason, "Some company controls could not be loaded"));
    } else {
      setError(null);
    }
    if (showFeedback && teamsResult.status === "fulfilled") setNotice("Company Teams refreshed.");
    setLoading(false);
  };

  const loadDetail = async (teamId: string) => {
    const generation = ++detailGenerationRef.current;
    const requestContext = contextKeyRef.current;
    setDetailLoading(true);
    setError(null);
    try {
      const body = await fetchCompanyJson("teams", teamId);
      if (
        generation !== detailGenerationRef.current
        || requestContext !== contextKeyRef.current
        || selectedTeamIdRef.current !== teamId
      ) return;
      const normalized = normalizeCompanyTeamsState(body);
      setSelectedTeam(normalized.selectedTeam ?? normalized.teams.find((team) => team.id === teamId) ?? null);
      setTeamsState((current) => ({ ...current, existingUsers: normalized.existingUsers }));
    } catch (caught) {
      if (
        generation === detailGenerationRef.current
        && requestContext === contextKeyRef.current
        && selectedTeamIdRef.current === teamId
      ) {
        setError(errorMessage(caught, "Team details unavailable"));
        setSelectedTeam(null);
      }
    } finally {
      if (
        generation === detailGenerationRef.current
        && requestContext === contextKeyRef.current
        && selectedTeamIdRef.current === teamId
      ) setDetailLoading(false);
    }
  };

  useEffect(() => {
    const previousContextKey = previousContextKeyRef.current;
    const shouldCloseSelection = previousContextKey !== "none:none" && previousContextKey !== contextKey;
    previousContextKeyRef.current = contextKey;
    ++loadGenerationRef.current;
    ++detailGenerationRef.current;
    mutationGenerationRef.current = {
      teams: mutationGenerationRef.current.teams + 1,
      memberships: mutationGenerationRef.current.memberships + 1,
      access: mutationGenerationRef.current.access + 1,
    };
    setTeamsState(EMPTY_TEAMS);
    setMembershipsState(EMPTY_MEMBERSHIPS);
    setAccessState(EMPTY_ACCESS);
    setSelectedTeam(null);
    setTab("all");
    setBusyKey(null);
    setError(null);
    setNotice(null);
    setCreateOpen(false);
    setRequestTeam(null);
    setDeleteTeam(null);
    setAddAdminOpen(false);
    setAdminAccessTarget(null);
    setConfirmAdmin(null);
    setMemberRemoval(null);
    setOwnerRoleChange(null);
    setStateContextKey(contextKey);
    if (shouldCloseSelection && selectedTeamIdRef.current) onSelectedTeamId(null);
    void loadAll();
  }, [contextKey]);

  useEffect(() => {
    ++detailGenerationRef.current;
    setSelectedTeam(null);
    setError(null);
    setNotice(null);
    if (selectedTeamId) void loadDetail(selectedTeamId);
    else setDetailLoading(false);
  }, [selectedTeamId, contextKey]);

  const mutate = async (
    endpoint: CompanyEndpoint,
    action: Record<string, unknown>,
    options: MutationOptions,
  ) => {
    const sequence = ++mutationGenerationRef.current[endpoint];
    const requestContext = contextKeyRef.current;
    const targetTeamId = options.targetTeamId ?? null;
    setBusyKey(options.busyKey);
    setError(null);
    setNotice(null);
    try {
      const responseBody = await postCompanyJson(endpoint, action);
      if (
        sequence !== mutationGenerationRef.current[endpoint]
        || requestContext !== contextKeyRef.current
      ) return false;
      if (options.closeDetail) onSelectedTeamId(null);
      setNotice(typeof options.success === "function" ? options.success(responseBody) : options.success);
      await Promise.all([loadAll(), refreshNavigationStatus()]);
      if (
        sequence !== mutationGenerationRef.current[endpoint]
        || requestContext !== contextKeyRef.current
      ) return false;
      if (endpoint === "teams") {
        setTeamsState(normalizeCompanyTeamsState(responseBody));
      } else if (endpoint === "access") {
        setAccessState(normalizeCompanyAccessState(responseBody));
      } else {
        setMembershipsState(normalizeCompanyMembershipsState(responseBody));
      }
      if (targetTeamId && !options.closeDetail && selectedTeamIdRef.current === targetTeamId) {
        await loadDetail(targetTeamId);
      }
      return true;
    } catch (caught) {
      if (sequence === mutationGenerationRef.current[endpoint] && requestContext === contextKeyRef.current) {
        setError(errorMessage(caught, "Company action failed"));
      }
      return false;
    } finally {
      if (sequence === mutationGenerationRef.current[endpoint] && requestContext === contextKeyRef.current) {
        setBusyKey(null);
      }
    }
  };

  const teams = teamsState.teams.length ? teamsState.teams : accessState.teams;
  const visibleTeams = useMemo(
    () => filterCompanyTeams(teams, query, statusFilter, accessFilter),
    [accessFilter, query, statusFilter, teams],
  );
  const admins = useMemo(
    () => mergeAdmins(accessState.admins, membershipsState.memberships, membershipsState.pendingInvitations)
      .filter((admin) => admin.companyRole === "admin"),
    [accessState.admins, membershipsState.memberships, membershipsState.pendingInvitations],
  );
  const existingUsers = teamsState.existingUsers.length
    ? teamsState.existingUsers
    : teamsState.eligibleOwners;
  const pendingCount = Math.max(
    navigationStatus.pendingAccessRequestCount,
    accessState.pendingAccessRequestCount,
    accessState.requests.filter((request) => request.status === "pending").length,
  );
  const hasOpenDialog = Boolean(
    selectedTeamId
    || createOpen
    || requestTeam
    || deleteTeam
    || addAdminOpen
    || adminAccessTarget
    || confirmAdmin
    || memberRemoval
    || ownerRoleChange,
  );
  const dialogFeedback: DialogFeedback = { error, notice };

  if (stateContextKey !== contextKey) {
    return (
      <section className={styles.shell} aria-label="Loading Company Teams" aria-busy="true">
        <div className={styles.content}><LoadingRows /></div>
      </section>
    );
  }

  const clearFeedback = () => {
    setError(null);
    setNotice(null);
  };

  const openTeam = (team: CompanyTeam, nextTab: TeamDialogTab) => {
    clearFeedback();
    setTeamDialogTab(nextTab);
    setDetailLoading(true);
    onSelectedTeamId(team.id);
  };

  const openRequest = (team: CompanyTeam) => {
    clearFeedback();
    setRequestTeam(team);
  };

  if (!companyMembership || (!isCompanyOwner && !isCompanyAdmin)) {
    return <EmptyPanel title="Company access unavailable" detail="Only Company Owners and Company Admins can open Teams." />;
  }

  return (
    <section className={styles.shell} aria-labelledby="company-teams-title">
      <header className={styles.sectionHeader}>
        <div>
          <h3 id="company-teams-title" className={styles.sectionTitle}>Teams</h3>
          <p className={styles.sectionDescription}>People, access, and ownership across your company.</p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.roleBadge}>{isCompanyOwner ? "Company Owner" : "Company Admin"}</span>
          <button
            className={styles.iconButton}
            type="button"
            onClick={() => void loadAll(true)}
            disabled={loading}
            aria-label="Refresh company Teams"
            title="Refresh"
          >
            <RefreshCw className={loading ? styles.spinning : undefined} size={16} />
          </button>
        </div>
      </header>

      <CompanyTabs
        tab={activeTab}
        isOwner={isCompanyOwner}
        pendingCount={isCompanyOwner ? pendingCount : 0}
        onTab={setTab}
      />

      <div className={styles.content}>
        {!hasOpenDialog && error && <div className={styles.errorBanner} role="alert">{error}</div>}
        {!hasOpenDialog && notice && <div className={styles.noticeBanner} role="status" aria-live="polite">{notice}</div>}

        {activeTab === "all" && (
          <AllTeamsPanel
            teams={visibleTeams}
            totalCount={teams.length}
            loading={loading}
            isCompanyOwner={isCompanyOwner}
            query={query}
            statusFilter={statusFilter}
            accessFilter={accessFilter}
            onQuery={setQuery}
            onStatusFilter={setStatusFilter}
            onAccessFilter={setAccessFilter}
            onCreate={() => {
              clearFeedback();
              setCreateOpen(true);
            }}
            onOpen={openTeam}
            onRequest={openRequest}
          />
        )}
        {activeTab === "requests" && isCompanyOwner && (
          <RequestsPanel
            requests={accessState.requests}
            busyKey={busyKey}
            onApprove={(request) => mutate(
              "access",
              { action: "approve-request", requestId: request.id },
              { busyKey: `approve:${request.id}`, success: "Access approved." },
            )}
            onDeny={(request) => mutate(
              "access",
              { action: "deny-request", requestId: request.id },
              { busyKey: `deny:${request.id}`, success: "Access request denied." },
            )}
          />
        )}
        {activeTab === "admins" && isCompanyOwner && (
          <CompanyAdminsPanel
            admins={admins}
            busy={busyKey !== null}
            onAdd={() => {
              clearFeedback();
              setAddAdminOpen(true);
            }}
            onManageAccess={(admin) => {
              clearFeedback();
              setAdminAccessTarget(admin);
            }}
            onTransfer={(admin) => {
              clearFeedback();
              setConfirmAdmin({ admin, action: "transfer" });
            }}
            onRemove={(admin) => {
              clearFeedback();
              setConfirmAdmin({ admin, action: "remove" });
            }}
          />
        )}
        {activeTab === "my-access" && isCompanyAdmin && (
          <MyAccessPanel
            access={accessState}
            teams={teams}
            busyKey={busyKey}
            onCancel={(request) => mutate(
              "access",
              { action: "cancel-request", requestId: request.id },
              { busyKey: `cancel:${request.id}`, success: "Access request cancelled." },
            )}
            onRevoke={(team) => mutate(
              "access",
              { action: "revoke-access", teamId: team.id },
              { busyKey: `revoke:${team.id}`, success: "Full access revoked." },
            )}
          />
        )}
      </div>

      {selectedTeamId && !deleteTeam && !requestTeam && !memberRemoval && !ownerRoleChange && (
        <TeamManagementDialog
          feedback={dialogFeedback}
          team={selectedTeam ?? teams.find((item) => item.id === selectedTeamId) ?? null}
          loading={detailLoading}
          activeTab={teamDialogTab}
          busyKey={busyKey}
          isCompanyOwner={isCompanyOwner}
          existingUsers={existingUsers}
          onClose={() => onSelectedTeamId(null)}
          onTab={setTeamDialogTab}
          onRequest={openRequest}
          onUpdate={(team, name) => mutate(
            "teams",
            { action: "update-team", teamId: team.id, name },
            { busyKey: `update:${team.id}`, success: "Team name updated.", targetTeamId: team.id },
          )}
          onArchive={(team) => mutate(
            "teams",
            { action: "archive-team", teamId: team.id },
            { busyKey: `archive:${team.id}`, success: "Team archived.", targetTeamId: team.id },
          )}
          onReactivate={(team) => mutate(
            "teams",
            { action: "reactivate-team", teamId: team.id },
            { busyKey: `reactivate:${team.id}`, success: "Team reactivated.", targetTeamId: team.id },
          )}
          onDelete={(team) => {
            clearFeedback();
            setDeleteTeam(team);
          }}
          onAddMember={(team, user, role) => mutate(
            "teams",
            { action: "add-member", teamId: team.id, user: user.userId, role },
            { busyKey: `add-member:${user.userId}`, success: "Team member added.", targetTeamId: team.id },
          )}
          onMemberRole={(team, member, role) => mutate(
            "teams",
            { action: "set-member-role", teamId: team.id, user: member.userId, role },
            { busyKey: `member:${member.userId}`, success: "Member role updated.", targetTeamId: team.id },
          )}
          onRemoveMember={(team, member) => {
            clearFeedback();
            setMemberRemoval({ team, member });
          }}
          onAddOwner={(team, user) => mutate(
            "teams",
            { action: "add-team-owner", teamId: team.id, user: user.userId },
            { busyKey: `owner:${user.userId}`, success: "Team Owner added.", targetTeamId: team.id },
          )}
          onRemoveOwner={(team, owner) => {
            clearFeedback();
            setOwnerRoleChange({ team, owner });
          }}
        />
      )}

      {createOpen && (
        <CreateTeamDialog
          feedback={dialogFeedback}
          users={existingUsers}
          busy={busyKey === "create-team"}
          onClose={() => setCreateOpen(false)}
          onCreate={async (input) => {
            const saved = await mutate(
              "teams",
              { action: "create-team", name: input.name, slug: input.slug, ownerUserId: input.ownerUserId },
              { busyKey: "create-team", success: "Team created." },
            );
            if (saved) setCreateOpen(false);
          }}
        />
      )}

      {requestTeam && (
        <RequestAccessDialog
          feedback={dialogFeedback}
          team={requestTeam}
          busy={busyKey === `request:${requestTeam.id}`}
          onClose={() => setRequestTeam(null)}
          onRequest={async (reason) => {
            const requestedTeamId = requestTeam.id;
            const saved = await mutate(
              "access",
              { action: "request-access", teamId: requestedTeamId, reason: reason || undefined },
              { busyKey: `request:${requestedTeamId}`, success: "Access request sent." },
            );
            if (saved) {
              setRequestTeam(null);
              if (selectedTeamIdRef.current === requestedTeamId) {
                setSelectedTeam(null);
                setDetailLoading(true);
                await loadDetail(requestedTeamId);
              }
            }
          }}
        />
      )}

      {deleteTeam && (
        <DeleteTeamDialog
          feedback={dialogFeedback}
          team={deleteTeam}
          busy={busyKey === `delete:${deleteTeam.id}`}
          onClose={() => setDeleteTeam(null)}
          onDelete={async () => {
            const saved = await mutate(
              "teams",
              { action: "delete-team", teamId: deleteTeam.id, expectedName: deleteTeam.name, confirm: true },
              { busyKey: `delete:${deleteTeam.id}`, success: "Team permanently deleted.", targetTeamId: deleteTeam.id, closeDetail: true },
            );
            if (saved) setDeleteTeam(null);
          }}
        />
      )}

      {memberRemoval && (
        <ConfirmDialog
          feedback={dialogFeedback}
          title={`Remove ${memberRemoval.member.displayName}?`}
          detail={`Their direct membership in ${memberRemoval.team.name} will be removed. Any separate Company access remains unchanged.`}
          confirmLabel="Remove member"
          danger
          busy={busyKey === `member:${memberRemoval.member.userId}`}
          onClose={() => setMemberRemoval(null)}
          onConfirm={async () => {
            const saved = await mutate(
              "teams",
              { action: "remove-member", teamId: memberRemoval.team.id, user: memberRemoval.member.userId },
              {
                busyKey: `member:${memberRemoval.member.userId}`,
                success: "Member removed.",
                targetTeamId: memberRemoval.team.id,
              },
            );
            if (saved) setMemberRemoval(null);
          }}
        />
      )}

      {ownerRoleChange && (
        <ChangeTeamOwnerRoleDialog
          feedback={dialogFeedback}
          team={ownerRoleChange.team}
          owner={ownerRoleChange.owner}
          busy={busyKey === `owner:${ownerRoleChange.owner.userId}`}
          onClose={() => setOwnerRoleChange(null)}
          onConfirm={async (replacementRole) => {
            const saved = await mutate(
              "teams",
              {
                action: "remove-team-owner",
                teamId: ownerRoleChange.team.id,
                user: ownerRoleChange.owner.userId,
                replacementRole,
              },
              {
                busyKey: `owner:${ownerRoleChange.owner.userId}`,
                success: `${ownerRoleChange.owner.displayName} is now a Team ${replacementRole === "admin" ? "Admin" : "Member"}.`,
                targetTeamId: ownerRoleChange.team.id,
              },
            );
            if (saved) setOwnerRoleChange(null);
          }}
        />
      )}

      {addAdminOpen && (
        <AddCompanyAdminDialog
          feedback={dialogFeedback}
          users={existingUsers}
          admins={mergeAdmins(accessState.admins, membershipsState.memberships)}
          busy={busyKey === "promote-admin"}
          onClose={() => setAddAdminOpen(false)}
          onAdd={async (user) => {
            const saved = await mutate(
              "memberships",
              { action: "promote-admin", user: user.userId },
              { busyKey: "promote-admin", success: "Company Admin added." },
            );
            if (saved) setAddAdminOpen(false);
          }}
        />
      )}

      {adminAccessTarget && (
        <CompanyAdminAccessDialog
          feedback={dialogFeedback}
          admin={adminAccessTarget}
          teams={teams}
          rows={accessState.adminTeamAccess}
          busyKey={busyKey}
          onClose={() => setAdminAccessTarget(null)}
          onToggle={(team, enabled) => mutate(
            "access",
            enabled
              ? { action: "grant-access", user: adminAccessTarget.userId, teamId: team.id }
              : { action: "revoke-access", user: adminAccessTarget.userId, teamId: team.id },
            {
              busyKey: `admin-access:${adminAccessTarget.userId}:${team.id}`,
              success: enabled ? "Full access granted." : "Full access revoked.",
            },
          )}
        />
      )}

      {confirmAdmin && (
        <ConfirmDialog
          feedback={dialogFeedback}
          title={confirmAdmin.action === "transfer" ? "Transfer Company Ownership?" : "Remove Company Admin?"}
          detail={confirmAdmin.action === "transfer"
            ? `${confirmAdmin.admin.displayName} will become the Company Owner. You will become a Company Admin.`
            : `${confirmAdmin.admin.displayName} will lose Company Admin access. Their direct Team roles will remain.`}
          confirmLabel={confirmAdmin.action === "transfer" ? "Transfer ownership" : "Remove admin"}
          danger={confirmAdmin.action === "remove"}
          busy={busyKey === `${confirmAdmin.action}:${confirmAdmin.admin.userId}`}
          onClose={() => setConfirmAdmin(null)}
          onConfirm={async () => {
            const action = confirmAdmin.action;
            const admin = confirmAdmin.admin;
            const saved = await mutate(
              "memberships",
              { action: action === "transfer" ? "transfer-ownership" : "remove-admin", user: admin.userId },
              {
                busyKey: `${action}:${admin.userId}`,
                success: action === "transfer" ? "Company Ownership transferred." : "Company Admin removed.",
              },
            );
            if (saved) setConfirmAdmin(null);
          }}
        />
      )}
    </section>
  );
}

function CompanyTabs(props: {
  tab: CompanyTab;
  isOwner: boolean;
  pendingCount: number;
  onTab: (tab: CompanyTab) => void;
}) {
  const tabs: Array<{ id: CompanyTab; label: string }> = props.isOwner
    ? [
        { id: "all", label: "All Teams" },
        { id: "requests", label: "Requests" },
        { id: "admins", label: "Company Admins" },
      ]
    : [
        { id: "all", label: "All Teams" },
        { id: "my-access", label: "My Access" },
      ];
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : (index - 1 + tabs.length) % tabs.length;
    props.onTab(tabs[nextIndex].id);
    requestAnimationFrame(() => document.getElementById(`company-tab-${tabs[nextIndex].id}`)?.focus());
  };
  return (
    <div className={styles.tabList} role="tablist" aria-label="Company Teams views">
      {tabs.map((item, index) => (
        <button
          className={styles.tab}
          data-active={props.tab === item.id}
          id={`company-tab-${item.id}`}
          key={item.id}
          type="button"
          role="tab"
          aria-controls={`company-panel-${item.id}`}
          aria-selected={props.tab === item.id}
          tabIndex={props.tab === item.id ? 0 : -1}
          onClick={() => props.onTab(item.id)}
          onKeyDown={(event) => handleKeyDown(event, index)}
        >
          {item.label}
          {item.id === "requests" && props.pendingCount > 0 && (
            <span className={styles.countBadge} aria-label={`${props.pendingCount} pending access requests`}>
              {props.pendingCount > 99 ? "99+" : props.pendingCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function AllTeamsPanel(props: {
  teams: CompanyTeam[];
  totalCount: number;
  loading: boolean;
  isCompanyOwner: boolean;
  query: string;
  statusFilter: CompanyTeamStatusFilter;
  accessFilter: CompanyTeamAccessFilter;
  onQuery: (value: string) => void;
  onStatusFilter: (value: CompanyTeamStatusFilter) => void;
  onAccessFilter: (value: CompanyTeamAccessFilter) => void;
  onCreate: () => void;
  onOpen: (team: CompanyTeam, tab: TeamDialogTab) => void;
  onRequest: (team: CompanyTeam) => void;
}) {
  return (
    <div id="company-panel-all" role="tabpanel" aria-labelledby="company-tab-all">
      <div className={styles.toolbar}>
        <label className={styles.searchControl}>
          <Search size={16} aria-hidden="true" />
          <span className={styles.srOnly}>Search Teams</span>
          <input
            value={props.query}
            onChange={(event) => props.onQuery(event.target.value)}
            placeholder="Search Teams or owners"
          />
        </label>
        <div className={styles.filterGroup}>
          <label className={styles.compactField}>
            <span>Status</span>
            <select
              value={props.statusFilter}
              onChange={(event) => props.onStatusFilter(event.target.value as CompanyTeamStatusFilter)}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className={styles.compactField}>
            <span>Access</span>
            <select
              value={props.accessFilter}
              onChange={(event) => props.onAccessFilter(event.target.value as CompanyTeamAccessFilter)}
            >
              <option value="all">All</option>
              <option value="full">Full access</option>
              <option value="none">No Full access</option>
            </select>
          </label>
        </div>
        <button className={styles.primaryButton} type="button" onClick={props.onCreate}>
          <Plus size={15} />
          Create Team
        </button>
      </div>
      <div className={styles.feedHeading}>
        <span>{props.loading ? "Loading Teams…" : `${props.teams.length} of ${props.totalCount} Teams`}</span>
        <span>Open a row to manage its roster.</span>
      </div>
      {props.loading ? (
        <LoadingRows />
      ) : props.teams.length === 0 ? (
        <EmptyPanel title="No Teams found" detail="Try clearing the search or changing a filter." />
      ) : (
        <div className={styles.feed}>
          {props.teams.map((team) => (
            <TeamFeedRow
              key={team.id}
              team={team}
              isCompanyOwner={props.isCompanyOwner}
              onOpen={props.onOpen}
              onRequest={props.onRequest}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TeamFeedRow(props: {
  team: CompanyTeam;
  isCompanyOwner: boolean;
  onOpen: (team: CompanyTeam, tab: TeamDialogTab) => void;
  onRequest: (team: CompanyTeam) => void;
}) {
  const { team } = props;
  const canManage = props.isCompanyOwner || team.access?.fullAccess === true;
  const ownerLabel = team.owners.length
    ? team.owners.map((owner) => owner.displayName).join(", ")
    : "No active owner";
  return (
    <article className={styles.feedRow} data-archived={team.status === "archived"}>
      <button
        className={styles.teamRowOpenButton}
        type="button"
        onClick={() => props.onOpen(team, "members")}
        aria-label={`Manage ${team.name}`}
      >
        <div className={styles.teamIdentity}>
          <div className={styles.teamMark} aria-hidden="true">{initials(team.name)}</div>
          <div className={styles.teamCopy}>
            <strong className={styles.teamNameText}>{team.name}</strong>
            <span className={styles.slug}>{team.slug}</span>
            <div className={styles.metaLine}>
              <StatusBadge status={team.status} />
              <AccessBadge team={team} />
              <span title={ownerLabel}>{ownerLabel}</span>
              <span>{team.memberCount} {team.memberCount === 1 ? "member" : "members"}</span>
            </div>
          </div>
        </div>
      </button>
      <div className={styles.actionRow}>
        {canManage ? (
          <>
            <button className={styles.secondaryButton} type="button" onClick={() => props.onOpen(team, "members")}>
              <UsersRound size={14} />
              Members
            </button>
            <button className={styles.ghostButton} type="button" onClick={() => props.onOpen(team, "settings")}>
              <Settings2 size={14} />
              Settings
            </button>
          </>
        ) : team.pendingRequest ? (
          <span className={styles.pendingLabel}>Request pending</span>
        ) : team.status === "active" ? (
          <button className={styles.secondaryButton} type="button" onClick={() => props.onRequest(team)}>
            <KeyRound size={14} />
            Request access
          </button>
        ) : (
          <span className={styles.muted}>Archived</span>
        )}
      </div>
    </article>
  );
}

function RequestsPanel(props: {
  requests: CompanyAccessRequest[];
  busyKey: string | null;
  onApprove: (request: CompanyAccessRequest) => Promise<boolean>;
  onDeny: (request: CompanyAccessRequest) => Promise<boolean>;
}) {
  const requests = [...props.requests].sort((left, right) => {
    if ((left.status === "pending") !== (right.status === "pending")) return left.status === "pending" ? -1 : 1;
    return Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? "");
  });
  const pending = requests.filter((request) => request.status === "pending").length;
  return (
    <div id="company-panel-requests" role="tabpanel" aria-labelledby="company-tab-requests">
      <PanelHeading
        icon={<KeyRound size={17} />}
        title="Access requests"
        detail="Approve Full access without changing a person’s direct Team role."
        trailing={<span className={styles.countBadge}>{pending}</span>}
      />
      {requests.length === 0 ? (
        <EmptyPanel title="No access requests" detail="New requests will appear here for review." />
      ) : (
        <div className={styles.feed}>
          {requests.map((request) => (
            <AccessRequestRow
              key={request.id}
              request={request}
              busyKey={props.busyKey}
              onApprove={() => void props.onApprove(request)}
              onDeny={() => void props.onDeny(request)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CompanyAdminsPanel(props: {
  admins: CompanyAdmin[];
  busy: boolean;
  onAdd: () => void;
  onManageAccess: (admin: CompanyAdmin) => void;
  onTransfer: (admin: CompanyAdmin) => void;
  onRemove: (admin: CompanyAdmin) => void;
}) {
  const admins = [...props.admins].sort((left, right) => left.displayName.localeCompare(right.displayName));
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  return (
    <div id="company-panel-admins" role="tabpanel" aria-labelledby="company-tab-admins">
      <PanelHeading
        icon={<ShieldCheck size={17} />}
        title="Company Admins"
        detail="Company roles and direct Team roles stay independent."
        trailing={(
          <button className={styles.primaryButton} type="button" onClick={props.onAdd}>
            <UserPlus size={15} />
            Add Company Admin
          </button>
        )}
      />
      {admins.length === 0 ? (
        <EmptyPanel title="No Company Admins" detail="Add an existing active user to help manage Teams." />
      ) : (
        <div className={styles.feed}>
          {admins.map((admin) => (
            <article className={styles.feedRow} key={admin.userId}>
              <PersonIdentity person={admin} detail={`Company Admin · ${sentenceCase(admin.status)}`} />
              <div className={styles.actionRow}>
                <button className={styles.secondaryButton} type="button" disabled={props.busy} onClick={() => props.onManageAccess(admin)}>
                  <KeyRound size={14} />
                  Team access
                </button>
                <AdminRowMenu
                  id={admin.userId}
                  openMenu={openMenu}
                  setOpenMenu={setOpenMenu}
                  disabled={props.busy}
                  items={[
                    ...(admin.status === "active" ? [{
                      label: "Transfer ownership",
                      icon: <Crown size={14} />,
                      onClick: () => props.onTransfer(admin),
                    }] : []),
                    {
                      label: "Remove",
                      icon: <Trash2 size={14} />,
                      onClick: () => props.onRemove(admin),
                      danger: true,
                    },
                  ]}
                />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function MyAccessPanel(props: {
  access: CompanyAccessState;
  teams: CompanyTeam[];
  busyKey: string | null;
  onCancel: (request: CompanyAccessRequest) => Promise<boolean>;
  onRevoke: (team: CompanyTeam) => Promise<boolean>;
}) {
  const requests = [...props.access.requests].sort((left, right) =>
    Date.parse(right.createdAt ?? "") - Date.parse(left.createdAt ?? ""));
  const accessibleTeams = props.teams.filter((team) =>
    team.access?.fullAccess === true && team.access.source !== "company_owner");
  return (
    <div id="company-panel-my-access" role="tabpanel" aria-labelledby="company-tab-my-access" className={styles.panelStack}>
      <section>
        <PanelHeading
          icon={<KeyRound size={17} />}
          title="My Team access"
          detail="Direct Team roles are included automatically. Company grants can be revoked here."
        />
        {accessibleTeams.length === 0 ? (
          <EmptyPanel title="No Team access yet" detail="Use All Teams to request Full access." />
        ) : (
          <div className={styles.feed}>
            {accessibleTeams.map((team) => {
              const direct = team.access?.source === "membership";
              return (
                <article className={styles.feedRow} key={team.id}>
                  <div className={styles.teamIdentity}>
                    <div className={styles.teamMark} aria-hidden="true">{initials(team.name)}</div>
                    <div className={styles.teamCopy}>
                      <strong>{team.name}</strong>
                      <span className={styles.slug}>{team.slug}</span>
                      <div className={styles.metaLine}><AccessBadge team={team} /><StatusBadge status={team.status} /></div>
                    </div>
                  </div>
                  <div className={styles.actionRow}>
                    {direct ? (
                      <span className={styles.lockedLabel}><LockKeyhole size={13} />Included by direct Team role</span>
                    ) : team.access?.source === "company_grant" ? (
                      <button
                        className={styles.dangerGhostButton}
                        type="button"
                        disabled={props.busyKey !== null}
                        onClick={() => void props.onRevoke(team)}
                      >
                        {props.busyKey === `revoke:${team.id}` ? "Revoking…" : "Revoke access"}
                      </button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section>
        <PanelHeading
          icon={<ShieldCheck size={17} />}
          title="My requests"
          detail="Pending requests can be cancelled before the Company Owner reviews them."
        />
        {requests.length === 0 ? (
          <EmptyPanel title="No access requests" detail="Requests you send will be tracked here." />
        ) : (
          <div className={styles.feed}>
            {requests.map((request) => (
              <AccessRequestRow
                key={request.id}
                request={request}
                busyKey={props.busyKey}
                onCancel={request.status === "pending" ? () => void props.onCancel(request) : undefined}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AccessRequestRow(props: {
  request: CompanyAccessRequest;
  busyKey: string | null;
  onApprove?: () => void;
  onDeny?: () => void;
  onCancel?: () => void;
}) {
  const { request } = props;
  const busy = props.busyKey?.endsWith(`:${request.id}`) === true;
  return (
    <article className={styles.requestRow}>
      <div className={styles.requestTimeline} data-status={request.status} aria-hidden="true" />
      <div className={styles.requestCopy}>
        <div className={styles.requestTitle}>
          <strong>{request.displayName || request.email || "Unknown user"}</strong>
          <span>requested</span>
          <strong>{request.teamName}</strong>
          <RequestStatusBadge status={request.status} />
        </div>
        <div className={styles.requestMeta}>
          <span>{request.reason || "No reason provided"}</span>
          {request.createdAt && <span>Requested {formatDate(request.createdAt)}</span>}
          {request.resolvedAt && <span>Resolved {formatDate(request.resolvedAt)}</span>}
        </div>
      </div>
      <div className={styles.actionRow}>
        {props.onApprove && request.status === "pending" && (
          <button className={styles.primaryButton} type="button" disabled={props.busyKey !== null} onClick={props.onApprove}>
            {busy ? "Updating…" : "Approve"}
          </button>
        )}
        {props.onDeny && request.status === "pending" && (
          <button className={styles.dangerGhostButton} type="button" disabled={props.busyKey !== null} onClick={props.onDeny}>
            Deny
          </button>
        )}
        {props.onCancel && (
          <button className={styles.dangerGhostButton} type="button" disabled={props.busyKey !== null} onClick={props.onCancel}>
            {busy ? "Cancelling…" : "Cancel request"}
          </button>
        )}
      </div>
    </article>
  );
}

function TeamManagementDialog(props: {
  feedback: DialogFeedback;
  team: CompanyTeam | null;
  loading: boolean;
  activeTab: TeamDialogTab;
  busyKey: string | null;
  isCompanyOwner: boolean;
  existingUsers: CompanyPerson[];
  onClose: () => void;
  onTab: (tab: TeamDialogTab) => void;
  onRequest: (team: CompanyTeam) => void;
  onUpdate: (team: CompanyTeam, name: string) => Promise<boolean>;
  onArchive: (team: CompanyTeam) => Promise<boolean>;
  onReactivate: (team: CompanyTeam) => Promise<boolean>;
  onDelete: (team: CompanyTeam) => void;
  onAddMember: (team: CompanyTeam, user: CompanyPerson, role: "member" | "admin") => Promise<boolean>;
  onMemberRole: (team: CompanyTeam, member: CompanyPerson, role: string) => Promise<boolean>;
  onRemoveMember: (team: CompanyTeam, member: CompanyPerson) => void;
  onAddOwner: (team: CompanyTeam, user: CompanyPerson) => Promise<boolean>;
  onRemoveOwner: (team: CompanyTeam, user: CompanyPerson) => void;
}) {
  const [name, setName] = useState("");
  const [memberUserId, setMemberUserId] = useState("");
  const [memberRole, setMemberRole] = useState<"member" | "admin">("member");
  const [ownerUserId, setOwnerUserId] = useState("");
  useEffect(() => {
    setName(props.team?.name ?? "");
    setMemberUserId("");
    setOwnerUserId("");
  }, [props.team?.id, props.team?.name]);

  const team = props.team;
  const canManage = Boolean(team) && (props.isCompanyOwner || team?.access?.fullAccess === true);
  const canManageOwners = Boolean(team) && (
    props.isCompanyOwner
    || (team?.access?.companyRole === "admin" && team.access.fullAccess === true)
  );
  const authorityLocked = team?.status !== "active";
  const activeOwners = team?.owners.filter((owner) => owner.status === "active") ?? [];
  const memberIds = new Set((team?.members ?? []).map((member) => member.userId));
  const ownerIds = new Set(activeOwners.map((owner) => owner.userId));
  const memberCandidates = props.existingUsers.filter((person) =>
    person.status === "active" && !memberIds.has(person.userId) && !ownerIds.has(person.userId));
  const ownerCandidates = uniquePeople([...(team?.members ?? []), ...props.existingUsers]).filter((person) =>
    person.status === "active" && !ownerIds.has(person.userId));

  return (
    <AccessibleDialog
      title={team?.name ?? "Team details"}
      detail={team ? `${team.slug} · ${accessLabel(team.access)}` : "Loading the Team roster and settings."}
      feedback={props.feedback}
      onClose={props.onClose}
      wide
    >
      {props.loading ? (
        <LoadingRows count={3} />
      ) : !team ? (
        <EmptyPanel title="Team unavailable" detail="It may have been removed or your access may have changed." />
      ) : !canManage ? (
        <div className={styles.accessCallout}>
          <div>
            <strong>Full access required</strong>
            <p>Ask the Company Owner for Full access to manage this Team.</p>
          </div>
          {team.pendingRequest ? (
            <span className={styles.pendingLabel}>Request pending</span>
          ) : team.status === "active" ? (
            <button className={styles.primaryButton} type="button" onClick={() => props.onRequest(team)}>Request access</button>
          ) : null}
        </div>
      ) : (
        <>
          <DialogTabs
            active={props.activeTab}
            tabs={[
              { id: "members", label: `Members (${team.memberCount})`, icon: <UsersRound size={15} /> },
              { id: "settings", label: "Settings", icon: <Settings2 size={15} /> },
            ]}
            onTab={(next) => props.onTab(next as TeamDialogTab)}
          />
          {props.activeTab === "members" ? (
            <div className={styles.dialogSectionStack} role="tabpanel" id="team-dialog-panel-members" aria-labelledby="team-dialog-tab-members">
              <section className={styles.formSurface}>
                <PanelHeading
                  icon={<UserPlus size={17} />}
                  title="Add an existing user"
                  detail="Only active people already in this AI-OS account can be added."
                />
                {authorityLocked ? (
                  <div className={styles.warningBanner} role="status">
                    Reactivate this Team before changing members or direct Team roles.
                  </div>
                ) : (
                  <div className={styles.inlineForm}>
                    <ExistingUserCombobox
                      label="Person"
                      options={memberCandidates}
                      value={memberUserId}
                      onChange={setMemberUserId}
                      placeholder="Search by name or email"
                    />
                    <label className={styles.field}>
                      <span>Team role</span>
                      <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as "member" | "admin")}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <button
                      className={styles.primaryButton}
                      type="button"
                      disabled={!memberUserId || props.busyKey !== null}
                      onClick={() => {
                        const user = memberCandidates.find((person) => person.userId === memberUserId);
                        if (user) void props.onAddMember(team, user, memberRole).then((saved) => {
                          if (saved) setMemberUserId("");
                        });
                      }}
                    >
                      Add member
                    </button>
                  </div>
                )}
              </section>
              <section>
                <PanelHeading
                  icon={<UsersRound size={17} />}
                  title="Team roster"
                  detail="Company access is shown with direct Team membership."
                />
                {team.members.length === 0 ? (
                  <EmptyPanel title="No members found" detail="Add an existing active user above." />
                ) : (
                  <div className={styles.peopleList}>
                    {team.members.map((member) => {
                      const isOwner = member.role === "owner";
                      const protectedAccess = member.protected
                        || member.accessSource === "company_owner"
                        || member.accessSource === "company_grant";
                      return (
                        <div className={styles.personRow} key={member.userId}>
                          <PersonIdentity
                            person={member}
                            detail={protectedAccess ? "Included by company access" : `Direct Team ${member.role || "member"}`}
                          />
                          <div className={styles.actionRow}>
                            {isOwner ? (
                              <span className={styles.lockedLabel}><Crown size={13} />Team Owner</span>
                            ) : protectedAccess ? (
                              <span className={styles.lockedLabel}><LockKeyhole size={13} />Included · Locked</span>
                            ) : authorityLocked ? (
                              <span className={styles.lockedLabel}><Archive size={13} />Archived · Locked</span>
                            ) : (
                              <>
                                <label className={styles.srOnly} htmlFor={`role-${member.userId}`}>Role for {member.displayName}</label>
                                <select
                                  className={styles.compactSelect}
                                  id={`role-${member.userId}`}
                                  value={member.role || "member"}
                                  disabled={props.busyKey !== null}
                                  onChange={(event) => void props.onMemberRole(team, member, event.target.value)}
                                >
                                  <option value="member">Member</option>
                                  <option value="admin">Admin</option>
                                </select>
                                <button
                                  className={styles.dangerGhostButton}
                                  type="button"
                                  disabled={props.busyKey !== null}
                                  onClick={() => void props.onRemoveMember(team, member)}
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <div className={styles.dialogSectionStack} role="tabpanel" id="team-dialog-panel-settings" aria-labelledby="team-dialog-tab-settings">
              <section className={styles.formSurface}>
                <PanelHeading
                  icon={<Settings2 size={17} />}
                  title="Team settings"
                  detail="The slug is a permanent workspace identifier."
                  trailing={<StatusBadge status={team.status} />}
                />
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Name</span>
                    <input value={name} onChange={(event) => setName(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Slug</span>
                    <input className={styles.monoInput} value={team.slug} readOnly />
                  </label>
                </div>
                <div className={styles.actionRow}>
                  <button
                    className={styles.primaryButton}
                    type="button"
                    disabled={!name.trim() || name.trim() === team.name || props.busyKey !== null}
                    onClick={() => void props.onUpdate(team, name.trim())}
                  >
                    Save name
                  </button>
                  {team.status === "active" ? (
                    <button className={styles.warningButton} type="button" disabled={props.busyKey !== null} onClick={() => void props.onArchive(team)}>
                      <Archive size={14} />Archive
                    </button>
                  ) : (
                    <button className={styles.secondaryButton} type="button" disabled={props.busyKey !== null} onClick={() => void props.onReactivate(team)}>
                      <Check size={14} />Reactivate
                    </button>
                  )}
                  {props.isCompanyOwner && canPermanentlyDeleteTeam(team) && (
                    <button className={styles.dangerButton} type="button" disabled={props.busyKey !== null} onClick={() => props.onDelete(team)}>
                      <Trash2 size={14} />Delete permanently
                    </button>
                  )}
                </div>
              </section>
              <section className={styles.formSurface}>
                <PanelHeading
                  icon={<Crown size={17} />}
                  title="Team Owners"
                  detail="Every Team must keep at least one active owner."
                />
                <div className={styles.peopleList}>
                  {activeOwners.map((owner) => (
                    <div className={styles.personRow} key={owner.userId}>
                      <PersonIdentity person={owner} detail="Team Owner" />
                      {canManageOwners && !authorityLocked && activeOwners.length > 1 ? (
                        <button className={styles.dangerGhostButton} type="button" disabled={props.busyKey !== null} onClick={() => void props.onRemoveOwner(team, owner)}>
                          Change role
                        </button>
                      ) : (
                        <span className={styles.lockedLabel}>
                          <LockKeyhole size={13} />
                          {authorityLocked ? "Archived" : activeOwners.length === 1 ? "Required" : "Protected"}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {canManageOwners && !authorityLocked && (
                  <div className={styles.inlineForm}>
                    <ExistingUserCombobox
                      label="Add Team Owner"
                      options={ownerCandidates}
                      value={ownerUserId}
                      onChange={setOwnerUserId}
                      placeholder="Search existing users"
                    />
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      disabled={!ownerUserId || props.busyKey !== null}
                      onClick={() => {
                        const user = ownerCandidates.find((person) => person.userId === ownerUserId);
                        if (user) void props.onAddOwner(team, user).then((saved) => {
                          if (saved) setOwnerUserId("");
                        });
                      }}
                    >
                      Add owner
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </>
      )}
    </AccessibleDialog>
  );
}

function CreateTeamDialog(props: {
  feedback: DialogFeedback;
  users: CompanyPerson[];
  busy: boolean;
  onClose: () => void;
  onCreate: (input: { name: string; slug: string; ownerUserId: string }) => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [ownerUserId, setOwnerUserId] = useState("");
  const users = props.users.filter((user) => user.status === "active");
  return (
    <AccessibleDialog
      title="Create Team"
      detail="Start a Team with one existing active user as its owner."
      feedback={props.feedback}
      onClose={props.onClose}
    >
      <div className={styles.formGrid}>
        <label className={styles.field}>
          <span>Name</span>
          <input
            data-dialog-autofocus="true"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (!slugTouched) setSlug(slugifyTeamName(event.target.value));
            }}
          />
        </label>
        <label className={styles.field}>
          <span>Slug</span>
          <input
            className={styles.monoInput}
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(slugifyTeamName(event.target.value));
            }}
          />
          <small>The slug cannot be changed after creation.</small>
        </label>
      </div>
      <ExistingUserCombobox
        label="Initial Team Owner"
        options={users}
        value={ownerUserId}
        onChange={setOwnerUserId}
        placeholder="Search existing users"
      />
      {users.length === 0 && <div className={styles.warningBanner} role="alert">No eligible active users are available.</div>}
      <DialogActions>
        <button className={styles.secondaryButton} type="button" onClick={props.onClose}>Cancel</button>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={props.busy || !name.trim() || !slug || !ownerUserId}
          onClick={() => props.onCreate({ name: name.trim(), slug, ownerUserId })}
        >
          {props.busy ? "Creating…" : "Create Team"}
        </button>
      </DialogActions>
    </AccessibleDialog>
  );
}

function AddCompanyAdminDialog(props: {
  feedback: DialogFeedback;
  users: CompanyPerson[];
  admins: CompanyAdmin[];
  busy: boolean;
  onClose: () => void;
  onAdd: (user: CompanyPerson) => void;
}) {
  const [userId, setUserId] = useState("");
  const adminIds = new Set(props.admins.filter((admin) => admin.status !== "removed").map((admin) => admin.userId));
  const candidates = props.users.filter((user) => user.status === "active" && !adminIds.has(user.userId));
  const selected = candidates.find((user) => user.userId === userId);
  return (
    <AccessibleDialog
      title="Add Company Admin"
      detail="Promote an existing active user. Their direct Team memberships will stay unchanged."
      feedback={props.feedback}
      onClose={props.onClose}
    >
      <ExistingUserCombobox
        label="Existing user"
        options={candidates}
        value={userId}
        onChange={setUserId}
        placeholder="Search by name or email"
        autoFocus
      />
      {candidates.length === 0 && <div className={styles.infoBanner}>Every eligible active user is already a Company Admin.</div>}
      <DialogActions>
        <button className={styles.secondaryButton} type="button" onClick={props.onClose}>Cancel</button>
        <button className={styles.primaryButton} type="button" disabled={!selected || props.busy} onClick={() => selected && props.onAdd(selected)}>
          {props.busy ? "Adding…" : "Add Company Admin"}
        </button>
      </DialogActions>
    </AccessibleDialog>
  );
}

function CompanyAdminAccessDialog(props: {
  feedback: DialogFeedback;
  admin: CompanyAdmin;
  teams: CompanyTeam[];
  rows: CompanyAdminTeamAccess[];
  busyKey: string | null;
  onClose: () => void;
  onToggle: (team: CompanyTeam, enabled: boolean) => Promise<boolean>;
}) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const teams = props.teams.filter((team) => !term || `${team.name} ${team.slug}`.toLowerCase().includes(term));
  return (
    <AccessibleDialog
      title={`Team access · ${props.admin.displayName}`}
      detail="Changes apply immediately. Direct Team Owner and Team Admin roles are included and locked."
      feedback={props.feedback}
      onClose={props.onClose}
      wide
    >
      <label className={styles.searchControl}>
        <Search size={16} aria-hidden="true" />
        <span className={styles.srOnly}>Search Teams</span>
        <input
          data-dialog-autofocus="true"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Teams"
        />
      </label>
      {teams.length === 0 ? (
        <EmptyPanel title="No Teams found" detail="Try a different search." />
      ) : (
        <div className={styles.accessList}>
          {teams.map((team) => {
            const row = props.rows.find((item) => item.userId === props.admin.userId && item.teamId === team.id);
            const direct = row?.source === "team_owner" || row?.source === "team_admin";
            const granted = row?.source === "company_grant";
            const archived = team.status === "archived";
            const accessLocked = direct || archived;
            const busyKey = `admin-access:${props.admin.userId}:${team.id}`;
            const busy = props.busyKey === busyKey;
            const accessSourceLabel = row?.source === "team_owner"
              ? "Included as Team Owner · Locked"
              : row?.source === "team_admin"
                ? "Included as Team Admin · Locked"
                : granted
                  ? "Company Full access"
                  : "No Full access";
            const sourceLabel = archived ? `${accessSourceLabel} · Archived` : accessSourceLabel;
            return (
              <label className={styles.accessToggleRow} key={team.id} data-locked={accessLocked}>
                <div className={styles.teamIdentity}>
                  <div className={styles.teamMark} aria-hidden="true">{initials(team.name)}</div>
                  <div className={styles.teamCopy}>
                    <strong>{team.name}</strong>
                    <span className={styles.slug}>{team.slug}</span>
                    <span className={accessLocked ? styles.lockedLabel : styles.muted}>
                      {accessLocked && <LockKeyhole size={12} />}
                      {busy ? "Updating…" : sourceLabel}
                    </span>
                  </div>
                </div>
                <span className={styles.switchControl}>
                  <input
                    className={styles.switchInput}
                    type="checkbox"
                    checked={Boolean(direct || granted)}
                    disabled={Boolean(direct || archived || props.busyKey)}
                    onChange={(event) => void props.onToggle(team, event.target.checked)}
                    aria-label={`Full access to ${team.name}`}
                  />
                  <span className={styles.switchTrack} aria-hidden="true"><span /></span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </AccessibleDialog>
  );
}

function RequestAccessDialog(props: {
  feedback: DialogFeedback;
  team: CompanyTeam;
  busy: boolean;
  onClose: () => void;
  onRequest: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <AccessibleDialog
      title={`Request access to ${props.team.name}`}
      detail="The optional reason will be shown to the Company Owner."
      feedback={props.feedback}
      onClose={props.onClose}
    >
      <label className={styles.field}>
        <span>Reason (optional)</span>
        <textarea
          data-dialog-autofocus="true"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
        />
      </label>
      <DialogActions>
        <button className={styles.secondaryButton} type="button" onClick={props.onClose}>Cancel</button>
        <button className={styles.primaryButton} type="button" disabled={props.busy} onClick={() => props.onRequest(reason.trim())}>
          {props.busy ? "Sending…" : "Request access"}
        </button>
      </DialogActions>
    </AccessibleDialog>
  );
}

function DeleteTeamDialog(props: {
  feedback: DialogFeedback;
  team: CompanyTeam;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [secondStep, setSecondStep] = useState(false);
  const exact = confirmation === props.team.name;
  return (
    <AccessibleDialog
      title={`Delete ${props.team.name}`}
      detail="This permanently removes active Team data. Backups keep their normal retention."
      feedback={props.feedback}
      onClose={props.onClose}
      alert
    >
      <div className={styles.dangerBanner}>
        <strong>This cannot be undone.</strong>
        <span>Type the exact Team name, then confirm once more.</span>
      </div>
      <label className={styles.field}>
        <span>Team name</span>
        <input
          data-dialog-autofocus="true"
          value={confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
            setSecondStep(false);
          }}
        />
      </label>
      {secondStep && <div className={styles.warningBanner} role="alert">Final confirmation: permanently delete this Team?</div>}
      <DialogActions>
        <button className={styles.secondaryButton} type="button" onClick={props.onClose}>Cancel</button>
        {secondStep ? (
          <button className={styles.dangerButton} type="button" disabled={props.busy} onClick={props.onDelete}>
            {props.busy ? "Deleting…" : "Yes, permanently delete"}
          </button>
        ) : (
          <button className={styles.dangerButton} type="button" disabled={!exact} onClick={() => setSecondStep(true)}>Continue</button>
        )}
      </DialogActions>
    </AccessibleDialog>
  );
}

function ChangeTeamOwnerRoleDialog(props: {
  feedback: DialogFeedback;
  team: CompanyTeam;
  owner: CompanyPerson;
  busy: boolean;
  onClose: () => void;
  onConfirm: (replacementRole: "member" | "admin") => void;
}) {
  const [replacementRole, setReplacementRole] = useState<"member" | "admin">("admin");
  return (
    <AccessibleDialog
      title={`Change ${props.owner.displayName}’s role?`}
      detail={`${props.owner.displayName} will stop being a Team Owner in ${props.team.name}. The Team will keep its other active owner.`}
      feedback={props.feedback}
      onClose={props.onClose}
      alert
    >
      <label className={styles.field}>
        <span>New direct Team role</span>
        <select
          data-dialog-autofocus="true"
          value={replacementRole}
          disabled={props.busy}
          onChange={(event) => setReplacementRole(event.target.value as "member" | "admin")}
        >
          <option value="admin">Team Admin</option>
          <option value="member">Team Member</option>
        </select>
      </label>
      <DialogActions>
        <button className={styles.secondaryButton} type="button" disabled={props.busy} onClick={props.onClose}>Cancel</button>
        <button className={styles.warningButton} type="button" disabled={props.busy} onClick={() => props.onConfirm(replacementRole)}>
          {props.busy ? "Updating…" : "Change role"}
        </button>
      </DialogActions>
    </AccessibleDialog>
  );
}

function ConfirmDialog(props: {
  feedback: DialogFeedback;
  title: string;
  detail: string;
  confirmLabel: string;
  danger?: boolean;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <AccessibleDialog
      title={props.title}
      detail={props.detail}
      feedback={props.feedback}
      onClose={props.onClose}
      alert
    >
      <DialogActions>
        <button className={styles.secondaryButton} type="button" onClick={props.onClose}>Cancel</button>
        <button
          className={props.danger ? styles.dangerButton : styles.primaryButton}
          data-dialog-autofocus="true"
          type="button"
          disabled={props.busy}
          onClick={props.onConfirm}
        >
          {props.busy ? "Updating…" : props.confirmLabel}
        </button>
      </DialogActions>
    </AccessibleDialog>
  );
}

function ExistingUserCombobox(props: {
  label: string;
  options: CompanyPerson[];
  value: string;
  onChange: (userId: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listboxRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const selected = props.options.find((person) => person.userId === props.value);
  const term = query.trim().toLowerCase();
  const filtered = filterExistingUsers(props.options, query);
  const showResults = open && term.length > 0;

  useEffect(() => {
    if (!props.value) setQuery("");
    else if (selected) setQuery(selected.displayName);
  }, [props.value, selected?.displayName]);

  useEffect(() => {
    if (!showResults) return;
    const frame = window.requestAnimationFrame(() => {
      listboxRef.current?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [showResults, query]);

  const select = (person: CompanyPerson) => {
    props.onChange(person.userId);
    setQuery(person.displayName);
    setOpen(false);
    setActiveIndex(0);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (!filtered.length) return;
      setActiveIndex((current) => event.key === "ArrowDown"
        ? (current + 1) % filtered.length
        : (current - 1 + filtered.length) % filtered.length);
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      select(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      if (showResults) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    }
  };

  return (
    <div
      className={styles.comboboxField}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <label htmlFor={inputId}>{props.label}</label>
      <div className={styles.combobox} ref={rootRef}>
        <Search size={15} aria-hidden="true" />
        <input
          id={inputId}
          data-dialog-autofocus={props.autoFocus ? "true" : undefined}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showResults}
          aria-controls={showResults ? listboxId : undefined}
          aria-activedescendant={showResults && filtered[activeIndex] ? `${listboxId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={query}
          placeholder={props.placeholder}
          onFocus={() => {
            setOpen(Boolean(query.trim()) && !props.value);
            setActiveIndex(0);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            props.onChange("");
            setActiveIndex(0);
            setOpen(Boolean(event.target.value.trim()));
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      {showResults && (
        <div className={styles.listbox} id={listboxId} ref={listboxRef} role="listbox">
          {filtered.length === 0 ? (
            <div className={styles.noOptions}>No matching active users</div>
          ) : filtered.map((person, index) => (
            <div
              className={styles.option}
              data-active={index === activeIndex}
              id={`${listboxId}-${index}`}
              key={person.userId}
              role="option"
              aria-selected={props.value === person.userId}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                select(person);
              }}
            >
              <span className={styles.avatar} aria-hidden="true">{initials(person.displayName)}</span>
              <span><strong>{person.displayName}</strong><small>{person.email}</small></span>
              {props.value === person.userId && <Check size={15} aria-hidden="true" />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminRowMenu(props: {
  id: string;
  openMenu: string | null;
  setOpenMenu: (id: string | null) => void;
  disabled: boolean;
  items: Array<{ label: string; icon: ReactNode; onClick: () => void; danger?: boolean }>;
}) {
  const open = props.openMenu === props.id;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const menuHeight = props.items.length * 38 + 12;
      const openAbove = rect.bottom + menuHeight + 12 > window.innerHeight;
      setPosition({
        top: Math.max(12, Math.round(openAbove ? rect.top - menuHeight - 6 : rect.bottom + 6)),
        left: Math.min(window.innerWidth - 202, Math.max(12, Math.round(rect.right - 190))),
      });
    };
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (buttonRef.current?.contains(target) || menuRef.current?.contains(target))) return;
      props.setOpenMenu(null);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      props.setOpenMenu(null);
      buttonRef.current?.focus();
    };
    updatePosition();
    requestAnimationFrame(() => menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open, props.id, props.items.length, props.setOpenMenu]);

  const menu = open && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={menuRef}
        className={styles.rowMenu}
        role="menu"
        aria-label="Company Admin actions"
        style={{ top: position.top, left: position.left }}
      >
        {props.items.map((item) => (
          <button
            className={item.danger ? `${styles.rowMenuItem} ${styles.rowMenuItemDanger}` : styles.rowMenuItem}
            key={item.label}
            type="button"
            role="menuitem"
            onClick={() => {
              props.setOpenMenu(null);
              item.onClick();
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>,
      document.body,
    )
    : null;

  return (
    <>
      <button
        ref={buttonRef}
        className={styles.iconButton}
        type="button"
        disabled={props.disabled}
        aria-label="Open Company Admin actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => props.setOpenMenu(open ? null : props.id)}
      >
        <MoreVertical size={16} />
      </button>
      {menu}
    </>
  );
}

function DialogTabs(props: {
  active: string;
  tabs: Array<{ id: string; label: string; icon: ReactNode }>;
  onTab: (id: string) => void;
}) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? props.tabs.length - 1
        : event.key === "ArrowRight"
          ? (index + 1) % props.tabs.length
          : (index - 1 + props.tabs.length) % props.tabs.length;
    props.onTab(props.tabs[nextIndex].id);
    requestAnimationFrame(() => document.getElementById(`team-dialog-tab-${props.tabs[nextIndex].id}`)?.focus());
  };
  return (
    <div className={styles.dialogTabs} role="tablist" aria-label="Team management">
      {props.tabs.map((tab, index) => (
        <button
          id={`team-dialog-tab-${tab.id}`}
          className={styles.dialogTab}
          data-active={props.active === tab.id}
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.active === tab.id}
          aria-controls={`team-dialog-panel-${tab.id}`}
          tabIndex={props.active === tab.id ? 0 : -1}
          onClick={() => props.onTab(tab.id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {tab.icon}{tab.label}
        </button>
      ))}
    </div>
  );
}

function AccessibleDialog(props: {
  title: string;
  detail: string;
  feedback?: DialogFeedback;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  alert?: boolean;
}) {
  const titleId = useId();
  const detailId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>('[data-dialog-autofocus="true"]')?.focus();
      if (document.activeElement === previous) (focusable()[0] ?? dialog)?.focus();
    });
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => previous?.focus());
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={props.wide ? `${styles.dialog} ${styles.dialogWide}` : styles.dialog}
        role={props.alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={detailId}
        tabIndex={-1}
      >
        <header className={styles.dialogHeader}>
          <div>
            <h4 id={titleId}>{props.title}</h4>
            <p id={detailId}>{props.detail}</p>
          </div>
          <button className={styles.iconButton} type="button" onClick={props.onClose} aria-label="Close dialog" title="Close">
            <X size={17} />
          </button>
        </header>
        <div className={styles.dialogBody}>
          {props.feedback?.error && <div className={styles.errorBanner} role="alert">{props.feedback.error}</div>}
          {props.feedback?.notice && (
            <div className={styles.noticeBanner} role="status" aria-live="polite">{props.feedback.notice}</div>
          )}
          {props.children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PanelHeading(props: { icon: ReactNode; title: string; detail: string; trailing?: ReactNode }) {
  return (
    <div className={styles.panelHeading}>
      <div className={styles.panelHeadingIcon} aria-hidden="true">{props.icon}</div>
      <div className={styles.panelHeadingCopy}>
        <h4>{props.title}</h4>
        <p>{props.detail}</p>
      </div>
      {props.trailing && <div className={styles.panelHeadingTrailing}>{props.trailing}</div>}
    </div>
  );
}

function PersonIdentity({ person, detail }: { person: CompanyPerson; detail: string }) {
  return (
    <div className={styles.personIdentity}>
      <span className={styles.avatar} aria-hidden="true">{initials(person.displayName)}</span>
      <span>
        <strong>{person.displayName}</strong>
        <small>{person.email || person.userId}</small>
        <small>{detail}</small>
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return <span className={styles.statusBadge} data-status={status}>{sentenceCase(status)}</span>;
}

function RequestStatusBadge({ status }: { status: string }) {
  return <span className={styles.requestBadge} data-status={status}>{sentenceCase(status)}</span>;
}

function AccessBadge({ team }: { team: CompanyTeam }) {
  return <span className={styles.accessBadge} data-full={team.access?.fullAccess === true}>{accessLabel(team.access)}</span>;
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return <div className={styles.emptyPanel}><strong>{title}</strong><span>{detail}</span></div>;
}

function LoadingRows({ count = 4 }: { count?: number }) {
  return (
    <div className={styles.loadingList} aria-label="Loading">
      {Array.from({ length: count }, (_, index) => <div className={styles.loadingRow} key={index} />)}
    </div>
  );
}

function DialogActions({ children }: { children: ReactNode }) {
  return <div className={styles.dialogActions}>{children}</div>;
}

async function fetchCompanyJson(endpoint: CompanyEndpoint, teamId?: string): Promise<unknown> {
  const query = teamId ? `?${new URLSearchParams({ teamId }).toString()}` : "";
  const response = await fetch(`/api/company/${endpoint}${query}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Company ${endpoint} unavailable`);
  return body;
}

async function postCompanyJson(endpoint: CompanyEndpoint, action: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`/api/company/${endpoint}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(action),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Company action failed");
  return body;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function mergeAdmins(...groups: CompanyAdmin[][]): CompanyAdmin[] {
  const byId = new Map<string, CompanyAdmin>();
  for (const admin of groups.flat()) {
    const key = admin.userId || admin.email;
    byId.set(key, { ...byId.get(key), ...admin });
  }
  return [...byId.values()];
}

function uniquePeople(people: CompanyPerson[]): CompanyPerson[] {
  const byId = new Map<string, CompanyPerson>();
  for (const person of people) byId.set(person.userId || person.email, person);
  return [...byId.values()];
}

function initials(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "T";
}

function sentenceCase(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1).replaceAll("_", " ") : "Unknown";
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
