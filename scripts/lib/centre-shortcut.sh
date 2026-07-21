#!/usr/bin/env bash

AGENTIC_OS_CENTRE_BLOCK_START="# >>> Agentic OS - command centre launcher >>>"
AGENTIC_OS_CENTRE_BLOCK_END="# <<< Agentic OS - command centre launcher <<<"
AGENTIC_OS_CENTRE_LEGACY_MARKER="# Agentic OS - command centre launcher"

AGENTIC_OS_CENTRE_SCAN_COUNT=0
AGENTIC_OS_CENTRE_SCAN_TYPES=()
AGENTIC_OS_CENTRE_SCAN_FILES=()
AGENTIC_OS_CENTRE_SCAN_CURRENT=()
AGENTIC_OS_CENTRE_SCAN_MATCHES=()
AGENTIC_OS_CENTRE_SCAN_LEGACY_LAYOUT=()

AGENTIC_OS_CENTRE_LAST_ACTION=""
AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH=""
AGENTIC_OS_CENTRE_CURRENT_TARGET_TYPE=""
AGENTIC_OS_CENTRE_CURRENT_RELOAD_HINT=""
AGENTIC_OS_CENTRE_REPAIR_UPDATED_COUNT=0
AGENTIC_OS_CENTRE_REPAIR_UNCHANGED_COUNT=0

agentic_os_centre_trim_trailing_newlines() {
    local text="$1"
    while [[ "$text" == *$'\n' ]]; do
        text="${text%$'\n'}"
    done
    printf '%s' "$text"
}

agentic_os_centre_build_alias_line() {
    local target_type="$1"
    local script_path="$2"

    case "$target_type" in
        fish)
            printf "alias centre 'bash \"%s\"'" "$script_path"
            ;;
        *)
            printf "alias centre='bash \"%s\"'" "$script_path"
            ;;
    esac
}

agentic_os_centre_build_block() {
    local target_type="$1"
    local script_path="$2"
    local alias_line=""

    alias_line="$(agentic_os_centre_build_alias_line "$target_type" "$script_path")"
    printf '%s\n%s\n%s' \
        "$AGENTIC_OS_CENTRE_BLOCK_START" \
        "$alias_line" \
        "$AGENTIC_OS_CENTRE_BLOCK_END"
}

agentic_os_centre_remove_blocks() {
    local content="$1"

    awk \
        -v block_start="$AGENTIC_OS_CENTRE_BLOCK_START" \
        -v block_end="$AGENTIC_OS_CENTRE_BLOCK_END" \
        -v legacy_marker="$AGENTIC_OS_CENTRE_LEGACY_MARKER" \
        '
        BEGIN {
            in_block = 0
            skip_legacy_alias = 0
        }
        {
            sub(/\r$/, "", $0)

            if ($0 == block_start) {
                in_block = 1
                next
            }

            if (in_block) {
                if ($0 == block_end) {
                    in_block = 0
                }
                next
            }

            if ($0 == legacy_marker) {
                skip_legacy_alias = 1
                next
            }

            if (skip_legacy_alias) {
                if ($0 ~ /^[[:space:]]*alias[[:space:]]+centre([[:space:]]*=|[[:space:]])/) {
                    skip_legacy_alias = 0
                    next
                }
                skip_legacy_alias = 0
            }

            print $0
        }
        ' <<< "$content"
}

agentic_os_centre_render_content() {
    local existing_content="$1"
    local target_type="$2"
    local script_path="$3"
    local cleaned_content=""
    local block=""

    cleaned_content="$(agentic_os_centre_remove_blocks "$existing_content")"
    cleaned_content="$(agentic_os_centre_trim_trailing_newlines "$cleaned_content")"
    block="$(agentic_os_centre_build_block "$target_type" "$script_path")"

    if [[ -z "$cleaned_content" ]]; then
        printf '%s\n' "$block"
        return 0
    fi

    printf '%s\n\n%s\n' "$cleaned_content" "$block"
}

agentic_os_centre_file_has_marker() {
    local rc_path="$1"

    [[ -f "$rc_path" ]] || return 1
    grep -Fq "$AGENTIC_OS_CENTRE_BLOCK_START" "$rc_path" 2>/dev/null || \
        grep -Fq "$AGENTIC_OS_CENTRE_LEGACY_MARKER" "$rc_path" 2>/dev/null
}

agentic_os_centre_extract_unix_path() {
    local rc_path="$1"
    local target_type="$2"

    [[ -f "$rc_path" ]] || return 0

    case "$target_type" in
        fish)
            sed -n "s#^[[:space:]]*alias[[:space:]]\\+centre[[:space:]]\\+'bash \"\\([^\"]*\\)\"'[[:space:]]*\$#\\1#p" "$rc_path" | tail -n 1
            ;;
        *)
            sed -n "s#^[[:space:]]*alias[[:space:]]\\+centre='bash \"\\([^\"]*\\)\"'[[:space:]]*\$#\\1#p" "$rc_path" | tail -n 1
            ;;
    esac
}

agentic_os_centre_path_is_legacy_layout() {
    local script_path="$1"

    case "$script_path" in
        *"/projects/"*|*"\\projects\\"*)
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

agentic_os_centre_all_unix_targets() {
    printf 'posix|%s\n' "$HOME/.zshrc"
    printf 'posix|%s\n' "$HOME/.bash_profile"
    printf 'posix|%s\n' "$HOME/.bashrc"
    printf 'fish|%s\n' "$HOME/.config/fish/config.fish"
}

agentic_os_centre_current_unix_target() {
    local user_shell_name=""
    local system_name=""

    user_shell_name="$(basename "${SHELL:-}")"
    system_name="$(uname -s)"

    case "$system_name" in
        MINGW*|MSYS*|CYGWIN*)
            printf 'posix|%s|%s\n' "$HOME/.bashrc" "source ~/.bashrc"
            return 0
            ;;
        Darwin|Linux)
            case "$user_shell_name" in
                zsh)
                    printf 'posix|%s|%s\n' "$HOME/.zshrc" "source ~/.zshrc"
                    return 0
                    ;;
                bash)
                    if [[ "$system_name" == "Darwin" ]]; then
                        printf 'posix|%s|%s\n' "$HOME/.bash_profile" "source ~/.bash_profile"
                    else
                        printf 'posix|%s|%s\n' "$HOME/.bashrc" "source ~/.bashrc"
                    fi
                    return 0
                    ;;
                fish)
                    printf 'fish|%s|%s\n' "$HOME/.config/fish/config.fish" "source ~/.config/fish/config.fish"
                    return 0
                    ;;
            esac
            ;;
    esac

    return 1
}

agentic_os_centre_upsert_target() {
    local rc_path="$1"
    local target_type="$2"
    local script_path="$3"
    local existing_content=""
    local desired_content=""
    local had_marker=false

    if [[ -f "$rc_path" ]]; then
        existing_content="$(cat "$rc_path")"
        if agentic_os_centre_file_has_marker "$rc_path"; then
            had_marker=true
        fi
    fi

    desired_content="$(agentic_os_centre_render_content "$existing_content" "$target_type" "$script_path")"

    if [[ "$desired_content" == "$existing_content" ]]; then
        AGENTIC_OS_CENTRE_LAST_ACTION="unchanged"
        return 0
    fi

    mkdir -p "$(dirname "$rc_path")"
    printf '%s' "$desired_content" > "$rc_path"

    if $had_marker; then
        AGENTIC_OS_CENTRE_LAST_ACTION="updated"
    else
        AGENTIC_OS_CENTRE_LAST_ACTION="added"
    fi
}

agentic_os_centre_install_current_unix_shortcut() {
    local script_path="$1"
    local target_info=""
    local target_type=""
    local target_path=""
    local reload_hint=""

    if ! target_info="$(agentic_os_centre_current_unix_target)"; then
        return 1
    fi

    IFS='|' read -r target_type target_path reload_hint <<< "$target_info"
    agentic_os_centre_upsert_target "$target_path" "$target_type" "$script_path"
    AGENTIC_OS_CENTRE_CURRENT_TARGET_TYPE="$target_type"
    AGENTIC_OS_CENTRE_CURRENT_TARGET_PATH="$target_path"
    AGENTIC_OS_CENTRE_CURRENT_RELOAD_HINT="$reload_hint"
    return 0
}

agentic_os_centre_reset_scan() {
    AGENTIC_OS_CENTRE_SCAN_COUNT=0
    AGENTIC_OS_CENTRE_SCAN_TYPES=()
    AGENTIC_OS_CENTRE_SCAN_FILES=()
    AGENTIC_OS_CENTRE_SCAN_CURRENT=()
    AGENTIC_OS_CENTRE_SCAN_MATCHES=()
    AGENTIC_OS_CENTRE_SCAN_LEGACY_LAYOUT=()
}

agentic_os_centre_scan_unix_shortcuts() {
    local expected_script_path="$1"
    local target_type=""
    local target_path=""
    local current_script_path=""
    local matches_current_repo="false"
    local legacy_layout="false"

    agentic_os_centre_reset_scan

    while IFS='|' read -r target_type target_path; do
        [[ -n "$target_path" ]] || continue
        if ! agentic_os_centre_file_has_marker "$target_path"; then
            continue
        fi

        current_script_path="$(agentic_os_centre_extract_unix_path "$target_path" "$target_type")"
        [[ -n "$current_script_path" ]] || continue

        if [[ "$current_script_path" == "$expected_script_path" ]]; then
            matches_current_repo="true"
        else
            matches_current_repo="false"
        fi

        if agentic_os_centre_path_is_legacy_layout "$current_script_path"; then
            legacy_layout="true"
        else
            legacy_layout="false"
        fi

        AGENTIC_OS_CENTRE_SCAN_TYPES+=("$target_type")
        AGENTIC_OS_CENTRE_SCAN_FILES+=("$target_path")
        AGENTIC_OS_CENTRE_SCAN_CURRENT+=("$current_script_path")
        AGENTIC_OS_CENTRE_SCAN_MATCHES+=("$matches_current_repo")
        AGENTIC_OS_CENTRE_SCAN_LEGACY_LAYOUT+=("$legacy_layout")
    done < <(agentic_os_centre_all_unix_targets)

    AGENTIC_OS_CENTRE_SCAN_COUNT=${#AGENTIC_OS_CENTRE_SCAN_FILES[@]}
}

agentic_os_centre_repair_detected_unix_shortcuts() {
    local expected_script_path="$1"
    local i=0

    AGENTIC_OS_CENTRE_REPAIR_UPDATED_COUNT=0
    AGENTIC_OS_CENTRE_REPAIR_UNCHANGED_COUNT=0

    for i in "${!AGENTIC_OS_CENTRE_SCAN_FILES[@]}"; do
        agentic_os_centre_upsert_target \
            "${AGENTIC_OS_CENTRE_SCAN_FILES[$i]}" \
            "${AGENTIC_OS_CENTRE_SCAN_TYPES[$i]}" \
            "$expected_script_path"

        case "$AGENTIC_OS_CENTRE_LAST_ACTION" in
            added|updated)
                AGENTIC_OS_CENTRE_REPAIR_UPDATED_COUNT=$((AGENTIC_OS_CENTRE_REPAIR_UPDATED_COUNT + 1))
                ;;
            *)
                AGENTIC_OS_CENTRE_REPAIR_UNCHANGED_COUNT=$((AGENTIC_OS_CENTRE_REPAIR_UNCHANGED_COUNT + 1))
                ;;
        esac
    done
}
