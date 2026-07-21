#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import shutil
import sys
from copy import deepcopy
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


STATE_VERSION = 1

DEFAULT_USER_MD = """# User Preferences

## Communication

- Preferred language:
- Tone preferences:
- Output preferences:

## Working Style

- Decision style:
- Typical tasks:
- Constraints or non-negotiables:

## Notes

- Add user-specific preferences here as they become clear.
"""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def state_defaults() -> dict[str, Any]:
    return {
        "version": STATE_VERSION,
        "guided_install_completed": False,
        "guided_install_completed_at": None,
        "bootstrap_valid": False,
        "bootstrap_last_repaired_at": None,
        "decisions": {
            "github_backup": "unknown",
            "gsd_install": "unknown",
            "launcher_alias": "unknown",
            "memory_setup": "unknown",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AI-OS helper for launcher bootstrap and state management."
    )
    parser.add_argument("--repo-root", required=True, help="Absolute or relative repository root")

    subparsers = parser.add_subparsers(dest="command", required=True)

    for name in ("bootstrap-status", "bootstrap-repair", "state-status"):
        sub = subparsers.add_parser(name)
        sub.add_argument("--field", help="Optional dotted field path to print instead of full JSON")

    subparsers.add_parser("state-migrate-legacy")

    guided = subparsers.add_parser("state-mark-guided")
    guided.add_argument("--github", required=True)
    guided.add_argument("--gsd", required=True)
    guided.add_argument("--launcher", required=True)
    guided.add_argument("--memory", required=True)
    guided.add_argument("--bootstrap-valid", choices=("true", "false"), required=True)

    repair = subparsers.add_parser("state-mark-repair")
    repair.add_argument("--bootstrap-valid", choices=("true", "false"), required=True)

    memory = subparsers.add_parser("state-mark-memory")
    memory.add_argument("--memory", required=True)

    return parser.parse_args()


def repo_root_from_arg(value: str) -> Path:
    return Path(value).expanduser().resolve()


def command_centre_state_path(repo_root: Path) -> Path:
    return repo_root / ".command-centre" / "launcher-state.json"


def installed_json_path(repo_root: Path) -> Path:
    return repo_root / ".claude" / "skills" / "_catalog" / "installed.json"


def catalog_path(repo_root: Path) -> Path:
    return repo_root / ".claude" / "skills" / "_catalog" / "catalog.json"


def user_md_path(repo_root: Path) -> Path:
    return repo_root / "context" / "USER.md"


def learnings_md_path(repo_root: Path) -> Path:
    return repo_root / "context" / "learnings.md"


def env_path(repo_root: Path) -> Path:
    return repo_root / ".env"


def env_example_path(repo_root: Path) -> Path:
    return repo_root / ".env.example"


def brand_context_path(repo_root: Path) -> Path:
    return repo_root / "brand_context"


def context_memory_path(repo_root: Path) -> Path:
    return repo_root / "context" / "memory"


def skill_directories(repo_root: Path) -> list[str]:
    skills_root = repo_root / ".claude" / "skills"
    if not skills_root.is_dir():
        return []

    names: list[str] = []
    for path in skills_root.iterdir():
        if not path.is_dir():
            continue
        if path.name.startswith("_"):
            continue
        names.append(path.name)
    return sorted(names)


def build_default_learnings(repo_root: Path) -> str:
    lines = [
        "# General",
        "",
        "- Add cross-skill learnings here.",
        "",
        "# Individual Skills",
        "",
    ]

    for skill_name in skill_directories(repo_root):
        lines.extend(
            [
                f"## {skill_name}",
                "",
                "- Add feedback and adjustments for this skill here.",
                "",
            ]
        )

    return "\n".join(lines).rstrip() + "\n"


def bootstrap_status(repo_root: Path) -> dict[str, Any]:
    missing: list[str] = []
    errors: list[str] = []

    checks = (
        ("env", env_path(repo_root).is_file()),
        ("brand_context_dir", brand_context_path(repo_root).is_dir()),
        ("context_user", user_md_path(repo_root).is_file()),
        ("context_learnings", learnings_md_path(repo_root).is_file()),
        ("context_memory_dir", context_memory_path(repo_root).is_dir()),
        ("installed_json", installed_json_path(repo_root).is_file()),
    )

    for key, present in checks:
        if not present:
            missing.append(key)

    if not catalog_path(repo_root).is_file():
        errors.append(f"Catalog not found at {catalog_path(repo_root)}")

    return {
        "bootstrap_valid": len(missing) == 0,
        "missing": missing,
        "errors": errors,
        "env_path": str(env_path(repo_root)),
        "user_md_path": str(user_md_path(repo_root)),
        "learnings_md_path": str(learnings_md_path(repo_root)),
        "installed_json_path": str(installed_json_path(repo_root)),
    }


def write_installed_json(repo_root: Path) -> None:
    catalog_file = catalog_path(repo_root)
    if not catalog_file.is_file():
        raise FileNotFoundError(f"Catalog not found at {catalog_file}")

    with catalog_file.open("r", encoding="utf-8") as handle:
        catalog = json.load(handle)

    core = catalog.get("core_skills", [])
    optional = catalog.get("skills", {})
    all_skills = sorted(set(core) | set(optional.keys()))

    payload = {
        "installed_at": date.today().isoformat(),
        "version": catalog.get("version"),
        "installed_skills": all_skills,
        "removed_skills": [],
        "selection_pending": True,
    }

    target = installed_json_path(repo_root)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")


def repair_bootstrap(repo_root: Path) -> dict[str, Any]:
    created: list[str] = []
    errors: list[str] = []

    (repo_root / ".command-centre").mkdir(parents=True, exist_ok=True)

    if not brand_context_path(repo_root).is_dir():
        brand_context_path(repo_root).mkdir(parents=True, exist_ok=True)
        created.append("brand_context_dir")

    if not context_memory_path(repo_root).is_dir():
        context_memory_path(repo_root).mkdir(parents=True, exist_ok=True)
        created.append("context_memory_dir")

    if not env_path(repo_root).is_file():
        env_example = env_example_path(repo_root)
        if env_example.is_file():
            shutil.copyfile(env_example, env_path(repo_root))
        else:
            env_path(repo_root).write_text("# Add your API keys here.\n", encoding="utf-8")
        created.append("env")

    if not user_md_path(repo_root).is_file():
        user_md_path(repo_root).parent.mkdir(parents=True, exist_ok=True)
        user_md_path(repo_root).write_text(DEFAULT_USER_MD.rstrip() + "\n", encoding="utf-8")
        created.append("context_user")

    if not learnings_md_path(repo_root).is_file():
        learnings_md_path(repo_root).parent.mkdir(parents=True, exist_ok=True)
        learnings_md_path(repo_root).write_text(build_default_learnings(repo_root), encoding="utf-8")
        created.append("context_learnings")

    if not installed_json_path(repo_root).is_file():
        try:
            write_installed_json(repo_root)
            created.append("installed_json")
        except FileNotFoundError as exc:
            errors.append(str(exc))

    status = bootstrap_status(repo_root)
    status["created"] = created
    status["errors"] = sorted(set(status["errors"] + errors))
    return status


def merge_state(data: dict[str, Any] | None) -> dict[str, Any]:
    merged = deepcopy(state_defaults())
    if not data:
        return merged

    for key, value in data.items():
        if key == "decisions" and isinstance(value, dict):
            merged["decisions"].update(value)
        else:
            merged[key] = value
    return merged


def read_state_file(repo_root: Path) -> tuple[Path, dict[str, Any] | None]:
    path = command_centre_state_path(repo_root)
    if not path.is_file():
        return path, None

    with path.open("r", encoding="utf-8") as handle:
        return path, merge_state(json.load(handle))


def write_state_file(repo_root: Path, payload: dict[str, Any]) -> Path:
    state_path = command_centre_state_path(repo_root)
    state_path.parent.mkdir(parents=True, exist_ok=True)
    with state_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    return state_path


def legacy_state_payload() -> dict[str, Any]:
    payload = state_defaults()
    payload["guided_install_completed"] = True
    payload["bootstrap_valid"] = True
    payload["decisions"] = {
        "github_backup": "legacy-unknown",
        "gsd_install": "legacy-unknown",
        "launcher_alias": "legacy-unknown",
        "memory_setup": "legacy-unknown",
    }
    return payload


def state_status(repo_root: Path) -> dict[str, Any]:
    bootstrap = bootstrap_status(repo_root)
    state_path, stored_state = read_state_file(repo_root)

    state_exists = stored_state is not None
    legacy_install_detected = (not state_exists) and bootstrap["bootstrap_valid"]

    effective_state = merge_state(stored_state)
    if legacy_install_detected:
        effective_state = merge_state(legacy_state_payload())

    effective_state["bootstrap_valid"] = bootstrap["bootstrap_valid"]

    return {
        **effective_state,
        "state_exists": state_exists,
        "legacy_install_detected": legacy_install_detected,
        "state_path": str(state_path),
    }


def migrate_legacy_state(repo_root: Path) -> dict[str, Any]:
    status = state_status(repo_root)
    if status["state_exists"] or not status["legacy_install_detected"]:
        return status

    payload = merge_state(legacy_state_payload())
    payload["guided_install_completed_at"] = utc_now_iso()
    payload["bootstrap_valid"] = status["bootstrap_valid"]
    write_state_file(repo_root, payload)
    return state_status(repo_root)


def persistable_state(repo_root: Path) -> dict[str, Any]:
    _, stored_state = read_state_file(repo_root)
    if stored_state is not None:
        return merge_state(stored_state)

    status = state_status(repo_root)
    if status["legacy_install_detected"]:
        return merge_state(legacy_state_payload())

    return merge_state(None)


def mark_guided_state(
    repo_root: Path,
    github_status: str,
    gsd_status: str,
    launcher_status: str,
    memory_status: str,
    bootstrap_valid: bool,
) -> dict[str, Any]:
    payload = persistable_state(repo_root)

    payload["version"] = STATE_VERSION
    payload["guided_install_completed"] = True
    payload["guided_install_completed_at"] = utc_now_iso()
    payload["bootstrap_valid"] = bootstrap_valid
    payload["decisions"] = {
        "github_backup": github_status,
        "gsd_install": gsd_status,
        "launcher_alias": launcher_status,
        "memory_setup": memory_status,
    }

    write_state_file(repo_root, payload)
    return state_status(repo_root)


def mark_repair_state(repo_root: Path, bootstrap_valid: bool) -> dict[str, Any]:
    payload = persistable_state(repo_root)

    payload["version"] = STATE_VERSION
    payload["bootstrap_valid"] = bootstrap_valid
    payload["bootstrap_last_repaired_at"] = utc_now_iso()

    write_state_file(repo_root, payload)
    return state_status(repo_root)


def mark_memory_state(repo_root: Path, memory_status: str) -> dict[str, Any]:
    payload = persistable_state(repo_root)

    payload["version"] = STATE_VERSION
    payload["decisions"]["memory_setup"] = memory_status

    write_state_file(repo_root, payload)
    return state_status(repo_root)


def get_field(data: dict[str, Any], dotted_path: str) -> Any:
    value: Any = data
    for part in dotted_path.split("."):
        if not isinstance(value, dict) or part not in value:
            raise KeyError(f"Unknown field: {dotted_path}")
        value = value[part]
    return value


def emit(data: dict[str, Any], field: str | None) -> int:
    if field:
        value = get_field(data, field)
        if isinstance(value, bool):
            print("true" if value else "false")
        elif value is None:
            print("null")
        elif isinstance(value, (dict, list)):
            print(json.dumps(value))
        else:
            print(value)
        return 0

    print(json.dumps(data, indent=2))
    return 0


def main() -> int:
    args = parse_args()
    repo_root = repo_root_from_arg(args.repo_root)

    try:
        if args.command == "bootstrap-status":
            return emit(bootstrap_status(repo_root), args.field)

        if args.command == "bootstrap-repair":
            result = repair_bootstrap(repo_root)
            exit_code = 0 if not result["errors"] else 1
            emit(result, args.field)
            return exit_code

        if args.command == "state-status":
            return emit(state_status(repo_root), args.field)

        if args.command == "state-migrate-legacy":
            print(json.dumps(migrate_legacy_state(repo_root), indent=2))
            return 0

        if args.command == "state-mark-guided":
            result = mark_guided_state(
                repo_root=repo_root,
                github_status=args.github,
                gsd_status=args.gsd,
                launcher_status=args.launcher,
                memory_status=args.memory,
                bootstrap_valid=args.bootstrap_valid == "true",
            )
            print(json.dumps(result, indent=2))
            return 0

        if args.command == "state-mark-repair":
            result = mark_repair_state(
                repo_root=repo_root,
                bootstrap_valid=args.bootstrap_valid == "true",
            )
            print(json.dumps(result, indent=2))
            return 0

        if args.command == "state-mark-memory":
            result = mark_memory_state(
                repo_root=repo_root,
                memory_status=args.memory,
            )
            print(json.dumps(result, indent=2))
            return 0

        raise ValueError(f"Unknown command: {args.command}")
    except (FileNotFoundError, KeyError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
