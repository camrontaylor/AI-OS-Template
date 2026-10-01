#!/usr/bin/env bash
set -euo pipefail

REAL_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_ROOT="$(mktemp -d)"
NODE_BIN="$(command -v node || true)"
NODE_DIR=""
if [[ -n "$NODE_BIN" ]]; then
    NODE_DIR="$(dirname "$NODE_BIN")"
fi

cleanup() {
    rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

fail() {
    echo "[FAIL] $1" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local needle="$2"
    [[ -f "$file" ]] || fail "Missing file: $file"
    grep -Fq -- "$needle" "$file" || {
        echo "--- $file ---" >&2
        cat "$file" >&2
        fail "Expected to find: $needle"
    }
}

assert_not_contains() {
    local file="$1"
    local needle="$2"
    [[ -f "$file" ]] || return 0
    ! grep -Fq -- "$needle" "$file" || {
        echo "--- $file ---" >&2
        cat "$file" >&2
        fail "Did not expect to find: $needle"
    }
}

strip_ansi() {
    sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' "$1"
}

assert_default_reindex_roots() {
    local file="$1"
    assert_contains "$file" "--root context/memory"
    assert_contains "$file" "--root context/learnings.md"
    assert_not_contains "$file" "--root brand_context"
}

make_repo() {
    local name="$1"
    local repo="$TEST_ROOT/$name"

    mkdir -p "$repo/scripts" "$repo/command-centre/scripts" \
        "$repo/command-centre/src/lib/memory" "$repo/command-centre/node_modules" \
        "$repo/context/memory" "$repo/brand_context"
    cp "$REAL_REPO/scripts/setup-memory.sh" "$repo/scripts/setup-memory.sh"
    cp "$REAL_REPO/command-centre/scripts/local-memory-identity.cjs" \
        "$repo/command-centre/scripts/local-memory-identity.cjs"
    cp "$REAL_REPO/command-centre/src/lib/memory/local-identity.cjs" \
        "$repo/command-centre/src/lib/memory/local-identity.cjs"
    cat > "$repo/scripts/stop-memsearch-watchers.ps1" <<'EOF'
Write-Host "fake stop"
EOF
    cat > "$repo/command-centre/package.json" <<'EOF'
{"scripts":{"memory:migrate":"echo migrate","memory:reindex":"echo reindex","memory:status":"echo status","memory:warmup":"echo warmup","memory:reset":"echo reset","memory:upgrade-embeddings":"echo upgrade"}}
EOF
    cat > "$repo/command-centre/package-lock.json" <<'EOF'
{"lockfileVersion":3,"packages":{"":{"dependencies":{}}}}
EOF
    printf "{}\n" > "$repo/command-centre/node_modules/.package-lock.json"
    printf "# Memory\n\nRoot memory.\n" > "$repo/context/memory/2026-06-15.md"
    printf "# Learnings\n\nUseful learning.\n" > "$repo/context/learnings.md"
    printf "# Brand\n\nBrand context.\n" > "$repo/brand_context/brand.md"

    printf '%s\n' "$repo"
}

make_home() {
    local name="$1"
    local home="$TEST_ROOT/home-$name"
    mkdir -p "$home/.codex"
    cat > "$home/.codex/hooks.json" <<'EOF'
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "memsearch watch ." },
          { "type": "command", "command": "node keep.js" }
        ]
      }
    ]
  }
}
EOF
    printf '%s\n' "$home"
}

make_fake_bin() {
    local name="$1"
    local fake_bin="$TEST_ROOT/bin-$name"
    mkdir -p "$fake_bin"

    cat > "$fake_bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'npm MEMORY_STORE_BACKEND=%s %s\n' "${MEMORY_STORE_BACKEND:-}" "$*" >> "$ACTION_LOG"
prefix=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  if [[ "${args[$i]}" == "--prefix" && $((i + 1)) -lt ${#args[@]} ]]; then
    prefix="${args[$((i + 1))]}"
  fi
done
if [[ "$*" == *" ls --depth=0"* ]]; then
  if [[ "${FAKE_NPM_LS_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  if [[ "${FAKE_NPM_LS_FAIL_UNTIL_CI:-0}" == "1" && -n "$prefix" && ! -f "$prefix/.fake-ci-complete" ]]; then
    exit 1
  fi
fi
if [[ "$*" == *" ci"* ]]; then
  echo "npm-ci" >> "$ACTION_LOG"
  if [[ "${FAKE_NPM_CI_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  if [[ -n "$prefix" ]]; then
    mkdir -p "$prefix/node_modules"
    printf '{}\n' > "$prefix/node_modules/.package-lock.json"
    touch "$prefix/.fake-ci-complete"
  fi
fi
if [[ "$*" == *"memory:status"* ]]; then
  if [[ -n "${FAKE_EXPECT_OWNER_BEFORE_STATUS:-}" ]]; then
    identity_file="${REPO_UNDER_TEST}/.command-centre/local-memory-user.json"
    node -e 'const fs=require("node:fs");process.exit(fs.existsSync(process.argv[1])&&fs.readFileSync(process.argv[1],"utf8").includes(process.argv[2])?0:91)' \
      "$identity_file" "$FAKE_EXPECT_OWNER_BEFORE_STATUS" || exit 91
  fi
  if [[ "${FAKE_MEMORY_COMPATIBLE:-1}" == "1" ]] \
      || [[ "${FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX:-0}" == "1" \
          && -f "${REPO_UNDER_TEST:-}/.fake-memory-reindexed" ]]; then
    printf '{"storeReady":true,"embedDim":1024,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":true,"embeddingModels":[{"model":"bge-m3","dim":1024,"chunks":1}]}\n'
  else
    printf '{"storeReady":true,"embedDim":384,"expectedEmbeddingModel":"bge-m3","expectedEmbeddingDim":1024,"embeddingCompatible":false,"embeddingModels":[{"model":"hash-v1-384","dim":384,"chunks":1}]}\n'
  fi
fi
if [[ "$*" == *"memory:warmup"* && "${FAKE_MEMORY_WARMUP_FAIL_ONCE:-0}" == "1" && -n "$prefix" && ! -f "$prefix/.fake-warmup-failed" ]]; then
  touch "$prefix/.fake-warmup-failed"
  exit "${FAKE_MEMORY_WARMUP_FAIL_CODE:-134}"
fi
if [[ "$*" == *"memory:migrate"* && "${FAKE_MEMORY_MIGRATE_FAIL_ONCE:-0}" == "1" && -n "$prefix" && ! -f "$prefix/.fake-migrate-failed" ]]; then
  touch "$prefix/.fake-migrate-failed"
  exit 1
fi
if [[ "$*" == *"memory:reindex"* && "${FAKE_MEMORY_REINDEX_FAIL:-0}" == "1" ]]; then
  exit 1
fi
if [[ "$*" == *"memory:reindex"* && "${FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX:-0}" == "1" ]]; then
  mkdir -p "$REPO_UNDER_TEST/.command-centre/memory"
  touch "$REPO_UNDER_TEST/.fake-memory-reindexed"
fi
if [[ "$*" == *"memory:capture"* && -n "${FAKE_MEMORY_CAPTURE_FAIL_CLIENTS:-}" ]]; then
  client=""
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [[ "${args[$i]}" == "--client" && $((i + 1)) -lt ${#args[@]} ]]; then
      client="${args[$((i + 1))]}"
      break
    fi
  done
  if [[ " ${FAKE_MEMORY_CAPTURE_FAIL_CLIENTS} " == *" ${client} "* ]]; then
    exit 1
  fi
fi
if [[ "$*" == *"memory:reindex"* && -n "${REPO_UNDER_TEST:-}" ]]; then
  if [[ -f "$REPO_UNDER_TEST/.memsearch/memory/root.md" ]]; then
    echo "memsearch-present-during-reindex" >> "$ACTION_LOG"
  fi
fi
exit 0
EOF

    cat > "$fake_bin/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-} ${2:-}" == "plugin list" ]]; then
  if [[ "${FAKE_CLAUDE_MEMSEARCH:-${FAKE_MEMSEARCH_LEGACY:-0}}" == "1" ]]; then
    if [[ -n "${FAKE_CLAUDE_MEMSEARCH_SCOPE:-}" ]]; then
      printf 'Installed plugins:\n\n'
      printf '  > memsearch@memsearch-plugins\n'
      printf '    Version: 0.4.6\n'
      printf '    Scope: %s\n' "$FAKE_CLAUDE_MEMSEARCH_SCOPE"
      printf '    Status: enabled\n'
    else
      echo "memsearch"
    fi
  fi
  exit 0
fi
if [[ "${1:-} ${2:-} ${3:-}" == "plugin uninstall memsearch" && -n "${FAKE_CLAUDE_UNINSTALL_REQUIRE_SCOPE:-}" ]]; then
  actual_scope=""
  args=("$@")
  for ((i = 0; i < ${#args[@]}; i++)); do
    if [[ "${args[$i]}" == "--scope" && $((i + 1)) -lt ${#args[@]} ]]; then
      actual_scope="${args[$((i + 1))]}"
    fi
  done
  if [[ "$actual_scope" != "$FAKE_CLAUDE_UNINSTALL_REQUIRE_SCOPE" ]]; then
    printf 'Plugin "memsearch" is installed in %s scope, not %s.\n' "$FAKE_CLAUDE_UNINSTALL_REQUIRE_SCOPE" "${actual_scope:-unknown}" >&2
    exit 1
  fi
fi
printf 'claude %s\n' "$*" >> "$ACTION_LOG"
exit 0
EOF

    cat > "$fake_bin/codex" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "plugin list" ]]; then
  [[ "${FAKE_CODEX_MEMSEARCH:-${FAKE_MEMSEARCH_LEGACY:-0}}" == "1" ]] && echo "memsearch@memsearch-plugins"
  exit 0
fi
printf 'codex %s\n' "$*" >> "$ACTION_LOG"
exit 0
EOF

    cat > "$fake_bin/uv" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "tool list" ]]; then
  [[ "${FAKE_UV_MEMSEARCH:-${FAKE_MEMSEARCH_LEGACY:-0}}" == "1" ]] && echo "memsearch v0.4.6"
  exit 0
fi
printf 'uv %s\n' "$*" >> "$ACTION_LOG"
exit 0
EOF

    cat > "$fake_bin/powershell.exe" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'powershell.exe %s\n' "$*" >> "$ACTION_LOG"
exit 0
EOF

    cat > "$fake_bin/powershell" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'powershell %s\n' "$*" >> "$ACTION_LOG"
exit 0
EOF

    chmod +x "$fake_bin"/*
    printf '%s\n' "$fake_bin"
}

test_check_mode_does_not_mutate() {
    local repo home fake_bin log rc
    repo="$(make_repo check-mode)"
    home="$(make_home check-mode)"
    fake_bin="$(make_fake_bin check-mode)"
    log="$TEST_ROOT/check-mode.log"

    mkdir -p "$repo/.memsearch/memory"
    printf "# Old\n" > "$repo/.memsearch/memory/root.md"

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --check >"$TEST_ROOT/check-mode.out" 2>&1
    )
    rc=$?
    set -e

    [[ $rc -eq 1 ]] || fail "--check should report work needed"
    [[ -d "$repo/.memsearch" ]] || fail "--check should not archive .memsearch"
    [[ ! -f "$log" ]] || fail "--check should not run npm or uninstall commands"
}

test_existing_local_pglite_is_ready_and_reused() {
    local repo home fake_bin log
    repo="$(make_repo local-existing)"
    home="$(make_home local-existing)"
    fake_bin="$(make_fake_bin local-existing)"
    log="$TEST_ROOT/local-existing.log"

    rm -rf "$home/.codex/hooks.json"
    mkdir -p "$repo/.command-centre/memory"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --check >/dev/null
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "npm MEMORY_STORE_BACKEND=pglite"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
    assert_not_contains "$log" "memory:migrate"
}

test_local_rebuild_preserves_legacy_private_owner() {
    local repo home fake_bin log identity
    repo="$(make_repo local-owner-success)"
    home="$(make_home local-owner-success)"
    fake_bin="$(make_fake_bin local-owner-success)"
    log="$TEST_ROOT/local-owner-success.log"
    identity="local-setup-owner-success"

    rm -rf "$home/.codex/hooks.json"
    mkdir -p "$repo/.command-centre/memory"
    printf '{"version":1,"userId":"%s"}\n' "$identity" \
        > "$repo/.command-centre/memory/local-user.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export REPO_UNDER_TEST="$repo"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_COMPATIBLE=0
        export FAKE_MEMORY_COMPATIBLE_AFTER_REINDEX=1
        export FAKE_EXPECT_OWNER_BEFORE_STATUS="$identity"
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$repo/.command-centre/local-memory-user.json" "$identity"
    [[ -d "$repo/.command-centre/memory" ]] || fail "Rebuilt local memory store is missing"
    [[ -z "$(find "$repo/.command-centre" -maxdepth 1 -type d -name 'memory-legacy-384-*' -print -quit)" ]] \
        || fail "Successful rebuild should remove the old 384-dim store"
}

test_local_rebuild_failure_restores_store_without_changing_owner() {
    local repo home fake_bin log identity rc
    repo="$(make_repo local-owner-failure)"
    home="$(make_home local-owner-failure)"
    fake_bin="$(make_fake_bin local-owner-failure)"
    log="$TEST_ROOT/local-owner-failure.log"
    identity="local-setup-owner-failure"

    rm -rf "$home/.codex/hooks.json"
    mkdir -p "$repo/.command-centre/memory"
    printf '{"version":1,"userId":"%s"}\n' "$identity" \
        > "$repo/.command-centre/memory/local-user.json"

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export REPO_UNDER_TEST="$repo"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_COMPATIBLE=0
        export FAKE_MEMORY_REINDEX_FAIL=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )
    rc=$?
    set -e

    [[ $rc -eq 1 ]] || fail "Failed local rebuild should exit 1"
    assert_contains "$repo/.command-centre/local-memory-user.json" "$identity"
    assert_contains "$repo/.command-centre/memory/local-user.json" "$identity"
    [[ -z "$(find "$repo/.command-centre" -maxdepth 1 -type d -name 'memory-legacy-384-*' -print -quit)" ]] \
        || fail "Failed rebuild should restore the old store from quarantine"
}

test_hosted_postgres_runs_migrate_and_reindex() {
    local repo home fake_bin log
    repo="$(make_repo hosted)"
    home="$(make_home hosted)"
    fake_bin="$(make_fake_bin hosted)"
    log="$TEST_ROOT/hosted.log"

    rm -rf "$home/.codex/hooks.json"
    printf "MEMORY_DATABASE_URL=postgres://user:pass@example.test:5432/memory\n" > "$repo/.env"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "npm MEMORY_STORE_BACKEND=postgres"
    assert_contains "$log" "run memory:migrate"
    assert_contains "$log" "run memory:reindex"
    assert_contains "$log" "memory:reindex -- --visibility system"
    assert_default_reindex_roots "$log"
    assert_not_contains "$log" "--allow-local"
}

test_hosted_old_dimension_uses_preserving_upgrade() {
    local repo home fake_bin log
    repo="$(make_repo hosted-old-dimension)"
    home="$(make_home hosted-old-dimension)"
    fake_bin="$(make_fake_bin hosted-old-dimension)"
    log="$TEST_ROOT/hosted-old-dimension.log"

    rm -rf "$home/.codex/hooks.json"
    printf "MEMORY_DATABASE_URL=postgres://user:pass@example.test:5432/memory\n" > "$repo/.env"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_MIGRATE_FAIL_ONCE=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "run memory:migrate"
    assert_contains "$log" "run memory:upgrade-embeddings -- --yes"
    assert_contains "$log" "run memory:migrate -- --check"
    assert_contains "$log" "run memory:reindex"
    assert_contains "$log" "memory:reindex -- --visibility system"
    assert_default_reindex_roots "$log"
    assert_not_contains "$log" "run memory:reset"
    assert_not_contains "$log" "--allow-local"
}

test_no_backend_defaults_to_local_noninteractive() {
    local repo home fake_bin log
    repo="$(make_repo default-local)"
    home="$(make_home default-local)"
    fake_bin="$(make_fake_bin default-local)"
    log="$TEST_ROOT/default-local.log"

    rm -rf "$home/.codex/hooks.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "npm MEMORY_STORE_BACKEND=pglite"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
}

test_client_workspace_memory_reindexed_after_root_reindex() {
    local repo home fake_bin log capture_line cwd_arg workspace_arg
    repo="$(make_repo client-reindex)"
    home="$(make_home client-reindex)"
    fake_bin="$(make_fake_bin client-reindex)"
    log="$TEST_ROOT/client-reindex.log"

    rm -rf "$home/.codex/hooks.json"
    mkdir -p "$repo/clients/acme/.claude" "$repo/clients/acme/context/memory"
    mkdir -p "$repo/clients/made-up/context/memory"
    printf "# Acme memory\n\nClient note.\n" > "$repo/clients/acme/context/memory/2026-06-15.md"
    printf "# Acme learnings\n\nClient learning.\n" > "$repo/clients/acme/context/learnings.md"
    printf "# Stray memory\n\nShould not be scoped.\n" > "$repo/clients/made-up/context/memory/2026-06-15.md"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_contains "$log" "run memory:capture -- --reason refresh --force --cwd"
    assert_contains "$log" "--visibility client --client acme"
    assert_not_contains "$log" "--client made-up"
    capture_line="$(grep -F "run memory:capture -- --reason refresh --force" "$log")"
    cwd_arg="$(printf '%s\n' "$capture_line" | sed -E 's/.*--cwd ([^ ]+).*/\1/')"
    workspace_arg="$(printf '%s\n' "$capture_line" | sed -E 's/.*--workspace ([^ ]+).*/\1/')"
    [[ "$cwd_arg" == "$workspace_arg" ]] || fail "client --cwd and --workspace should be identical"
    [[ "$cwd_arg" == */clients/acme/ ]] || fail "client setup should target the acme workspace"
}

test_client_workspace_failures_are_accumulated_and_fail_setup() {
    local repo home fake_bin log out rc slug
    repo="$(make_repo client-reindex-failures)"
    home="$(make_home client-reindex-failures)"
    fake_bin="$(make_fake_bin client-reindex-failures)"
    log="$TEST_ROOT/client-reindex-failures.log"
    out="$TEST_ROOT/client-reindex-failures.out"

    rm -rf "$home/.codex/hooks.json"
    for slug in acme beta charlie; do
        mkdir -p "$repo/clients/$slug/.claude" "$repo/clients/$slug/context/memory"
        printf "# %s memory\n\nClient note.\n" "$slug" > "$repo/clients/$slug/context/memory/2026-06-15.md"
    done

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_CAPTURE_FAIL_CLIENTS="acme beta"
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )
    rc=$?
    set -e

    [[ $rc -eq 1 ]] || fail "client reindex failures should make setup exit 1"
    assert_contains "$log" "--client acme"
    assert_contains "$log" "--client beta"
    assert_contains "$log" "--client charlie"
    assert_contains "$out" "Client memory reindex failed for: acme beta"
    assert_contains "$out" "searchable memory setup step(s) need attention"
    assert_not_contains "$out" "Searchable memory setup complete"
}

test_hosted_root_reindex_failure_fails_setup_before_clients() {
    local repo home fake_bin log out rc
    repo="$(make_repo hosted-root-reindex-failure)"
    home="$(make_home hosted-root-reindex-failure)"
    fake_bin="$(make_fake_bin hosted-root-reindex-failure)"
    log="$TEST_ROOT/hosted-root-reindex-failure.log"
    out="$TEST_ROOT/hosted-root-reindex-failure.out"

    rm -rf "$home/.codex/hooks.json"
    printf "MEMORY_DATABASE_URL=postgres://user:pass@example.test:5432/memory\n" > "$repo/.env"
    mkdir -p "$repo/clients/acme/.claude" "$repo/clients/acme/context/memory"
    printf "# Acme memory\n" > "$repo/clients/acme/context/memory/2026-06-15.md"

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_REINDEX_FAIL=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )
    rc=$?
    set -e

    [[ $rc -eq 1 ]] || fail "hosted root reindex failure should make setup exit 1"
    assert_contains "$log" "memory:reindex -- --visibility system"
    assert_not_contains "$log" "memory:capture"
    assert_contains "$out" "searchable memory setup step(s) need attention"
    assert_not_contains "$out" "Searchable memory setup complete"
}

test_powershell_client_reindex_contract_matches_bash() {
    local script="$REAL_REPO/scripts/setup-memory.ps1" propagated_count
    assert_contains "$script" '"--cwd", $clientDir'
    assert_contains "$script" '"--workspace", $clientDir'
    assert_contains "$script" '"--visibility", "client"'
    assert_contains "$script" '"--client", $slug'
    assert_not_contains "$script" "[void](Invoke-ClientWorkspaceReindex)"
    propagated_count="$(grep -Fc 'if (-not (Invoke-ClientWorkspaceReindex)) { return $false }' "$script" || true)"
    [[ "$propagated_count" == "2" ]] || fail "PowerShell should propagate hosted and local client reindex failures"
}

test_powershell_client_reindex_runtime() {
    local powershell_bin=""
    if command -v pwsh >/dev/null 2>&1; then
        powershell_bin="pwsh"
    elif command -v powershell.exe >/dev/null 2>&1; then
        powershell_bin="powershell.exe"
    elif command -v powershell >/dev/null 2>&1; then
        powershell_bin="powershell"
    else
        echo "[SKIP] PowerShell memory setup runtime tests (PowerShell not installed)"
        return 0
    fi

    "$powershell_bin" -NoProfile -NonInteractive -ExecutionPolicy Bypass \
        -File "$REAL_REPO/scripts/test-memory-setup.ps1"
}

test_warmup_failure_clears_bge_m3_cache_and_retries() {
    local repo home fake_bin log out warmup_count
    repo="$(make_repo warmup-retry)"
    home="$(make_home warmup-retry)"
    fake_bin="$(make_fake_bin warmup-retry)"
    log="$TEST_ROOT/warmup-retry.log"
    out="$TEST_ROOT/warmup-retry.out"

    rm -rf "$home/.codex/hooks.json"
    mkdir -p "$repo/.command-centre/models/Xenova/bge-m3/onnx" "$repo/.command-centre/models/Other"
    printf "partial onnx\n" > "$repo/.command-centre/models/Xenova/bge-m3/onnx/model_quantized.onnx"
    printf "keep\n" > "$repo/.command-centre/models/Other/model.bin"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_MEMORY_WARMUP_FAIL_ONCE=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )

    assert_contains "$out" "BGE-M3 model warmup failed. Repairing the model cache and trying once more."
    assert_contains "$out" "Cleared BGE-M3 model cache"
    if [[ -f "$repo/.command-centre/models/Xenova/bge-m3/onnx/model_quantized.onnx" ]] \
        && grep -Fq "partial onnx" "$repo/.command-centre/models/Xenova/bge-m3/onnx/model_quantized.onnx"; then
        fail "Corrupt BGE-M3 ONNX file should be cleared before retry"
    fi
    assert_contains "$repo/.command-centre/models/Other/model.bin" "keep"
    warmup_count="$(grep -Fc "run memory:warmup" "$log" || true)"
    [[ "$warmup_count" == "2" ]] || fail "memory:warmup should run twice after one failure, saw $warmup_count"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
}

test_stale_node_modules_runs_npm_ci_before_reindex() {
    local repo home fake_bin log
    repo="$(make_repo stale-node-modules)"
    home="$(make_home stale-node-modules)"
    fake_bin="$(make_fake_bin stale-node-modules)"
    log="$TEST_ROOT/stale-node-modules.log"

    rm -rf "$home/.codex/hooks.json"
    touch -t 202601010000 "$repo/command-centre/node_modules/.package-lock.json"
    touch -t 202602010000 "$repo/command-centre/package-lock.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "npm-ci"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
}

test_missing_dependency_is_repaired_by_npm_ci() {
    local repo home fake_bin log
    repo="$(make_repo missing-dependency)"
    home="$(make_home missing-dependency)"
    fake_bin="$(make_fake_bin missing-dependency)"
    log="$TEST_ROOT/missing-dependency.log"

    rm -rf "$home/.codex/hooks.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_NPM_LS_FAIL_UNTIL_CI=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "npm-ci"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
}

test_npm_ci_failure_does_not_archive_memsearch() {
    local repo home fake_bin log out rc
    repo="$(make_repo npm-ci-failure)"
    home="$(make_home npm-ci-failure)"
    fake_bin="$(make_fake_bin npm-ci-failure)"
    log="$TEST_ROOT/npm-ci-failure.log"
    out="$TEST_ROOT/npm-ci-failure.out"

    rm -rf "$home/.codex/hooks.json"
    rm -f "$repo/command-centre/node_modules/.package-lock.json"
    mkdir -p "$repo/.memsearch/memory"
    printf "# Old memory\n" > "$repo/.memsearch/memory/root.md"

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_NPM_CI_FAIL=1
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )
    rc=$?
    set -e

    [[ $rc -eq 1 ]] || fail "setup-memory should fail when npm ci fails"
    [[ -d "$repo/.memsearch" ]] || fail ".memsearch should not be archived when dependency repair fails"
    assert_contains "$out" "Command Centre dependencies could not be installed."
    assert_contains "$out" "Memory migration did not run, and old .memsearch data was not archived."
    assert_not_contains "$log" "memory:reindex"
}

test_setup_memory_output_has_single_main_heading() {
    local repo home fake_bin log out clean heading_count
    repo="$(make_repo single-heading)"
    home="$(make_home single-heading)"
    fake_bin="$(make_fake_bin single-heading)"
    log="$TEST_ROOT/single-heading.log"
    out="$TEST_ROOT/single-heading.out"
    clean="$TEST_ROOT/single-heading.clean"

    rm -rf "$home/.codex/hooks.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )

    strip_ansi "$out" > "$clean"
    heading_count="$(grep -Fxc "Searchable memory setup" "$clean" || true)"
    [[ "$heading_count" == "1" ]] || {
        cat "$clean" >&2
        fail "setup-memory should print one main heading, saw $heading_count"
    }
    assert_not_contains "$clean" "Memory migration/setup"
}

test_no_legacy_setup_skips_legacy_cleanup() {
    local repo home fake_bin log out
    repo="$(make_repo no-legacy-cleanup)"
    home="$(make_home no-legacy-cleanup)"
    fake_bin="$(make_fake_bin no-legacy-cleanup)"
    log="$TEST_ROOT/no-legacy-cleanup.log"
    out="$TEST_ROOT/no-legacy-cleanup.out"

    rm -f "$home/.codex/hooks.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )

    assert_contains "$out" "Searchable memory setup"
    assert_contains "$out" "No legacy MemSearch data was detected"
    assert_contains "$log" "memory:reindex -- --allow-local"
    assert_default_reindex_roots "$log"
    assert_not_contains "$log" "powershell"
    assert_not_contains "$log" "claude plugin uninstall memsearch"
    assert_not_contains "$log" "codex plugin remove memsearch@memsearch-plugins"
    assert_not_contains "$log" "uv tool uninstall memsearch"
    [[ ! -d "$repo/backups/memsearch-migration" ]] || fail "No .memsearch backup should be created when no legacy traces exist"
}

test_memsearch_data_archived_after_index_and_integrations_removed() {
    local repo home fake_bin log hooks
    repo="$(make_repo migrate-legacy)"
    home="$(make_home migrate-legacy)"
    fake_bin="$(make_fake_bin migrate-legacy)"
    log="$TEST_ROOT/migrate-legacy.log"
    hooks="$home/.codex/hooks.json"

    mkdir -p "$repo/.memsearch/memory" "$repo/clients/acme/.memsearch/memory"
    printf "# Root old memory\n" > "$repo/.memsearch/memory/root.md"
    printf "# Client old memory\n" > "$repo/clients/acme/.memsearch/memory/client.md"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export REPO_UNDER_TEST="$repo"
        export FAKE_MEMSEARCH_LEGACY=1
        export FAKE_CLAUDE_MEMSEARCH_SCOPE=user
        export FAKE_CLAUDE_UNINSTALL_REQUIRE_SCOPE=user
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >/dev/null
    )

    assert_contains "$log" "memsearch-present-during-reindex"
    assert_contains "$log" "--root .memsearch/memory"
    assert_contains "$log" "--root clients/acme/.memsearch/memory"
    assert_default_reindex_roots "$log"
    assert_contains "$log" "claude plugin uninstall memsearch --scope user -y"
    assert_contains "$log" "codex plugin remove memsearch@memsearch-plugins"
    assert_contains "$log" "uv tool uninstall memsearch"
    assert_contains "$log" "powershell"

    [[ ! -d "$repo/.memsearch" ]] || fail "root .memsearch should be archived"
    [[ ! -d "$repo/clients/acme/.memsearch" ]] || fail "client .memsearch should be archived"
    [[ -d "$repo/backups/memsearch-migration" ]] || fail "backup folder should exist"
    assert_not_contains "$hooks" "memsearch"
    assert_contains "$hooks" "node keep.js"
}

test_local_scope_claude_plugin_removed_without_memsearch_dirs() {
    local repo home fake_bin log out
    repo="$(make_repo local-scope-plugin)"
    home="$(make_home local-scope-plugin)"
    fake_bin="$(make_fake_bin local-scope-plugin)"
    log="$TEST_ROOT/local-scope-plugin.log"
    out="$TEST_ROOT/local-scope-plugin.out"

    rm -f "$home/.codex/hooks.json"

    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export FAKE_CLAUDE_MEMSEARCH=1
        export FAKE_CLAUDE_MEMSEARCH_SCOPE=local
        export FAKE_CLAUDE_UNINSTALL_REQUIRE_SCOPE=local
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --yes >"$out" 2>&1
    )

    assert_contains "$log" "claude plugin uninstall memsearch --scope local -y"
    assert_not_contains "$log" "claude plugin uninstall memsearch --scope user -y"
    assert_contains "$out" "Removed Claude Code MemSearch plugin (local scope)"
    assert_not_contains "$out" "Could not remove Claude Code MemSearch plugin automatically"
    [[ ! -d "$repo/backups/memsearch-migration" ]] || fail "No .memsearch backup should be created when no .memsearch dirs exist"
}

test_legacy_check_reports_legacy_presence() {
    local repo home fake_bin log rc
    repo="$(make_repo legacy-check)"
    home="$(make_home legacy-check)"
    fake_bin="$(make_fake_bin legacy-check)"
    log="$TEST_ROOT/legacy-check.log"

    rm -f "$home/.codex/hooks.json"

    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --legacy-check >/dev/null
    )
    rc=$?
    set -e
    [[ $rc -eq 1 ]] || fail "--legacy-check should return 1 when no legacy traces exist"

    mkdir -p "$repo/.memsearch/memory"
    set +e
    (
        cd "$repo"
        export HOME="$home"
        export ACTION_LOG="$log"
        export FAKE_MEMSEARCH_LEGACY=0
        export PATH="$fake_bin${NODE_DIR:+:$NODE_DIR}:/usr/bin:/bin"
        bash scripts/setup-memory.sh --legacy-check >/dev/null
    )
    rc=$?
    set -e
    [[ $rc -eq 0 ]] || fail "--legacy-check should return 0 when .memsearch exists"

    assert_not_contains "$log" "memory:reindex"
    assert_not_contains "$log" "claude plugin uninstall memsearch"
}

test_setup_memory_uses_bash3_compatible_reads() {
    assert_not_contains "$REAL_REPO/scripts/setup-memory.sh" "mapfile"
}

test_check_mode_does_not_mutate
test_existing_local_pglite_is_ready_and_reused
test_local_rebuild_preserves_legacy_private_owner
test_local_rebuild_failure_restores_store_without_changing_owner
test_hosted_postgres_runs_migrate_and_reindex
test_hosted_old_dimension_uses_preserving_upgrade
test_no_backend_defaults_to_local_noninteractive
test_client_workspace_memory_reindexed_after_root_reindex
test_client_workspace_failures_are_accumulated_and_fail_setup
test_hosted_root_reindex_failure_fails_setup_before_clients
test_powershell_client_reindex_contract_matches_bash
test_powershell_client_reindex_runtime
test_warmup_failure_clears_bge_m3_cache_and_retries
test_stale_node_modules_runs_npm_ci_before_reindex
test_missing_dependency_is_repaired_by_npm_ci
test_npm_ci_failure_does_not_archive_memsearch
test_setup_memory_output_has_single_main_heading
test_no_legacy_setup_skips_legacy_cleanup
test_memsearch_data_archived_after_index_and_integrations_removed
test_local_scope_claude_plugin_removed_without_memsearch_dirs
test_legacy_check_reports_legacy_presence
test_setup_memory_uses_bash3_compatible_reads

echo "[PASS] memory setup migration tests"
