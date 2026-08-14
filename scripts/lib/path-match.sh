#!/usr/bin/env bash
# Shared ownership path matching for update and template sync flows.

path_matches_pattern() {
    local path="$1"
    local pattern="$2"
    [[ -z "$pattern" ]] && return 1

    if [[ "$pattern" == */ ]]; then
        # shellcheck disable=SC2254
        case "$path" in
            $pattern*) return 0 ;;
        esac
        return 1
    fi

    # shellcheck disable=SC2254
    case "$path" in
        $pattern) return 0 ;;
    esac
    return 1
}

path_matches_any() {
    local path="$1"
    shift || true
    local pattern
    for pattern in "$@"; do
        if path_matches_pattern "$path" "$pattern"; then
            return 0
        fi
    done
    return 1
}

path_matches_any_file() {
    local path="$1"
    local listfile="$2"
    local pattern
    while IFS= read -r pattern; do
        [[ -z "$pattern" ]] && continue
        if path_matches_pattern "$path" "$pattern"; then
            return 0
        fi
    done < "$listfile"
    return 1
}
