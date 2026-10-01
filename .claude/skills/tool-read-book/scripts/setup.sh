#!/usr/bin/env bash
set -euo pipefail
if [ "$#" -eq 0 ]; then
  echo "Usage: bash scripts/setup.sh <required-tool> [...]; existing tools are left alone."
  exit 0
fi
for task_tool in "$@"; do
  if command -v "$task_tool" >/dev/null 2>&1; then
    echo "$task_tool: available"
    continue
  fi
  case "$task_tool" in
    yt-dlp) task_package=yt-dlp ;;
    ffmpeg|ffprobe) task_package=ffmpeg ;;
    pandoc) task_package=pandoc ;;
    pdftotext|pdfinfo) task_package=poppler ;;
    ebook-convert) task_package=calibre ;;
    curl) task_package=curl ;;
    whois) task_package=whois ;;
    node) task_package=node@22 ;;
    python3) task_package=python ;;
    *) echo "$task_tool: no automatic installer; use the platform's supported setup." >&2; exit 1 ;;
  esac
  if [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    brew install "$task_package"
  else
    echo "$task_tool: missing. Install package $task_package with the supported local package manager or use the manual fallback." >&2
    exit 1
  fi
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    echo "$task_tool: install completed but binary is not on PATH; configure the package path before continuing." >&2
    exit 1
  fi
  echo "$task_tool: available"
done
