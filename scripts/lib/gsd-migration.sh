#!/usr/bin/env bash
# Safe migration from legacy GSD packages/files to OpenGSD Redux.

AGENTIC_OS_GSD_REDUX_PACKAGE="@opengsd/get-shit-done-redux@latest"
AGENTIC_OS_GSD_LEGACY_PACKAGES=(
    "get-shit-done-cc"
    "get-shit-done-redux"
    "@gsd-build/sdk"
    "@gsd-redux/sdk"
)

agentic_os_gsd_note() { printf "  %s\n" "$1"; }
agentic_os_gsd_warn() { printf "  ! %s\n" "$1"; }

agentic_os_gsd_path_abs() {
    local target="$1"
    local dir
    local base

    if [[ -d "$target" ]]; then
        (cd "$target" 2>/dev/null && pwd -P)
        return
    fi

    dir="$(dirname "$target")"
    base="$(basename "$target")"
    (cd "$dir" 2>/dev/null && printf "%s/%s\n" "$(pwd -P)" "$base")
}

agentic_os_gsd_path_is_within() {
    local target_abs="$1"
    local root_abs="$2"

    [[ -n "$target_abs" ]] || return 1
    [[ -n "$root_abs" ]] || return 1
    [[ "$target_abs" == "$root_abs"/* ]]
}

agentic_os_gsd_is_protected_path() {
    local path_text="$1"

    case "$path_text" in
        */.planning|*/.planning/*|*.planning|*.planning/*)
            return 0
            ;;
    esac

    return 1
}

agentic_os_gsd_config_dirs() {
    local repo_root="$1"

    {
        if [[ -n "${CLAUDE_CONFIG_DIR:-}" ]]; then
            printf "%s\n" "$CLAUDE_CONFIG_DIR"
        fi
        printf "%s\n" "$HOME/.claude"
        printf "%s\n" "$repo_root/.claude"
    } | awk 'NF && !seen[$0]++'
}

agentic_os_gsd_redux_version() {
    local repo_root="$1"
    local config_dir
    local version_file

    # get-shit-done/VERSION is the marker that Redux is installed — the same
    # signal the update hook trusts (.claude/hooks/gsd-check-update.js).
    while IFS= read -r config_dir; do
        [[ -n "$config_dir" ]] || continue
        version_file="$config_dir/get-shit-done/VERSION"
        if [[ -f "$version_file" ]]; then
            tr -d '[:space:]' < "$version_file"
            printf "\n"
            return 0
        fi
    done < <(agentic_os_gsd_config_dirs "$repo_root")

    return 1
}

agentic_os_gsd_detect_legacy_npm() {
    local repo_root="$1"
    local package
    local global_json=""
    local local_json=""

    if ! command -v npm >/dev/null 2>&1; then
        return 0
    fi

    global_json="$(npm ls -g --depth=0 --json 2>/dev/null || true)"
    if [[ -f "$repo_root/package.json" ]]; then
        local_json="$(cd "$repo_root" && npm ls --depth=0 --json 2>/dev/null || true)"
    fi

    for package in "${AGENTIC_OS_GSD_LEGACY_PACKAGES[@]}"; do
        if printf "%s" "$global_json" | grep -Fq "\"$package\""; then
            printf "npm:global:%s\n" "$package"
        fi
        if [[ -n "$local_json" ]] && printf "%s" "$local_json" | grep -Fq "\"$package\""; then
            printf "npm:local:%s\n" "$package"
        fi
    done
}

agentic_os_gsd_detect_legacy_files() {
    local repo_root="$1"
    local config_dir
    local file
    local redux_present

    while IFS= read -r config_dir; do
        [[ -n "$config_dir" ]] || continue

        # Redux's runtime lives in get-shit-done/ with a VERSION file. Its presence
        # means this config dir holds a healthy Redux install, so Redux-owned
        # artifacts here must not be flagged as legacy. This is the same marker the
        # update hook trusts (.claude/hooks/gsd-check-update.js).
        redux_present=0
        [[ -f "$config_dir/get-shit-done/VERSION" ]] && redux_present=1

        # Old command-bundle layout — never produced by Redux.
        if [[ -d "$config_dir/commands/gsd" ]]; then
            printf "file:%s\n" "$config_dir/commands/gsd"
        fi

        # A bare get-shit-done/ without a VERSION file is the pre-Redux runtime.
        if [[ -d "$config_dir/get-shit-done" && "$redux_present" -eq 0 ]]; then
            printf "file:%s\n" "$config_dir/get-shit-done"
        fi

        # Loose gsd-*.md command/agent files: Redux installs agents/gsd-*.md, so
        # only treat these as legacy when Redux is not installed in this config dir.
        if [[ "$redux_present" -eq 0 ]]; then
            for file in "$config_dir"/agents/gsd-*.md "$config_dir"/commands/gsd-*.md; do
                [[ -e "$file" ]] || continue
                printf "file:%s\n" "$file"
            done
        fi
    done < <(agentic_os_gsd_config_dirs "$repo_root")
}

agentic_os_gsd_detect_legacy() {
    local repo_root="$1"

    {
        agentic_os_gsd_detect_legacy_npm "$repo_root"
        agentic_os_gsd_detect_legacy_files "$repo_root"
    } | awk 'NF && !seen[$0]++'
}

agentic_os_gsd_print_legacy_warning() {
    local findings="$1"

    echo ""
    agentic_os_gsd_warn "Legacy GSD detected."
    echo ""
    echo "The old GSD npm package is no longer the recommended source."
    echo "AI-OS can remove the old npm package and generated GSD command files,"
    echo "then install GSD-redux from @opengsd."
    echo ""
    echo "Detected:"
    printf "%s\n" "$findings" | while IFS= read -r finding; do
        [[ -n "$finding" ]] || continue
        case "$finding" in
            npm:global:*) agentic_os_gsd_note "global npm package: ${finding#npm:global:}" ;;
            npm:local:*) agentic_os_gsd_note "local npm package: ${finding#npm:local:}" ;;
            file:*) agentic_os_gsd_note "generated file or folder: ${finding#file:}" ;;
        esac
    done
    echo ""
    echo "Your .planning/ folders are project data and will not be removed."
    echo ""
}

agentic_os_gsd_should_migrate() {
    local reply=""

    case "${AGENTIC_OS_GSD_MIGRATE:-}" in
        1|true|TRUE|yes|YES|y|Y)
            return 0
            ;;
        0|false|FALSE|no|NO|n|N)
            return 1
            ;;
        "")
            ;;
        *)
            agentic_os_gsd_warn "Ignoring invalid AGENTIC_OS_GSD_MIGRATE value: $AGENTIC_OS_GSD_MIGRATE"
            ;;
    esac

    if [[ ! -t 0 ]]; then
        agentic_os_gsd_warn "Skipping legacy GSD cleanup because this shell is not interactive."
        agentic_os_gsd_warn "Set AGENTIC_OS_GSD_MIGRATE=1 to approve cleanup non-interactively."
        return 1
    fi

    printf "  Remove legacy GSD and install GSD-redux? [Y/n] "
    read -r reply
    reply="${reply:-Y}"
    [[ "$reply" =~ ^([Yy]|[Yy][Ee][Ss])$ ]]
}

agentic_os_gsd_safe_remove_path() {
    local target="$1"
    local config_root="$2"
    local target_abs
    local root_abs

    [[ -e "$target" ]] || return 0

    if agentic_os_gsd_is_protected_path "$target"; then
        agentic_os_gsd_warn "Skipped protected project data: $target"
        return 0
    fi

    target_abs="$(agentic_os_gsd_path_abs "$target" || true)"
    root_abs="$(agentic_os_gsd_path_abs "$config_root" || true)"

    if ! agentic_os_gsd_path_is_within "$target_abs" "$root_abs"; then
        agentic_os_gsd_warn "Skipped path outside expected config folder: $target"
        return 0
    fi

    rm -rf -- "$target"
}

agentic_os_gsd_cleanup_legacy() {
    local repo_root="$1"
    local findings="$2"
    local finding
    local package
    local target
    local config_root
    local candidate_root
    local target_abs
    local root_abs

    while IFS= read -r finding; do
        [[ -n "$finding" ]] || continue
        case "$finding" in
            npm:global:*)
                package="${finding#npm:global:}"
                npm uninstall -g "$package" >/dev/null 2>&1 || agentic_os_gsd_warn "Could not remove global npm package: $package"
                ;;
            npm:local:*)
                package="${finding#npm:local:}"
                if [[ -f "$repo_root/package.json" ]]; then
                    (cd "$repo_root" && npm uninstall "$package" >/dev/null 2>&1) || agentic_os_gsd_warn "Could not remove local npm package: $package"
                fi
                ;;
            file:*)
                target="${finding#file:}"
                config_root=""
                while IFS= read -r candidate_root; do
                    target_abs="$(agentic_os_gsd_path_abs "$target" || true)"
                    root_abs="$(agentic_os_gsd_path_abs "$candidate_root" || true)"
                    if agentic_os_gsd_path_is_within "$target_abs" "$root_abs"; then
                        config_root="$candidate_root"
                        break
                    fi
                done < <(agentic_os_gsd_config_dirs "$repo_root")
                if [[ -n "$config_root" ]]; then
                    agentic_os_gsd_safe_remove_path "$target" "$config_root"
                else
                    agentic_os_gsd_warn "Skipped path outside known GSD config folders: $target"
                fi
                ;;
        esac
    done <<< "$findings"
}

agentic_os_gsd_offer_legacy_migration() {
    local repo_root="$1"
    local findings

    AGENTIC_OS_GSD_MIGRATION_RESULT="no-legacy"
    findings="$(agentic_os_gsd_detect_legacy "$repo_root")"

    if [[ -z "$findings" ]]; then
        return 0
    fi

    agentic_os_gsd_print_legacy_warning "$findings"

    if ! agentic_os_gsd_should_migrate; then
        AGENTIC_OS_GSD_MIGRATION_RESULT="declined"
        return 1
    fi

    agentic_os_gsd_cleanup_legacy "$repo_root" "$findings"
    AGENTIC_OS_GSD_MIGRATION_RESULT="cleaned"
    return 0
}

agentic_os_gsd_install_redux() {
    npx -y "$AGENTIC_OS_GSD_REDUX_PACKAGE" --global --claude
}

agentic_os_gsd_run_update_migration() {
    local repo_root="$1"

    if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
        return 0
    fi

    if agentic_os_gsd_offer_legacy_migration "$repo_root"; then
        if [[ "$AGENTIC_OS_GSD_MIGRATION_RESULT" == "cleaned" ]]; then
            if agentic_os_gsd_install_redux; then
                AGENTIC_OS_GSD_UPDATE_STATUS="migrated to OpenGSD Redux"
            else
                AGENTIC_OS_GSD_UPDATE_STATUS="migration cleanup completed, OpenGSD Redux install failed"
                return 1
            fi
        fi
    else
        AGENTIC_OS_GSD_UPDATE_STATUS="legacy cleanup skipped"
    fi

    return 0
}
