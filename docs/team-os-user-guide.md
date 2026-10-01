# Team OS User Guide

Team OS lets one account work with more than one Team while keeping each piece
of work in its original Team and client. This guide covers the normal workflow
in Command Centre, safe account handoff on a shared computer, and recovery when
the connection or local profile needs attention.

## What Team OS Changes

- One Team OS account can belong to several Teams.
- Each server has one Company Owner and may have several Company Admins.
- One local profile keeps that account's Command Centre history across those
  Teams and their granted clients.
- The selected Team controls the dashboard and is the default for new work.
- Existing chats, tasks, terminals, branches, and agents keep the Team and
  client they had when they were created.

Selecting another Team never moves old work. Team switching is also different
from account switching: one local Command Centre installation has one active
human account at a time.

## Before You Sign In

Ask your manager for:

- the Team OS server URL;
- your email and password; and
- an initial Team slug, if your organization uses one.

Your manager must also give you the Team memberships and client, skill, and
secret grants needed for your work. Local folders do not grant Team OS access.

## Sign In From Command Centre

1. Start Command Centre and open it in your browser.
2. Select the Team control in the top-right corner.
3. Select **Sign in**.
4. Enter the server URL, email, password, and optional Team slug.
5. Wait for the control to show **Connected**.

The selected Team appears in the same control. If the account belongs to more
than one active Team, the popover also shows **Switch team**.

A Company Admin may be connected without access to any Team. In that case, the
control still shows **Connected**, with **No Team access** below it. The admin
can open **Teams** and request access.

## Optional Terminal Login

From the repository's **command-centre** directory, run:

~~~powershell
npm run team -- login --api-url <TEAM_OS_API_URL> --email <EMAIL> --password "<PASSWORD>" [--team <TEAM>]
~~~

Running the command without an action opens the guided menu:

~~~powershell
npm run team
~~~

Useful checks:

~~~powershell
npm run team -- status
npm run team -- whoami
npm run team -- clients
npm run team -- logout
~~~

The terminal and Command Centre use the same saved Team OS login when they use
the same configuration directory. Do not paste passwords or saved tokens into
committed files, tickets, or chat messages.

## Move Between Teams

1. Open the top-right Team control.
2. Under **Switch team**, select the Team you want.
3. Wait for the selected Team, dashboard, and client choices to refresh.

The new selection is a default for work you create next. It does not change
work that already exists.

For example, suppose Team A is selected when you start a chat. You later switch
to Team B. New work starts under Team B, but reopening the old chat continues it
under Team A. Team B stays selected for the dashboard and other new work.

## Find and Continue Existing Work

The Feed shows the active account's local chat history across its Teams and
clients.

- Use **Search chats** to find a conversation by its content or title.
- Use **All Teams** to show every Team, or choose one Team.
- Use **All clients** to show every client, or choose one client.
- Team badges identify history outside the currently selected Team when the
  distinction matters.

Opening old work does not change the selected Team and does not rewrite the
work's original Team or client. An account never sees another account's local
profile history through this unified view.

## Manage a Team

Open the Team tab after choosing the Team you want to manage.

| Section | What it is for |
|---|---|
| **Dashboard** | Check the current Team, connection, and activity summary. |
| **Members** | Invite members and manage membership. This is an owner/admin flow. |
| **Clients** | Create clients and grant or remove client access. |
| **Memories** | Review and manage shared Team memory. This is an owner/admin flow. |
| **Secrets** | Manage Team secrets and decide who can use them. |
| **Skills** | Grant skill use or editing rights. |

What a member can see or do depends on current server grants. Removing a grant
takes effect on the next protected request. Cached local files or an old browser
tab must not widen access.

Company-level access also appears in **Members**. It is shown as **Admin** with
the note **Protected by company access**. Those controls are locked because the
access must be changed from the company-level **Teams** section.

## Manage Company Teams

The **Teams** section is visible only to the Company Owner and Company Admins.
It has two tabs:

- **All Teams** lists active and archived Teams. Use it to search, create a Team,
  open its details, edit its name, or manage members and Team Owners.
- **Access** shows access requests. The Company Owner can approve or deny a
  request and can grant several Teams to one Company Admin at once.

Company roles and Team roles are separate. The Company Owner has Full access to
every Team. A Company Admin has Full access after receiving a company grant,
creating the Team, or holding an active Team Owner or Team Admin membership.
A normal Team membership can still provide member access without Full access.

When the Company Owner adds an admin:

- an existing platform account is promoted immediately, without changing its
  password or creating an invitation;
- a person who does not have a platform account receives a copyable invitation
  link and creates the account from that page.

Team slugs are set during creation and cannot be changed later. A Team must keep
at least one active Team Owner. Archiving blocks new Team access and cancels
pending requests, but keeps grants ready for reactivation. After 30 days, the
Company Owner may permanently delete the Team by typing its exact name and
confirming a second time.

### Recover a missing Company Owner

Use the recovery command only when the company has no active Owner. Choose an
active account that can already sign in:

~~~powershell
npm run company:owner-recover -- --user <EMAIL_OR_USER_ID>
~~~

The command refuses to replace an existing Company Owner. Normal ownership
changes belong in **Teams**, where ownership transfers only to an active Company
Admin and the previous Owner keeps explicit Full access to every Team.

## Share One Local Installation Safely

Only one human account can be active in a local Command Centre installation.
To hand the app from user A to user B:

1. User A opens the top-right Team control and selects **Sign out**.
2. Wait for the app to return to **Disconnected** or ask for a refresh after
   secure cleanup.
3. Refresh any older browser tabs.
4. User B signs in with their own server and account details.

Do not use **Switch team** for this handoff. It changes Team scope for the same
account; it does not change the person who is signed in.

If an old tab reports that its session is stale, refresh it. The tab must follow
the currently active account and cannot keep using the previous profile.

## Sign Out and Return Later

Signing out stops the departing profile's agents, terminals, watchers, and new
local access. It also clears temporary working data and managed credentials.

| Kept for the same local profile | Removed or stopped at sign-out |
|---|---|
| Durable chat and task history | Running agents, terminals, and watchers |
| Sent chat attachments | Draft messages and goal drafts |
| Original Team and client scope on old work | Unsent attachments |
| Local history for all Teams used by that account | Temporary context overlays and managed credentials |

To return later, sign in to the same Team OS server with the same account.
Durable history and sent attachments return on that installation. Drafts,
unsent attachments, previous processes, and the old browser session do not.

This is local profile recovery, not cross-device chat sync. Chat sync across
different computers is a separate project.

## Connection and Recovery States

| State or symptom | What it means | Safe action |
|---|---|---|
| **Disconnected** | No Team OS account is active. | Select **Sign in** and use the server and account details from your manager. |
| **Connected** | The login and selected Team are valid. | Work normally or use **Switch team**. |
| **Unavailable** | The saved account is known, but the server cannot be reached. | Keep the profile, check the connection or server, and retry later. Do not start new Team work from stale context. |
| **Access blocked** | The account is signed in, but the selected Team membership is suspended, revoked, or unavailable. | Ask an owner/admin to restore access, switch to another authorized Team if offered, or sign out. |
| **Reconnect required** | Saved login data is expired, incomplete, or damaged, or safe profile details must be refreshed. | Select **Reconnect** and sign in to the same server and account. |
| **Profile repair required** | The local profile database is missing or its migration failed. | Stop using the profile, preserve the local **.command-centre** data, restore it from a private machine backup if available, or contact support. |
| Secure cleanup is still pending | Sign-out or account replacement left cleanup work to retry. | Restart Command Centre or sign in again. Startup and login retry cleanup before access is restored. |
| An older tab reports a stale session | Another login, logout, or local profile session replaced that tab. | Refresh the page and continue only under the active account. |
| An existing chat cannot refresh Team access | The server, Team membership, or client grant cannot be confirmed. | Continue only if Command Centre offers conversation-only mode. Local installation skills and the last authorized Team skill copy remain usable; fresh Team context, memory, secrets, grants, and sync stay unavailable. |

**Reconnect** does not repair a missing local database or recreate lost local
history. Do not delete the profile registry or adopt another profile as a
shortcut. Preserve the data and use a private backup or the normal support
path.

During an outage, Team OS does not use stale Team context or silently convert
Team work to Solo. An existing chat may continue only in explicit
conversation-only mode from its saved conversation.

## Solo Mode and Older Data

When no Team OS account is active, AI-OS continues to work in Solo mode.
Existing Solo clients and older unscoped data remain separate.

- Signing in does not assign old Solo work to a Team user.
- Team history is not copied into Solo at sign-out.
- A Team OS failure never falls back to Solo with stale Team data.
- Local profile isolation is enforced by the application. It is not disk
  encryption or operating-system user isolation.

If you are moving approved Solo context into Team OS, sign in first and use the
documented import command from **command-centre**:

~~~powershell
npm run context:import
~~~

## Skills in Team chats

The local AI-OS skill pack is always present in Chat UI. Team OS adds a
separate Team version when the current member has access; it does not move or
replace the local folder.

- `/skill-name` uses the Team version when both versions are available.
- `/team:skill-name` requests the Team version explicitly.
- `/local:skill-name` requests the installation or active-client version.
- Client-only skills appear only in that client's chats.
- `SKILL.local.md` stays on this installation and customizes the selected
  version. It cannot expand the Team or client scope of a chat.

In **Team → Skills**, local and Team entries are shown separately. Team copies
can be synced, updated, pushed, or removed according to Team permissions. A
revocation removes only the Team execution copy. Server-only updates are
applied automatically before the next response; if both copies changed, the
last working copy is kept until a person confirms which whole side wins.

## Memory and Sync

The Team OS server decides the active account, Team memberships, client access,
skills, secrets, and shared memory access. The local app uses the current
server-approved snapshot for new Team work. It does not infer access from local
paths.

To refresh a connected workspace from current server data, run:

~~~powershell
npm run context:sync
~~~

If the server is unavailable, Team memory search and Team context refresh fail
clearly instead of using stale local private files.

Advanced references:

- [Identity and scope contract](team-os-identity-and-scope.md)
- [Manual verification runbook](team-os-manual-verification.md)
- [Memory retrieval](memory-retrieval.md)
- [Session capture](memory/session-capture.md)
- [Solo multi-client guide](multi-client-guide.md)

## Quick Checklist

- Sign in from the top-right Team control and confirm **Connected**.
- Use **Switch team** for the same account; remember it changes only the
  default for new work.
- Find old work with **Search chats**, **All Teams**, and **All clients**.
- Before another person uses the app, select **Sign out** and wait for cleanup.
- To return, use the same server and account. Use **Reconnect** only for login
  repair, not for a missing local database.
