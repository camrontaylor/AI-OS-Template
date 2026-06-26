#!/usr/bin/env bash
set -euo pipefail

# AI-OS - Recommended searchable memory setup.
#
# Usage:
#   bash scripts/setup-memory.sh
#   bash scripts/setup-memory.sh --check
#   bash scripts/setup-memory.sh --target claude|codex|both|none

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT" 2>/dev/null || printf '%s' "$REPO_ROOT")" ;;
esac

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info() { printf "${CYAN}%b${NC}\n" "$1"; }
ok() { printf "${GREEN}  ✓ %b${NC}\n" "$1"; }
warn() { printf "${YELLOW}  ! %b${NC}\n" "$1"; }
fail() { printf "${RED}  ✗ %b${NC}\n" "$1"; }

CHECK_ONLY=0
TARGET=""

usage() {
    cat <<'EOF'
AI-OS searchable memory setup

Usage:
  bash scripts/setup-memory.sh
  bash scripts/setup-memory.sh --check
  bash scripts/setup-memory.sh --target claude|codex|both|none

Options:
  --check             Only report status. Does not install, configure, or index.
  --target <target>   Configure Claude Code, Codex, both, or none.
  -h, --help          Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)
            CHECK_ONLY=1
            ;;
        --target)
            TARGET="${2:-}"
            shift
            ;;
        --target=*)
            TARGET="${1#*=}"
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            printf "Unknown argument: %s\n" "$1" >&2
            usage >&2
            exit 1
            ;;
    esac
    shift
done

case "$TARGET" in
    ""|claude|codex|both|none) ;;
    *)
        printf "Unknown target: %s\n" "$TARGET" >&2
        exit 1
        ;;
esac

is_windows_shell() {
    case "$(uname -s)" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
        *) return 1 ;;
    esac
}

read_env_value() {
    local key="$1"
    local value="${!key:-}"

    if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return 0
    fi

    if [[ -f "$REPO_ROOT/.env" ]]; then
        awk -v key="$key" '
            BEGIN { prefix = key "=" }
            index($0, prefix) == 1 {
                value = substr($0, length(prefix) + 1)
                gsub(/^"|"$/, "", value)
                gsub(/^'\''|'\''$/, "", value)
                # Un-escape the \" and \\ that write_env_value adds inside a
                # double-quoted value, so the round-trip returns the original.
                gsub(/\\"/, "\"", value)
                gsub(/\\\\/, "\\", value)
                print value
                exit
            }
        ' "$REPO_ROOT/.env"
    fi
}

write_env_value() {
    local key="$1"
    local value="$2"
    local env_file="$REPO_ROOT/.env"
    local tmp_file="${env_file}.tmp.$$"

    [[ -f "$env_file" ]] || printf "# Add your API keys here.\n" > "$env_file"

    # Quote the value so spaces and special characters cannot corrupt .env.
    # Simple values (letters, digits, and a few safe symbols) stay bare to match
    # the .env.example house style. Anything else gets double-quoted with backslash
    # and double-quote escaped, which read_env_value strips back off on read.
    local safe_value
    if [[ "$value" =~ ^[A-Za-z0-9._:/@+=-]*$ ]]; then
        safe_value="$value"
    else
        local escaped="$value"
        escaped="${escaped//\\/\\\\}"
        escaped="${escaped//\"/\\\"}"
        safe_value="\"${escaped}\""
    fi

    # Pass key and value through the environment, not awk -v. awk -v re-processes
    # backslash escapes, which would silently strip our escaping; ENVIRON[] does not.
    AWK_ENV_KEY="$key" AWK_ENV_VALUE="$safe_value" awk '
        BEGIN {
            key = ENVIRON["AWK_ENV_KEY"]
            value = ENVIRON["AWK_ENV_VALUE"]
            prefix = key "="
            found = 0
        }
        index($0, prefix) == 1 {
            print key "=" value
            found = 1
            next
        }
        { print }
        END {
            if (!found) {
                print key "=" value
            }
        }
    ' "$env_file" > "$tmp_file"

    mv "$tmp_file" "$env_file"
}

open_zilliz_signup() {
    if is_windows_shell && command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command "Start-Process 'https://cloud.zilliz.com'" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
        open "https://cloud.zilliz.com" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "https://cloud.zilliz.com" >/dev/null 2>&1 || true
    else
        warn "Open https://cloud.zilliz.com in your browser."
    fi
}

memsearch_installed() {
    command -v memsearch >/dev/null 2>&1
}

claude_available() {
    command -v claude >/dev/null 2>&1
}

codex_available() {
    command -v codex >/dev/null 2>&1
}

claude_memsearch_installed() {
    # Current Claude Code CLIs (2.x) have no `claude plugin list` subcommand, so
    # detect the plugin by reading the plugin registry directly. installed_plugins.json
    # (schema v2) keys each plugin as "<plugin>@<marketplace>", e.g. "memsearch@memsearch-plugins".
    local installed_file="$HOME/.claude/plugins/installed_plugins.json"
    if [[ -f "$installed_file" ]] \
        && grep -qiE '"memsearch(@[^"]*)?"[[:space:]]*:' "$installed_file"; then
        return 0
    fi

    # Fallback for older CLIs that still expose `claude plugin list`.
    claude_available || return 1
    claude plugin list 2>/dev/null | grep -qiE '(^|[[:space:]>])memsearch(@|[[:space:]]|$)'
}

claude_memsearch_disabled() {
    # Returns 0 if the plugin is INSTALLED but explicitly DISABLED.
    # Checks settings.json for an explicit "memsearch@memsearch-plugins": false,
    # then falls back to `claude plugin list` output for older CLIs.
    local settings_file="$HOME/.claude/settings.json"
    if [[ -f "$settings_file" ]] \
        && grep -qiE '"memsearch@memsearch-plugins"[[:space:]]*:[[:space:]]*false' "$settings_file"; then
        return 0
    fi

    claude_available || return 1
    claude plugin list 2>/dev/null | awk '
        BEGIN { inside = 0; disabled = 0 }
        tolower($0) ~ /memsearch@memsearch-plugins|(^|[[:space:]>])memsearch(@|[[:space:]]|$)/ { inside = 1 }
        inside && tolower($0) ~ /status:/ {
            if (tolower($0) ~ /disabled/) disabled = 1
            inside = 0
        }
        END { exit disabled ? 0 : 1 }
    '
}

claude_memsearch_enabled() {
    claude_memsearch_installed || return 1
    ! claude_memsearch_disabled
}

codex_memsearch_installed() {
    if codex_available && codex plugin list 2>/dev/null | grep -qiE '(^|[[:space:]>])memsearch(@|[[:space:]]|$)'; then
        return 0
    fi

    if [[ -f "$HOME/.codex/hooks.json" ]] && grep -qi 'memsearch' "$HOME/.codex/hooks.json"; then
        return 0
    fi

    if [[ -d "$HOME/.agents/skills/memory-recall" ]]; then
        return 0
    fi

    return 1
}

zilliz_configured() {
    if ! is_windows_shell; then
        return 0
    fi

    local zilliz_uri zilliz_token
    zilliz_uri="$(read_env_value ZILLIZ_URI)"
    zilliz_token="$(read_env_value ZILLIZ_TOKEN)"

    [[ -n "$zilliz_uri" && -n "$zilliz_token" ]]
}

windows_watch_disabled() {
    if ! is_windows_shell; then
        return 0
    fi

    if ! command -v powershell.exe >/dev/null 2>&1; then
        if [[ "${MEMSEARCH_NO_WATCH:-}" == "1" ]]; then
            return 0
        fi
        return 1
    fi

    local user_value
    user_value="$(
        powershell.exe -NoProfile -NonInteractive -Command "[Environment]::GetEnvironmentVariable('MEMSEARCH_NO_WATCH','User')" 2>/dev/null |
        tr -d '\r' || true
    )"
    [[ "$user_value" == "1" ]]
}

nightly_memsearch_cron_active() {
    local job_file="$REPO_ROOT/cron/jobs/nightly-memsearch-index.md"
    [[ -f "$job_file" ]] || return 1
    grep -qiE '^active:[[:space:]]*['\''"]?true['\''"]?[[:space:]]*$' "$job_file"
}

memory_ready() {
    memsearch_installed || return 1
    zilliz_configured || return 1
    windows_watch_disabled || return 1
    claude_memsearch_enabled || codex_memsearch_installed
}

print_status() {
    info "Searchable Memory status"
    echo ""

    if command -v uv >/dev/null 2>&1; then
        ok "uv found: $(uv --version 2>/dev/null | head -n 1)"
    else
        warn "uv missing - needed to install memsearch safely"
    fi

    if memsearch_installed; then
        ok "memsearch found: $(memsearch --version 2>/dev/null | head -n 1)"
    else
        warn "memsearch CLI missing"
    fi

    if claude_available; then
        if claude_memsearch_installed; then
            if claude_memsearch_enabled; then
                ok "Claude Code MemSearch plugin installed and enabled"
            else
                warn "Claude Code MemSearch plugin installed but disabled"
                echo "  Enable if you want Claude Code plugin capture: claude plugin enable memsearch@memsearch-plugins"
            fi
        else
            warn "Claude Code found, but MemSearch plugin is not installed"
        fi
    else
        warn "Claude Code CLI not found"
    fi

    if codex_available; then
        if codex_memsearch_installed; then
            ok "Codex MemSearch setup detected"
        else
            warn "Codex found, but MemSearch setup was not detected"
        fi
    else
        warn "Codex CLI not found"
    fi

    if is_windows_shell; then
        if zilliz_configured; then
            ok "Zilliz Cloud values found for Windows backend"
        else
            warn "Zilliz Cloud values missing - Windows needs ZILLIZ_URI and ZILLIZ_TOKEN"
        fi

        if windows_watch_disabled; then
            ok "MemSearch real-time watch disabled on Windows (MEMSEARCH_NO_WATCH=1)"
        else
            warn "MemSearch real-time watch is not disabled on Windows"
        fi

        if nightly_memsearch_cron_active; then
            ok "Nightly MemSearch index job is active"
        else
            warn "Nightly MemSearch index job is missing or inactive"
        fi

        info "Automatic indexing runs when Command Centre or the managed cron daemon is running."
    else
        ok "Milvus Lite local backend available for this platform"
    fi

    echo ""
    if memory_ready; then
        ok "Searchable memory appears configured"
    else
        warn "Searchable memory is not fully configured yet"
    fi
}

if [[ $CHECK_ONLY -eq 1 ]]; then
    print_status
    memory_ready
    exit $?
fi

explain_skip() {
    warn "Skipped searchable memory setup."
    echo "  Until it is enabled, older memory search,"
    echo "  expanded recall, and stronger citations will not be available."
}

choose_target() {
    if [[ -n "$TARGET" ]]; then
        return 0
    fi

    if [[ ! -t 0 ]]; then
        warn "No interactive terminal detected. Re-run with --target claude, codex, both, or none."
        exit 1
    fi

    echo ""
    printf "${CYAN}${BOLD}Searchable Memory${NC}\n"
    echo "  MemSearch lets Claude Code or Codex search older sessions,"
    echo "  pinned memory, and learnings. AI-OS keeps markdown as the source"
    echo "  of truth; MemSearch is only a rebuildable search index."
    echo ""
    echo "  Choose where to enable it:"
    echo "    1. Claude Code only (recommended)"
    echo "    2. Codex only"
    echo "    3. Claude Code + Codex"
    echo "    4. Skip for now"
    echo ""
    printf "  Selection [1]: "

    local reply
    read -r reply
    reply="${reply:-1}"

    case "$reply" in
        1) TARGET="claude" ;;
        2) TARGET="codex" ;;
        3) TARGET="both" ;;
        4) TARGET="none" ;;
        *)
            warn "Unknown selection: $reply"
            TARGET="none"
            ;;
    esac
}

confirm_setup() {
    [[ "$TARGET" == "none" ]] && return 0

    echo ""
    printf "${CYAN}${BOLD}What will happen${NC}\n"
    echo "  - Install memsearch with: uv tool install \"memsearch[onnx]\" if missing."
    echo "  - Configure ONNX local embeddings."
    if is_windows_shell; then
        echo "  - Use Zilliz Cloud as the Windows vector backend."
        echo "  - Disable real-time MemSearch watch to prevent stuck background processes."
        echo "  - Refresh memory search through the initial index and managed cron runtime."
        echo "  - For a free Zilliz cluster, choose AWS eu-central-1 (Frankfurt)"
        echo "    or GCP us-west-1 (Oregon)."
    else
        echo "  - Use local Milvus Lite as the vector backend."
    fi
    echo "  - Index only AI-OS memory files, not the full repo."
    case "$TARGET" in
        claude) echo "  - Configure the Claude Code MemSearch plugin." ;;
        codex) echo "  - Configure MemSearch for Codex with the official installer." ;;
        both) echo "  - Configure both Claude Code and Codex." ;;
    esac
    echo ""

    local reply
    printf "  Continue? ${BOLD}[Y/n]${NC} "
    if ! read -r reply; then
        warn "No confirmation received. Not installing."
        return 3
    fi
    reply="${reply:-Y}"
    [[ "$reply" =~ ^[Yy]$ ]] || return 3
}

disable_windows_watch() {
    if ! is_windows_shell; then
        return 0
    fi

    export MEMSEARCH_NO_WATCH=1

    if ! command -v powershell.exe >/dev/null 2>&1; then
        fail "powershell.exe is required to save MEMSEARCH_NO_WATCH for Windows users."
        echo "  The current setup process has MEMSEARCH_NO_WATCH=1, but future shells may not."
        return 1
    fi

    if ! powershell.exe -NoProfile -NonInteractive -Command "[Environment]::SetEnvironmentVariable('MEMSEARCH_NO_WATCH','1','User')" >/dev/null; then
        fail "Could not set MEMSEARCH_NO_WATCH in the Windows user environment."
        return 1
    fi

    ok "Disabled real-time MemSearch watch on Windows (MEMSEARCH_NO_WATCH=1)"
    warn "Restart Claude Code, Codex, and any open terminals for this to take effect."
    info "Automatic memory refresh uses Command Centre or the managed cron daemon."
    info "Daemon command: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\\start-crons.ps1"
}

ensure_memsearch_cli() {
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"

    if memsearch_installed; then
        ok "memsearch CLI already installed"
        return 0
    fi

    if ! command -v uv >/dev/null 2>&1; then
        fail "uv is required to install memsearch."
        echo "  Run AI-OS dependency setup first:"
        echo "    bash scripts/setup.sh"
        return 1
    fi

    info "Installing memsearch[onnx] with uv..."
    # memsearch requires Python >=3.10, but many systems (e.g. macOS) only have
    # an older system python3 on PATH. Pin a managed interpreter so uv provisions
    # a compatible one instead of failing on whatever python happens to be active.
    if uv tool install --python 3.12 "memsearch[onnx]"; then
        export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
        memsearch_installed && ok "memsearch CLI installed" && return 0
    fi

    fail "memsearch install failed."
    echo "  You can retry manually:"
    echo "    uv tool install --python 3.12 \"memsearch[onnx]\""
    return 1
}

ensure_windows_python3_shim() {
    if ! is_windows_shell || command -v python3 >/dev/null 2>&1; then
        return 0
    fi

    if command -v python >/dev/null 2>&1; then
        mkdir -p "$HOME/bin"
        printf '#!/usr/bin/env bash\nexec python "$@"\n' > "$HOME/bin/python3"
        chmod +x "$HOME/bin/python3"
        export PATH="$HOME/bin:$PATH"
        ok "Created ~/bin/python3 shim for Windows hooks"
    fi
}

ensure_backend_config() {
    if is_windows_shell; then
        local zilliz_uri zilliz_token
        zilliz_uri="$(read_env_value ZILLIZ_URI)"
        zilliz_token="$(read_env_value ZILLIZ_TOKEN)"

        if [[ -z "$zilliz_uri" || -z "$zilliz_token" ]]; then
            echo ""
            warn "Windows needs a free Zilliz Cloud cluster for MemSearch."
            echo "  Milvus Lite does not currently support native Windows."
            echo "  When creating the free cluster, choose one of the free regions:"
            echo "    - AWS eu-central-1 (Frankfurt)"
            echo "    - GCP us-west-1 (Oregon)"
            echo "  Other regions may require a paid Zilliz plan."
            echo "  Opening Zilliz Cloud in your browser..."
            open_zilliz_signup
            echo ""

            if [[ ! -t 0 ]]; then
                fail "ZILLIZ_URI and ZILLIZ_TOKEN are required on Windows."
                echo "  Add them to .env, or use WSL/Linux with the local backend."
                return 1
            fi

            printf "  Paste your Zilliz cluster URI: "
            read -r zilliz_uri
            printf "  Paste your Zilliz API token: "
            read -rs zilliz_token
            echo ""

            if [[ -z "$zilliz_uri" || -z "$zilliz_token" ]]; then
                fail "Zilliz URI and token are required on Windows."
                return 1
            fi

            write_env_value ZILLIZ_URI "$zilliz_uri"
            write_env_value ZILLIZ_TOKEN "$zilliz_token"
            ok "Saved Zilliz values to .env"
        fi

        if ! memsearch config set milvus.uri "$zilliz_uri" >/dev/null \
            || ! memsearch config set milvus.token "$zilliz_token" >/dev/null; then
            fail "Could not write Zilliz backend config to memsearch."
            return 1
        fi
        ok "Zilliz Cloud backend configured"
    else
        ok "Using local Milvus Lite backend"
    fi

    if ! memsearch config set embedding.provider onnx >/dev/null; then
        fail "Could not configure ONNX embeddings."
        return 1
    fi
    ok "ONNX embeddings configured"
}

run_initial_index() {
    local index_paths=()

    [[ -f "$REPO_ROOT/context/MEMORY.md" ]] && index_paths+=("context/MEMORY.md")
    [[ -d "$REPO_ROOT/context/memory" ]] && index_paths+=("context/memory/")
    [[ -f "$REPO_ROOT/context/learnings.md" ]] && index_paths+=("context/learnings.md")
    shopt -s nullglob
    for client_dir in "$REPO_ROOT"/clients/*/; do
        [[ -d "$client_dir/context" ]] || continue
        [[ -f "${client_dir}context/MEMORY.md" ]] && index_paths+=("${client_dir#"$REPO_ROOT/"}context/MEMORY.md")
        [[ -d "${client_dir}context/memory" ]] && index_paths+=("${client_dir#"$REPO_ROOT/"}context/memory/")
        [[ -f "${client_dir}context/learnings.md" ]] && index_paths+=("${client_dir#"$REPO_ROOT/"}context/learnings.md")
    done
    shopt -u nullglob

    if [[ ${#index_paths[@]} -eq 0 ]]; then
        warn "No memory files found to index yet."
        return 0
    fi

    local collection=""
    if [[ -f "$REPO_ROOT/scripts/lib/memsearch-collection.sh" ]]; then
        collection="$(bash "$REPO_ROOT/scripts/lib/memsearch-collection.sh" "$REPO_ROOT" 2>/dev/null || true)"
    fi

    local finish_command=""
    if [[ -f "$REPO_ROOT/scripts/memsearch-reindex.sh" ]]; then
        finish_command="bash scripts/memsearch-reindex.sh"
    elif [[ -n "$collection" ]]; then
        finish_command="memsearch index ${index_paths[*]} --collection $collection"
    else
        finish_command="memsearch index ${index_paths[*]}"
    fi

    info "Running initial MemSearch index..."
    echo ""
    echo "  First run downloads a local ONNX embedding model (~17 MB) from Hugging Face."
    echo "  It is cached after this, so it only happens once."
    echo ""
    echo "  The progress bar can sit at 0% for a bit while the connection is established."
    echo "  That is normal, not frozen."
    echo ""
    echo "  This step is optional and rebuildable. It is safe to interrupt with Ctrl+C"
    echo "  and finish later with the command shown below; downloads resume from cache."
    echo ""

    local rc=0
    (
        cd "$REPO_ROOT"
        # Make the first-run Hugging Face download robust. Respect any values the
        # user already set. hf_transfer (the Rust fast path) is a known source of
        # 0%-stalls on Windows, so default it off and fall back to the reliable
        # Python downloader; raise the default 10s timeout for slow handshakes.
        export HF_HUB_DOWNLOAD_TIMEOUT="${HF_HUB_DOWNLOAD_TIMEOUT:-60}"
        export HF_HUB_ENABLE_HF_TRANSFER="${HF_HUB_ENABLE_HF_TRANSFER:-0}"
        export HF_HUB_DISABLE_TELEMETRY="${HF_HUB_DISABLE_TELEMETRY:-1}"
        hf_token="$(read_env_value HF_TOKEN)"
        [[ -n "$hf_token" ]] && export HF_TOKEN="$hf_token"
        if [[ -f scripts/memsearch-reindex.sh ]]; then
            bash scripts/memsearch-reindex.sh
        else
            collection_args=()
            [[ -n "$collection" ]] && collection_args=(--collection "$collection")
            memsearch index "${index_paths[@]}" "${collection_args[@]}"
        fi
    ) || rc=$?

    if [[ $rc -eq 0 ]]; then
        ok "Initial memory index complete"
        return 0
    fi

    warn "Initial index did not finish (it was interrupted or the model download failed)."
    echo "  Your setup is otherwise complete. The index is rebuildable and your"
    echo "  markdown memory remains the source of truth. Finish it anytime with:"
    echo "    $finish_command"
    # Treat an unfinished index as a recoverable warning, not a hard setup failure.
    return 0
}

install_claude_plugin() {
    if ! claude_available; then
        warn "Claude Code CLI not found. Install Claude Code, then run this script again."
        return 1
    fi

    if claude_memsearch_installed; then
        if claude_memsearch_enabled; then
            ok "Claude Code MemSearch plugin already installed and enabled"
        else
            warn "Claude Code MemSearch plugin is installed but disabled."
            echo "  Enable it with: claude plugin enable memsearch@memsearch-plugins"
        fi
        return 0
    fi

    info "Configuring Claude Code MemSearch plugin..."
    # `plugin marketplace add` does NOT accept --scope on current CLIs (it errors with
    # "unknown option '--scope'"); --scope is only valid on `plugin install`.
    if ! claude plugin marketplace add zilliztech/memsearch; then
        warn "Could not add the MemSearch Claude Code marketplace automatically."
        echo "  Manual commands:"
        echo "    claude plugin marketplace add zilliztech/memsearch"
        echo "    claude plugin install memsearch@memsearch-plugins --scope user"
        return 1
    fi

    if ! claude plugin install memsearch@memsearch-plugins --scope user; then
        warn "Could not install the Claude Code MemSearch plugin automatically."
        echo "  Manual command:"
        echo "    claude plugin install memsearch@memsearch-plugins --scope user"
        return 1
    fi

    ok "Claude Code MemSearch plugin installed"
    warn "Restart Claude Code to activate the plugin."
}

install_codex_plugin() {
    if ! codex_available; then
        warn "Codex CLI not found. Install Codex, then run this script again."
        return 1
    fi

    if codex_memsearch_installed; then
        ok "Codex MemSearch setup already detected"
        return 0
    fi

    if ! command -v git >/dev/null 2>&1; then
        fail "git is required to fetch the official MemSearch Codex installer."
        return 1
    fi

    local cache_dir="${AGENTIC_OS_MEMSEARCH_CACHE:-${XDG_CACHE_HOME:-$HOME/.cache}/agentic-os/memsearch}"
    local installer="$cache_dir/plugins/codex/scripts/install.sh"

    info "Fetching official MemSearch Codex installer..."
    if [[ -d "$cache_dir/.git" ]]; then
        # A failed pull (diverged cache, offline) must not abort setup under
        # set -e. Fall back to the existing cached copy, which the installer
        # existence check below still validates.
        if ! git -C "$cache_dir" pull --ff-only >/dev/null 2>&1; then
            warn "Could not update the cached MemSearch installer; using the existing copy."
        fi
    elif [[ -e "$cache_dir" ]]; then
        fail "MemSearch cache path exists but is not a git repo: $cache_dir"
        return 1
    else
        mkdir -p "$(dirname "$cache_dir")"
        git clone https://github.com/zilliztech/memsearch.git "$cache_dir"
    fi

    if [[ ! -f "$installer" ]]; then
        fail "Codex installer not found at $installer"
        echo "  Native setup may be blocked. Use WSL/Linux or follow:"
        echo "  https://zilliztech.github.io/memsearch/platforms/codex/installation/"
        return 1
    fi

    bash "$installer"
    ok "Codex MemSearch setup finished"
}

choose_target

if [[ "$TARGET" == "none" ]]; then
    explain_skip
    exit 0
fi

if ! confirm_setup; then
    explain_skip
    exit 3
fi

ERRORS=0

disable_windows_watch || ERRORS=$((ERRORS + 1))
ensure_windows_python3_shim || ERRORS=$((ERRORS + 1))
ensure_memsearch_cli || ERRORS=$((ERRORS + 1))

if memsearch_installed; then
    ensure_backend_config || ERRORS=$((ERRORS + 1))
    run_initial_index || ERRORS=$((ERRORS + 1))
fi

case "$TARGET" in
    claude)
        install_claude_plugin || ERRORS=$((ERRORS + 1))
        ;;
    codex)
        install_codex_plugin || ERRORS=$((ERRORS + 1))
        ;;
    both)
        install_claude_plugin || ERRORS=$((ERRORS + 1))
        install_codex_plugin || ERRORS=$((ERRORS + 1))
        ;;
esac

echo ""
if [[ $ERRORS -eq 0 ]]; then
    ok "Searchable memory setup complete"
    echo "  Ask naturally about older decisions once your agent has restarted."
    exit 0
fi

fail "$ERRORS searchable memory setup step(s) need attention"
echo "  Re-run this script after fixing the issue. MemSearch indexes are rebuildable,"
echo "  and AI-OS markdown memory remains the source of truth."
exit 1
