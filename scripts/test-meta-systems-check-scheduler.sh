#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHECK="$ROOT/.claude/skills/meta-systems-check/scripts/check.sh"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT

fake_root="$fixture/root"
fake_home="$fixture/home"
fake_bin="$fixture/bin"
mkdir -p \
  "$fake_root/integrations/hermes/cron-migration" \
  "$fake_home/Library/LaunchAgents" \
  "$fake_bin"
touch "$fake_home/Library/LaunchAgents/com.aios.cron-daemon.plist"

printf '#!/usr/bin/env bash\nprintf "Darwin\\n"\n' > "$fake_bin/uname"
printf '#!/usr/bin/env bash\nexit 1\n' > "$fake_bin/launchctl"
chmod +x "$fake_bin/uname" "$fake_bin/launchctl"

printf '%s\n' '{"scheduler": "Hermes gateway cron", "jobs": [{"slug": "fixture"}]}' \
  > "$fake_root/integrations/hermes/cron-migration/manifest.json"

remote_output="$(HOME="$fake_home" PATH="$fake_bin:$PATH" AI_OS_ROOT="$fake_root" bash "$CHECK")"
grep -Fq 'Mac cron is intentionally stopped for the Hermes VPS scheduler topology.' <<< "$remote_output"
if grep -Fq 'Cron plist exists but the daemon is not loaded.' <<< "$remote_output"; then
  echo "remote scheduler topology produced the local-daemon warning" >&2
  exit 1
fi

rm -f "$fake_root/integrations/hermes/cron-migration/manifest.json"
local_output="$(HOME="$fake_home" PATH="$fake_bin:$PATH" AI_OS_ROOT="$fake_root" bash "$CHECK")"
grep -Fq 'Cron plist exists but the daemon is not loaded.' <<< "$local_output"

echo "meta-systems-check scheduler topology: passed"
