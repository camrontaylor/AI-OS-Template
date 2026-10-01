#!/usr/bin/env bash

# Shared Python 3 resolution for AI-OS shell scripts.

PYTHON_CMD=()
PYTHON_LABEL=""
PYTHON_VERSION=""
PYTHON_PATH=""
PYTHON3_DIAGNOSTIC_PATH=""
PYTHON3_DIAGNOSTIC_OUTPUT=""
PYTHON3_DIAGNOSTIC_BROKEN=0

if [[ -z "${PYTHONUTF8:-}" ]]; then
    export PYTHONUTF8=1
fi

if [[ -z "${PYTHONIOENCODING:-}" ]]; then
    export PYTHONIOENCODING="utf-8"
fi

is_windows_shell() {
    case "$(uname -s 2>/dev/null)" in
        MINGW*|MSYS*|CYGWIN*) return 0 ;;
        *) return 1 ;;
    esac
}

_python3_version_check() {
    "$@" -c 'import sys; assert sys.version_info[0] == 3; print(".".join(str(part) for part in sys.version_info[:3]))' 2>/dev/null
}

_set_python_command() {
    local label="$1"
    shift

    local version path
    if ! version="$(_python3_version_check "$@")"; then
        return 1
    fi

    PYTHON_CMD=("$@")
    PYTHON_LABEL="$label"
    PYTHON_VERSION="$version"

    if path="$(command -v "$1" 2>/dev/null)"; then
        PYTHON_PATH="$path"
    else
        PYTHON_PATH="$1"
    fi

    return 0
}

inspect_python3_diagnostic() {
    PYTHON3_DIAGNOSTIC_PATH=""
    PYTHON3_DIAGNOSTIC_OUTPUT=""
    PYTHON3_DIAGNOSTIC_BROKEN=0

    if ! command -v python3 >/dev/null 2>&1; then
        return 1
    fi

    PYTHON3_DIAGNOSTIC_PATH="$(command -v python3)"
    if ! PYTHON3_DIAGNOSTIC_OUTPUT="$(_python3_version_check python3 2>&1)"; then
        PYTHON3_DIAGNOSTIC_BROKEN=1
    fi

    return 0
}

resolve_python_cmd() {
    PYTHON_CMD=()
    PYTHON_LABEL=""
    PYTHON_VERSION=""
    PYTHON_PATH=""

    inspect_python3_diagnostic >/dev/null 2>&1 || true

    if is_windows_shell; then
        _set_python_command "py -3" py -3 && return 0
        _set_python_command "python" python && return 0
        _set_python_command "python3" python3 && return 0
    else
        _set_python_command "python3" python3 && return 0
        _set_python_command "python" python && return 0
    fi

    return 1
}
