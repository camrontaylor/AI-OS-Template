#!/usr/bin/env bash
set -euo pipefail

# AI-OS - memory migration/setup.
#
# This script replaces the old MemSearch installer. It chooses the active
# memory store, backfills it through Command Centre, then archives and disables
# legacy MemSearch pieces.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) REPO_ROOT="$(cygpath -m "$REPO_ROOT" 2>/dev/null || printf '%s' "$REPO_ROOT")" ;;
esac

COMMAND_CENTRE_DIR="$REPO_ROOT/command-centre"
LOCAL_MEMORY_DIR="$REPO_ROOT/.command-centre/memory"
MODEL_CACHE_DIR="$REPO_ROOT/.command-centre/models"
EXPECTED_MEMORY_MODEL="bge-m3"
EXPECTED_MEMORY_DIM="1024"

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
LEGACY_CHECK_ONLY=0
YES=0
BACKEND="auto"
DEPRECATED_TARGET=""
LEGACY_LOCAL_MEMORY_DIR=""
LOCAL_MEMORY_REBUILT=0

usage() {
    cat <<'EOF'
AI-OS memory migration/setup

Usage:
  bash scripts/setup-memory.sh
  bash scripts/setup-memory.sh --check
  bash scripts/setup-memory.sh --legacy-check
  bash scripts/setup-memory.sh --backend local|postgres

Options:
  --check              Only report status. Does not write files or uninstall anything.
  --legacy-check       Exit 0 when old MemSearch traces are present, else 1.
  --backend <backend>  Choose local PGLite or hosted Postgres.
  --yes, -y            Use defaults for any prompts.
  --target <target>    Deprecated compatibility option; ignored except "none".
  -h, --help           Show this help.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --check)
            CHECK_ONLY=1
            ;;
        --legacy-check)
            LEGACY_CHECK_ONLY=1
            ;;
        --yes|-y)
            YES=1
            ;;
        --backend)
            BACKEND="${2:-}"
            shift
            ;;
        --backend=*)
            BACKEND="${1#*=}"
            ;;
        --target)
            DEPRECATED_TARGET="${2:-}"
            shift
            ;;
        --target=*)
            DEPRECATED_TARGET="${1#*=}"
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

case "$BACKEND" in
    auto|local|pglite|postgres|hosted) ;;
    *)
        printf "Unknown backend: %s\n" "$BACKEND" >&2
        exit 1
        ;;
esac

if [[ "$BACKEND" == "pglite" ]]; then
    BACKEND="local"
elif [[ "$BACKEND" == "hosted" ]]; then
    BACKEND="postgres"
fi

read_env_value() {
    local key="$1"
    local value="${!key:-}"

    if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return 0
    fi

    if [[ -f "$REPO_ROOT/.env" ]]; then
        awk -v key="$key" '
            BEGIN { prefix = key "="; export_prefix = "export " key "=" }
            /^[[:space:]]*#/ { next }
            index($0, prefix) == 1 {
                value = substr($0, length(prefix) + 1)
                gsub(/^"|"$/, "", value)
                gsub(/^'\''|'\''$/, "", value)
                print value
                exit
            }
            index($0, export_prefix) == 1 {
                value = substr($0, length(export_prefix) + 1)
                gsub(/^"|"$/, "", value)
                gsub(/^'\''|'\''$/, "", value)
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

    awk -v key="$key" -v value="$value" '
        BEGIN { prefix = key "="; export_prefix = "export " key "="; found = 0 }
        index($0, prefix) == 1 || index($0, export_prefix) == 1 {
            if (!found) {
                print key "=" value
                found = 1
            }
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

hosted_env_key() {
    if [[ -n "${MEMORY_DATABASE_URL:-}" ]] || [[ -n "$(read_env_value MEMORY_DATABASE_URL)" ]]; then
        printf 'MEMORY_DATABASE_URL\n'
        return 0
    fi
    if [[ -n "${DATABASE_URL:-}" ]] || [[ -n "$(read_env_value DATABASE_URL)" ]]; then
        printf 'DATABASE_URL\n'
        return 0
    fi
    return 1
}

hosted_url_present() {
    hosted_env_key >/dev/null 2>&1
}

export_hosted_url() {
    local key value
    key="$(hosted_env_key)" || return 1
    value="$(read_env_value "$key")"
    [[ -n "$value" ]] || return 1
    export "$key=$value"
}

local_memory_exists() {
    [[ -d "$LOCAL_MEMORY_DIR" ]]
}

memory_download_notice() {
    echo "  AI-OS will set up semantic memory using the BGE-M3 embedding model."
    echo "  If the model is not cached yet, it will be downloaded now and this may take several minutes."
    echo "  Model cache: ${MODEL_CACHE_DIR#"$REPO_ROOT"/}"
}

clear_bge_m3_model_cache() {
    local model_dir="$MODEL_CACHE_DIR/Xenova/bge-m3"

    ensure_command_centre_path "$model_dir" || return 1

    if [[ -e "$model_dir" ]]; then
        warn "Clearing the cached BGE-M3 model files before retrying."
        rm -rf "$model_dir"
        ok "Cleared BGE-M3 model cache"
    else
        warn "BGE-M3 model cache was not present; retrying download."
    fi
}

memory_status_json() {
    local node_backend="${BACKEND:-auto}"
    [[ "$node_backend" == "local" ]] && node_backend="pglite"
    MEMORY_STORE_BACKEND="$node_backend" \
    MEMORY_EMBEDDER="$EXPECTED_MEMORY_MODEL" \
    MEMORY_MODEL_CACHE_DIR="$MODEL_CACHE_DIR" \
        npm --silent --prefix "$COMMAND_CENTRE_DIR" run memory:status -- --json 2>/dev/null
}

memory_store_compatible() {
    local status_file

    if [[ ! -f "$COMMAND_CENTRE_DIR/package.json" ]] || ! command -v npm >/dev/null 2>&1; then
        return 1
    fi

    if ! hosted_url_present && ! local_memory_exists; then
        return 1
    fi

    status_file="$(mktemp)"
    if ! memory_status_json >"$status_file"; then
        rm -f "$status_file"
        return 1
    fi

    node - "$status_file" "$EXPECTED_MEMORY_MODEL" "$EXPECTED_MEMORY_DIM" <<'NODE'
const fs = require("node:fs");
const [file, expectedModel, expectedDimRaw] = process.argv.slice(2);
const expectedDim = Number(expectedDimRaw);
const status = JSON.parse(fs.readFileSync(file, "utf8"));
const ok =
  status.storeReady === true &&
  status.embeddingCompatible === true &&
  status.expectedEmbeddingModel === expectedModel &&
  Number(status.expectedEmbeddingDim) === expectedDim &&
  Number(status.embedDim) === expectedDim;
process.exit(ok ? 0 : 1);
NODE
    local rc=$?
    rm -f "$status_file"
    return "$rc"
}

ensure_command_centre_path() {
    local target="$1"
    local command_centre_root parent abs_parent abs_target suffix

    mkdir -p "$REPO_ROOT/.command-centre"
    command_centre_root="$(cd "$REPO_ROOT/.command-centre" && pwd -P)"

    parent="$target"
    suffix=""
    while [[ ! -e "$parent" && "$parent" != "/" && "$parent" != "." ]]; do
        suffix="/$(basename "$parent")$suffix"
        parent="$(dirname "$parent")"
    done
    abs_parent="$(cd "$parent" && pwd -P)" || return 1
    abs_target="$abs_parent$suffix"

    case "$abs_target" in
        "$command_centre_root"/*) return 0 ;;
        *)
            fail "Refusing to modify path outside .command-centre: $abs_target"
            return 1
            ;;
    esac
}

find_memsearch_dirs() {
    if [[ -d "$REPO_ROOT/.memsearch" ]]; then
        printf '%s\n' "$REPO_ROOT/.memsearch"
    fi

    if [[ -d "$REPO_ROOT/clients" ]]; then
        find "$REPO_ROOT/clients" -path '*/.memsearch' -type d -print 2>/dev/null | sort
    fi
}

memsearch_dirs_present() {
    [[ -n "$(find_memsearch_dirs)" ]]
}

claude_available() {
    command -v claude >/dev/null 2>&1
}

codex_available() {
    command -v codex >/dev/null 2>&1
}

claude_memsearch_installed() {
    claude_available || return 1
    claude plugin list 2>/dev/null | grep -qiE '^[[:space:]]*>?[[:space:]]*memsearch(@|[[:space:]]|$)'
}

claude_memsearch_scopes() {
    claude_available || return 0
    claude plugin list 2>/dev/null | awk '
        BEGIN { in_memsearch = 0 }
        /^[[:space:]]*>?[[:space:]]*memsearch(@|[[:space:]]|$)/ {
            in_memsearch = 1
            next
        }
        in_memsearch && /^[[:space:]]*Scope:[[:space:]]*/ {
            scope = $0
            sub(/^[[:space:]]*Scope:[[:space:]]*/, "", scope)
            sub(/[[:space:]].*$/, "", scope)
            print tolower(scope)
            in_memsearch = 0
            next
        }
        /^[[:space:]]*>[[:space:]]*/ {
            in_memsearch = 0
        }
    ' | sort -u
}

codex_memsearch_installed() {
    codex_available || return 1
    codex plugin list 2>/dev/null | grep -qiE '(^|[[:space:]>])memsearch(@|[[:space:]]|$)'
}

codex_memsearch_hooks_present() {
    [[ -n "${HOME:-}" ]] || return 1
    [[ -f "$HOME/.codex/hooks.json" ]] || return 1
    grep -qi 'memsearch' "$HOME/.codex/hooks.json"
}

uv_memsearch_installed() {
    command -v uv >/dev/null 2>&1 || return 1
    uv tool list 2>/dev/null | grep -qiE '(^|[[:space:]-])memsearch([[:space:]]|$)'
}

memsearch_cli_present() {
    uv_memsearch_installed
}

legacy_memsearch_present() {
    memsearch_dirs_present \
        || memsearch_cli_present \
        || claude_memsearch_installed \
        || codex_memsearch_installed \
        || codex_memsearch_hooks_present
}

memory_ready() {
    if ! hosted_url_present && ! local_memory_exists; then
        return 1
    fi
    ! legacy_memsearch_present && memory_store_compatible
}

print_status() {
    info "Memory migration/setup status"
    echo ""

    if hosted_url_present; then
        ok "Hosted Postgres URL found"
    elif local_memory_exists; then
        ok "Local PGLite store found"
    else
        warn "No memory store is configured yet"
    fi

    if memory_store_compatible; then
        ok "Memory embeddings use $EXPECTED_MEMORY_MODEL ($EXPECTED_MEMORY_DIM dimensions)"
    else
        warn "Memory embeddings need setup or upgrade to $EXPECTED_MEMORY_MODEL ($EXPECTED_MEMORY_DIM dimensions)"
    fi

    if memsearch_dirs_present; then
        warn "Legacy .memsearch folders detected and need migration"
    else
        ok "No legacy .memsearch folders found"
    fi

    if claude_memsearch_installed; then
        warn "Claude Code MemSearch plugin is still installed"
    fi
    if codex_memsearch_installed; then
        warn "Codex MemSearch plugin is still installed"
    fi
    if codex_memsearch_hooks_present; then
        warn "Codex MemSearch hooks are still present"
    fi
    if uv_memsearch_installed || command -v memsearch >/dev/null 2>&1; then
        warn "MemSearch CLI/tool is still installed"
    fi

    echo ""
    if memory_ready; then
        ok "Memory migration/setup is complete"
    else
        warn "Memory migration/setup still needs to run"
    fi
}

if [[ $CHECK_ONLY -eq 1 ]]; then
    print_status
    memory_ready
    exit $?
fi

if [[ $LEGACY_CHECK_ONLY -eq 1 ]]; then
    legacy_memsearch_present
    exit $?
fi

choose_backend() {
    if [[ "$DEPRECATED_TARGET" == "none" ]]; then
        warn "Skipped memory migration/setup."
        exit 3
    fi
    if [[ -n "$DEPRECATED_TARGET" ]]; then
        warn "--target is deprecated. AI-OS now configures memory through PGLite or Postgres."
    fi

    if [[ "$BACKEND" != "auto" ]]; then
        return 0
    fi

    if hosted_url_present; then
        BACKEND="postgres"
        return 0
    fi

    if local_memory_exists; then
        BACKEND="local"
        return 0
    fi

    if [[ $YES -eq 1 || ! -t 0 ]]; then
        BACKEND="local"
        return 0
    fi

    echo ""
    echo "  Choose a memory store:"
    echo "    1. Local PGLite (recommended)"
    echo "    2. Hosted Postgres"
    echo "    3. Skip for now"
    echo ""
    printf "  Selection ${DIM}[1]${NC} "

    local reply
    if ! read -r reply; then
        reply="1"
    fi
    reply="${reply:-1}"

    case "$reply" in
        1) BACKEND="local" ;;
        2) BACKEND="postgres" ;;
        3)
            warn "Skipped memory migration/setup."
            exit 3
            ;;
        *)
            warn "Unknown selection: $reply. Using local PGLite."
            BACKEND="local"
            ;;
    esac
}

ensure_postgres_url() {
    if export_hosted_url; then
        return 0
    fi

    if [[ $YES -eq 1 || ! -t 0 ]]; then
        fail "Hosted Postgres was selected, but MEMORY_DATABASE_URL or DATABASE_URL is not set."
        echo "  Add it to .env or rerun with --backend local."
        return 1
    fi

    echo ""
    printf "  Paste your hosted Postgres URL: "
    local url
    read -r url
    if [[ -z "$url" ]]; then
        fail "A Postgres URL is required for hosted memory."
        return 1
    fi

    write_env_value MEMORY_DATABASE_URL "$url"
    export MEMORY_DATABASE_URL="$url"
    ok "Saved MEMORY_DATABASE_URL to .env"
}

command_centre_deps_need_install() {
    local modules_dir="$COMMAND_CENTRE_DIR/node_modules"
    local lock_file="$COMMAND_CENTRE_DIR/package-lock.json"
    local npm_marker="$modules_dir/.package-lock.json"

    [[ -d "$modules_dir" ]] || return 0
    [[ -f "$npm_marker" ]] || return 0
    if [[ -f "$lock_file" && "$lock_file" -nt "$npm_marker" ]]; then
        return 0
    fi
    if ! npm --prefix "$COMMAND_CENTRE_DIR" ls --depth=0 >/dev/null 2>&1; then
        return 0
    fi

    return 1
}

verify_command_centre_deps() {
    npm --prefix "$COMMAND_CENTRE_DIR" ls --depth=0 >/dev/null 2>&1
}

print_dependency_repair_failure() {
    fail "Command Centre dependencies could not be installed."
    if [[ "${LEGACY_MEMSEARCH_FOUND:-0}" -eq 1 ]]; then
        echo "  Memory migration did not run, and old .memsearch data was not archived."
    else
        echo "  Searchable memory setup did not run."
    fi
    echo "  Try this, then run memory setup again:"
    echo "    cd command-centre && npm ci"
}

ensure_command_centre_ready() {
    if [[ ! -f "$COMMAND_CENTRE_DIR/package.json" ]]; then
        fail "command-centre/package.json was not found."
        return 1
    fi

    if ! command -v npm >/dev/null 2>&1; then
        fail "npm is required for the new memory setup."
        echo "  Run the dependency setup first, then retry:"
        echo "    bash scripts/setup.sh"
        return 1
    fi

    if command_centre_deps_need_install; then
        info "Installing or repairing Command Centre dependencies..."
        if ! npm --prefix "$COMMAND_CENTRE_DIR" ci; then
            print_dependency_repair_failure
            return 1
        fi
        ok "Command Centre dependencies installed"
    fi

    if ! verify_command_centre_deps; then
        print_dependency_repair_failure
        return 1
    fi

    ok "Command Centre dependencies ready"
}

collect_reindex_args() {
    REINDEX_ARGS=()
    local rel abs
    local default_roots=(
        "context/memory"
        ".memsearch/memory"
        "context/learnings.md"
    )

    for rel in "${default_roots[@]}"; do
        abs="$REPO_ROOT/$rel"
        [[ -e "$abs" ]] && REINDEX_ARGS+=(--root "$rel")
    done

    if [[ -d "$REPO_ROOT/clients" ]]; then
        while IFS= read -r -d '' abs; do
            rel="${abs#"$REPO_ROOT"/}"
            REINDEX_ARGS+=(--root "$rel")
        done < <(find "$REPO_ROOT/clients" -path '*/.memsearch/memory' -type d -print0 2>/dev/null | sort -z)
    fi
}

run_npm_script() {
    local script="$1"
    shift

    if [[ $# -gt 0 ]]; then
        MEMORY_EMBEDDER="$EXPECTED_MEMORY_MODEL" \
        MEMORY_MODEL_CACHE_DIR="$MODEL_CACHE_DIR" \
            npm --prefix "$COMMAND_CENTRE_DIR" run "$script" -- "$@"
    else
        MEMORY_EMBEDDER="$EXPECTED_MEMORY_MODEL" \
        MEMORY_MODEL_CACHE_DIR="$MODEL_CACHE_DIR" \
            npm --prefix "$COMMAND_CENTRE_DIR" run "$script"
    fi
}

# Offer to import prior Claude Code sessions into memory. Opt-in and never
# silent: detection is read-only, and the import only runs if the user says yes
# in an interactive terminal. In non-interactive runs we just print a hint.
offer_session_import() {
    [[ -f "$COMMAND_CENTRE_DIR/package.json" ]] || return 0
    command -v npm >/dev/null 2>&1 || return 0

    if [[ ! -t 0 ]]; then
        info "Tip: import prior Claude Code sessions anytime with: ${BOLD}npm --prefix command-centre run memory:import-sessions${NC}"
        return 0
    fi

    # Read-only detection. Any non-zero "N available" means there is something to offer.
    if ! run_npm_script memory:import-sessions --dry-run 2>/dev/null | grep -qE '[1-9][0-9]* available'; then
        return 0
    fi

    echo ""
    info "Found prior Claude Code sessions that can be imported into memory."
    warn "Importing older conversations can take a while and may use Claude subscription usage."
    info "You can import a few now and more later — nothing is lost, and re-running never duplicates."
    printf "  Import prior sessions now? ${BOLD}[y/N]${NC} "
    local reply=""
    read -r reply || reply="N"
    reply="${reply:-N}"
    if [[ "$reply" =~ ^[Yy]$ ]]; then
        run_npm_script memory:import-sessions --interactive \
            || warn "Session import did not finish; run 'npm --prefix command-centre run memory:import-sessions' anytime."
    else
        info "Skipped. Run ${BOLD}npm --prefix command-centre run memory:import-sessions${NC} whenever you like."
    fi
}

# --- Robust BGE-M3 model prefetch -------------------------------------------
# transformers.js's built-in downloader mis-reads Content-Length across
# HuggingFace's Xet 302 redirect (the redirect body reports a tiny length; the
# real size only appears on the final CDN 200). On a flaky connection it leaves a
# truncated model_quantized.onnx -> "Protobuf parsing failed". curl follows the
# redirect, reads the real size from the CDN, resumes (-C -), and we verify the
# byte count. Best-effort: any problem falls back to the loader's own download.
MEMORY_MODEL_BASE_URL="${MEMORY_MODEL_BASE_URL:-https://huggingface.co/Xenova/bge-m3/resolve/main}"

file_byte_size() {
    if [[ -f "$1" ]]; then wc -c < "$1" 2>/dev/null | tr -d ' '; else printf '0'; fi
}

remote_content_length() {
    curl -fsIL --max-time 60 "$1" 2>/dev/null \
        | tr -d '\r' \
        | awk 'tolower($1) == "content-length:" { value = $2 } END { if (value != "") print value }'
}

prefetch_bge_m3_model() {
    command -v curl >/dev/null 2>&1 || return 0

    local dest="$MODEL_CACHE_DIR/Xenova/bge-m3"
    mkdir -p "$dest/onnx" 2>/dev/null || return 0

    local f
    for f in config.json tokenizer.json tokenizer_config.json; do
        [[ -s "$dest/$f" ]] && continue
        curl -fL --retry 5 --retry-delay 3 -o "$dest/$f" "$MEMORY_MODEL_BASE_URL/$f" 2>/dev/null || true
    done

    local target="$dest/onnx/model_quantized.onnx"
    local url="$MEMORY_MODEL_BASE_URL/onnx/model_quantized.onnx"
    local remote=""
    remote="$(remote_content_length "$url")" || true
    [[ -z "$remote" ]] && return 0          # can't verify size -> let the loader handle it
    [[ "$remote" =~ ^[0-9]+$ ]] || return 0

    local attempt
    for attempt in 1 2 3; do
        [[ "$(file_byte_size "$target")" == "$remote" ]] && return 0
        info "  Fetching BGE-M3 model (~$((remote / 1024 / 1024)) MB), attempt $attempt — resumable..."
        curl -fL --retry 5 --retry-delay 3 -C - -o "$target" "$url" 2>/dev/null || true
    done

    # Still wrong after retries: drop the truncated file so the loader's
    # cache-repair path starts clean instead of parsing a corrupt ONNX.
    [[ "$(file_byte_size "$target")" != "$remote" ]] && rm -f "$target"
    return 0
}

run_model_warmup() {
    memory_download_notice
    prefetch_bge_m3_model
    if run_npm_script memory:warmup; then
        return 0
    fi

    warn "BGE-M3 model warmup failed. Repairing the model cache and trying once more."
    clear_bge_m3_model_cache || return 1
    prefetch_bge_m3_model
    run_npm_script memory:warmup
}

ensure_local_memory_identity() {
    local helper="$COMMAND_CENTRE_DIR/scripts/local-memory-identity.cjs"
    if [[ ! -f "$helper" ]]; then
        fail "Local memory identity helper was not found."
        return 1
    fi
    if ! node "$helper" --ensure --root "$REPO_ROOT" >/dev/null; then
        fail "Could not preserve the local memory owner before rebuilding the store."
        return 1
    fi
}

prepare_local_store_for_rebuild() {
    LOCAL_MEMORY_REBUILT=0
    LEGACY_LOCAL_MEMORY_DIR=""

    if [[ "$BACKEND" != "local" || ! -d "$LOCAL_MEMORY_DIR" ]]; then
        return 0
    fi

    # The compatibility probe can open PGLite and quarantine a corrupt index.
    # Promote/validate the legacy owner before that first open.
    ensure_local_memory_identity || return 1

    if memory_store_compatible; then
        return 0
    fi

    local timestamp parent legacy
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    parent="$(dirname "$LOCAL_MEMORY_DIR")"
    legacy="$parent/memory-legacy-384-$timestamp"

    warn "Your memory index was built with an older embedding model. AI-OS will rebuild and reindex it."
    ensure_command_centre_path "$LOCAL_MEMORY_DIR" || return 1
    ensure_command_centre_path "$legacy" || return 1
    mv "$LOCAL_MEMORY_DIR" "$legacy"
    LEGACY_LOCAL_MEMORY_DIR="$legacy"
    LOCAL_MEMORY_REBUILT=1
    ok "Moved old local memory store to ${legacy#"$REPO_ROOT"/}"
}

restore_legacy_local_store() {
    if [[ $LOCAL_MEMORY_REBUILT -ne 1 || -z "$LEGACY_LOCAL_MEMORY_DIR" ]]; then
        return 0
    fi
    ensure_command_centre_path "$LOCAL_MEMORY_DIR" || return 1
    ensure_command_centre_path "$LEGACY_LOCAL_MEMORY_DIR" || return 1
    rm -rf "$LOCAL_MEMORY_DIR"
    mv "$LEGACY_LOCAL_MEMORY_DIR" "$LOCAL_MEMORY_DIR"
    warn "Restored the previous local memory store because migration did not finish."
}

finalize_legacy_local_store() {
    if [[ $LOCAL_MEMORY_REBUILT -ne 1 || -z "$LEGACY_LOCAL_MEMORY_DIR" ]]; then
        return 0
    fi
    if memory_store_compatible; then
        ensure_command_centre_path "$LEGACY_LOCAL_MEMORY_DIR" || return 1
        rm -rf "$LEGACY_LOCAL_MEMORY_DIR"
        ok "Migration finished. The old 384-dim memory store was removed."
        LEGACY_LOCAL_MEMORY_DIR=""
        LOCAL_MEMORY_REBUILT=0
        return 0
    fi
    warn "New memory store did not validate after reindex."
    return 1
}

reindex_client_workspaces() {
    [[ -d "$REPO_ROOT/clients" ]] || return 0

    local client_dir slug failed=0 failed_slugs=""
    for client_dir in "$REPO_ROOT/clients"/*/; do
        [[ -d "$client_dir" ]] || continue
        [[ -d "${client_dir}.claude" ]] || continue

        slug="$(basename "$client_dir")"
        [[ -d "${client_dir}context/memory" || -e "${client_dir}context/learnings.md" ]] || continue

        info "Re-indexing client '$slug' memory..."
        if ! run_npm_script memory:capture --reason refresh --force \
                --cwd "$client_dir" --workspace "$client_dir" \
                --visibility client --client "$slug"; then
            warn "Client '$slug' memory reindex failed."
            failed=$((failed + 1))
            failed_slugs="$failed_slugs $slug"
        fi
    done

    if [[ "$failed" -gt 0 ]]; then
        warn "Client memory reindex failed for:${failed_slugs}. Re-run memory:capture for those clients after setup."
        return 1
    fi
    return 0
}

run_memory_reindex() {
    collect_reindex_args

    run_model_warmup || return 1

    if [[ "$BACKEND" == "postgres" ]]; then
        ensure_postgres_url || return 1
        export MEMORY_STORE_BACKEND=postgres
        info "Applying hosted Postgres memory schema..."
        if ! run_npm_script memory:migrate; then
            warn "Hosted memory schema uses an older embedding dimension. Preserving hosted memory while rebuilding BGE-M3 vectors."
            run_npm_script memory:upgrade-embeddings --yes || return 1
            run_npm_script memory:migrate --check || return 1
        fi
        info "Re-indexing memory into hosted Postgres..."
        if ! run_npm_script memory:reindex --visibility system --force "${REINDEX_ARGS[@]}"; then
            return 1
        fi
        if ! reindex_client_workspaces; then
            return 1
        fi
        return 0
    fi

    export MEMORY_STORE_BACKEND=pglite
    prepare_local_store_for_rebuild || return 1
    info "Re-indexing memory into local PGLite..."
    if ! run_npm_script memory:reindex --allow-local --force "${REINDEX_ARGS[@]}"; then
        restore_legacy_local_store
        return 1
    fi
    if ! finalize_legacy_local_store; then
        restore_legacy_local_store
        return 1
    fi
    if ! reindex_client_workspaces; then
        return 1
    fi
    return 0
}

stop_memsearch_watchers() {
    local stopped=0
    local ps_script="$SCRIPT_DIR/stop-memsearch-watchers.ps1"

    if [[ -f "$ps_script" ]]; then
        if command -v powershell.exe >/dev/null 2>&1; then
            powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps_script" >/dev/null 2>&1 || true
            stopped=1
        elif command -v powershell >/dev/null 2>&1; then
            powershell -NoProfile -ExecutionPolicy Bypass -File "$ps_script" >/dev/null 2>&1 || true
            stopped=1
        elif command -v pwsh >/dev/null 2>&1; then
            pwsh -NoProfile -ExecutionPolicy Bypass -File "$ps_script" >/dev/null 2>&1 || true
            stopped=1
        fi
    fi

    if command -v pkill >/dev/null 2>&1; then
        pkill -f 'memsearch[[:space:]].*watch' >/dev/null 2>&1 || true
        stopped=1
    fi

    if [[ $stopped -eq 1 ]]; then
        ok "Stopped legacy MemSearch watcher processes when present"
    fi
}

archive_memsearch_dirs() {
    local dirs=()
    local found_dir
    while IFS= read -r found_dir; do
        [[ -n "$found_dir" ]] && dirs+=("$found_dir")
    done < <(find_memsearch_dirs)
    [[ ${#dirs[@]} -gt 0 ]] || return 0

    local timestamp backup_root dir rel dest suffix
    timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    backup_root="$REPO_ROOT/backups/memsearch-migration/$timestamp"

    for dir in "${dirs[@]}"; do
        if [[ "$dir" == "$REPO_ROOT/.memsearch" ]]; then
            rel="root/.memsearch"
        else
            rel="${dir#"$REPO_ROOT"/}"
        fi

        dest="$backup_root/$rel"
        suffix=1
        while [[ -e "$dest" ]]; do
            dest="$backup_root/${rel}.${suffix}"
            suffix=$((suffix + 1))
        done

        mkdir -p "$(dirname "$dest")"
        mv "$dir" "$dest"
        ok "Archived ${dir#"$REPO_ROOT"/} to ${dest#"$REPO_ROOT"/}"
    done
}

remove_codex_memsearch_hooks() {
    [[ -n "${HOME:-}" ]] || return 0
    local hooks_path="$HOME/.codex/hooks.json"
    [[ -f "$hooks_path" ]] || return 0
    grep -qi 'memsearch' "$hooks_path" || return 0

    if ! command -v node >/dev/null 2>&1; then
        warn "Node is unavailable; could not remove MemSearch entries from $hooks_path"
        return 1
    fi

    node - "$hooks_path" <<'NODE'
const fs = require("node:fs");
const file = process.argv[2];
const raw = fs.readFileSync(file, "utf8");
const data = JSON.parse(raw);

function isMemSearchCommand(value) {
  return value && typeof value === "object" &&
    typeof value.command === "string" &&
    value.command.toLowerCase().includes("memsearch");
}

function scrub(value) {
  if (Array.isArray(value)) {
    return value
      .map(scrub)
      .filter((item) => item !== null)
      .filter((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return true;
        if (!Array.isArray(item.hooks)) return true;
        const keys = Object.keys(item).filter((key) => key !== "matcher");
        return !(keys.length === 1 && item.hooks.length === 0);
      });
  }
  if (isMemSearchCommand(value)) return null;
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    const cleaned = scrub(child);
    if (cleaned !== null) next[key] = cleaned;
  }
  return next;
}

fs.writeFileSync(file, `${JSON.stringify(scrub(data), null, 2)}\n`);
NODE
    ok "Removed MemSearch hook entries from $hooks_path"
}

remove_claude_memsearch_plugin() {
    claude_memsearch_installed || return 0

    local scopes=()
    local detected_scope
    while IFS= read -r detected_scope; do
        case "$detected_scope" in
            user|project|local) scopes+=("$detected_scope") ;;
        esac
    done < <(claude_memsearch_scopes)

    local using_fallback=0
    if [[ ${#scopes[@]} -eq 0 ]]; then
        scopes=(user project local)
        using_fallback=1
    fi

    local scope removed=0
    for scope in "${scopes[@]}"; do
        if claude plugin uninstall memsearch --scope "$scope" -y >/dev/null 2>&1; then
            ok "Removed Claude Code MemSearch plugin (${scope} scope)"
            removed=1
            [[ $using_fallback -eq 1 ]] && break
        fi
    done

    if [[ $removed -eq 1 ]]; then
        return 0
    fi

    warn "Could not remove Claude Code MemSearch plugin automatically"
    return 1
}

uninstall_legacy_memsearch() {
    local errors=0

    stop_memsearch_watchers

    remove_claude_memsearch_plugin || errors=$((errors + 1))

    if codex_memsearch_installed; then
        if codex plugin remove memsearch@memsearch-plugins; then
            ok "Removed Codex MemSearch plugin"
        else
            warn "Could not remove Codex MemSearch plugin automatically"
            errors=$((errors + 1))
        fi
    fi

    remove_codex_memsearch_hooks || errors=$((errors + 1))

    if uv_memsearch_installed; then
        if uv tool uninstall memsearch; then
            ok "Uninstalled MemSearch uv tool"
        else
            warn "Could not uninstall the MemSearch uv tool automatically"
            errors=$((errors + 1))
        fi
    elif command -v memsearch >/dev/null 2>&1; then
        warn "memsearch is on PATH, but it was not listed by uv tool list. Remove it manually if it is still needed nowhere else."
    fi

    return "$errors"
}

LEGACY_MEMSEARCH_FOUND=0
if legacy_memsearch_present; then
    LEGACY_MEMSEARCH_FOUND=1
fi

if [[ $LEGACY_MEMSEARCH_FOUND -eq 1 ]]; then
    SETUP_LABEL="Memory migration/setup"
else
    SETUP_LABEL="Searchable memory setup"
fi

echo ""
printf "${CYAN}${BOLD}%s${NC}\n" "$SETUP_LABEL"
echo "  AI-OS now uses local PGLite by default, or hosted Postgres"
echo "  when MEMORY_DATABASE_URL or DATABASE_URL is already configured."

choose_backend

echo ""
case "$BACKEND" in
    postgres) echo "  Using hosted Postgres because a database URL is configured or was selected." ;;
    local) echo "  Using local PGLite." ;;
esac
echo ""
echo "  What will happen:"
echo "  - Set up semantic memory with the BGE-M3 embedding model."
echo "  - Download the model if it is not cached yet; this may take several minutes."
echo "  - Run Command Centre memory scripts to apply the schema and re-index memory."
if [[ $LEGACY_MEMSEARCH_FOUND -eq 1 ]]; then
    echo "  - Include old root and client .memsearch/memory folders during migration import."
    echo "  - Archive old .memsearch folders under backups/memsearch-migration/."
    echo "  - Remove legacy MemSearch plugins, hooks, tools, and watcher processes when found."
else
    echo "  - No legacy MemSearch data was detected, so no MemSearch cleanup will run."
fi
echo ""

if [[ $YES -ne 1 && -t 0 ]]; then
    printf "  Continue? ${BOLD}[Y/n]${NC} "
    reply=""
    if ! read -r reply; then
        reply="N"
    fi
    reply="${reply:-Y}"
    if [[ ! "$reply" =~ ^[Yy]$ ]]; then
        warn "Skipped memory migration/setup."
        exit 3
    fi
fi

ERRORS=0

ensure_command_centre_ready || ERRORS=$((ERRORS + 1))

if [[ $ERRORS -eq 0 ]]; then
    run_memory_reindex || ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -eq 0 && $LEGACY_MEMSEARCH_FOUND -eq 1 ]]; then
    archive_memsearch_dirs || ERRORS=$((ERRORS + 1))
    uninstall_legacy_memsearch || ERRORS=$((ERRORS + 1))
fi

if [[ $ERRORS -eq 0 ]]; then
    offer_session_import || true
fi

echo ""
if [[ $ERRORS -eq 0 ]]; then
    ok "$SETUP_LABEL complete"
    exit 0
fi

if [[ $LEGACY_MEMSEARCH_FOUND -eq 1 ]]; then
    fail "$ERRORS memory migration/setup step(s) need attention"
    echo "  Re-run this script after fixing the issue. If old .memsearch folders remain, they are archived only after indexing succeeds."
else
    fail "$ERRORS searchable memory setup step(s) need attention"
    echo "  Re-run this script after fixing the issue."
fi
exit 1
