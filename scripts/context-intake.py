#!/usr/bin/env python3
"""Create review-first promotion plans for AI-OS context inboxes."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from dataclasses import dataclass
from pathlib import Path


DEFAULT_POLICY = Path("config/memory-index-policy.json")


@dataclass
class IntakeItem:
    path: Path
    rel_path: str
    size_bytes: int
    classification: str
    index_tier: str
    proposed_destination: str
    reason: str


def load_policy(workspace: Path) -> dict:
    policy_path = workspace / DEFAULT_POLICY
    if not policy_path.exists():
        raise SystemExit(f"Missing policy file: {policy_path}")
    return json.loads(policy_path.read_text(encoding="utf-8"))


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "", value.lower().replace(" ", "-"))
    slug = re.sub(r"-+", "-", slug).strip("-")
    if not slug:
        raise SystemExit("Client slug is empty after normalization.")
    return slug


def ensure_scope_dirs(workspace: Path, client: str | None) -> dict[str, Path]:
    if client:
        base = workspace / "clients" / client / "context"
        if not (workspace / "clients" / client).is_dir():
            raise SystemExit(f"Client folder does not exist: clients/{client}")
    else:
        base = workspace / "context"

    dirs = {
        "base": base,
        "inbox": base / "inbox",
        "reference": base / "reference",
        "review": base / "intake" / "review",
        "parked": base / "intake" / "parked",
    }
    for path in dirs.values():
        path.mkdir(parents=True, exist_ok=True)
    for name in ("inbox", "reference", "review", "parked"):
        keep = dirs[name] / ".gitkeep"
        if not keep.exists():
            keep.write_text("", encoding="utf-8")
    return dirs


def iter_inbox_files(inbox: Path) -> list[Path]:
    files = []
    for path in sorted(inbox.rglob("*")):
        if path.is_file() and path.name != ".gitkeep" and not path.name.startswith(".DS_Store"):
            files.append(path)
    return files


def read_text_sample(path: Path, limit: int) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="ignore")[:limit]
    except OSError:
        return ""


def has_any(text: str, terms: list[str]) -> bool:
    lowered = text.lower()
    return any(term in lowered for term in terms)


def classify_file(path: Path, workspace: Path, client: str | None, policy: dict) -> IntakeItem:
    rel_path = path.relative_to(workspace).as_posix()
    size_bytes = path.stat().st_size
    intake_policy = policy.get("intake", {})
    text_exts = set(intake_policy.get("text_extensions", []))
    large_file_bytes = int(intake_policy.get("large_file_bytes", 60000))
    ext = path.suffix.lower()
    text = read_text_sample(path, large_file_bytes) if ext in text_exts else ""
    filename = path.name.lower()
    combined = f"{filename}\n{text}"

    scope_prefix = f"clients/{client}/context" if client else "context"
    dated_memory = f"{scope_prefix}/memory/{dt.date.today().isoformat()}.md"
    hot_memory = f"{scope_prefix}/MEMORY.md"
    reference = f"{scope_prefix}/reference/"

    if ext not in text_exts:
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "binary_or_unsupported",
            "excluded_or_parked",
            f"{scope_prefix}/intake/parked/",
            "Unsupported extension; keep as source material and create a text summary before indexing.",
        )

    if size_bytes > large_file_bytes or has_any(combined, ["transcript", "call recording", "meeting transcript", "raw notes"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "raw_source_material",
            "deep_search_only",
            dated_memory,
            "Large or transcript-like source; summarize decisions and keep the raw file out of hot memory.",
        )

    if has_any(combined, ["skill.md", "frontmatter", "slash command", "trigger phrases", "external skill", "npx skills"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "external_skill_candidate",
            "deep_search_only",
            "skills-library/backlog/",
            "Skill-like material should enter the inert skills-library path before any live adoption.",
        )

    if has_any(combined, ["pinecone", "langfuse", "langchain", "milvus", "zilliz", "qdrant", "infrastructure", "observability"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "infrastructure_or_tool_research",
            "deep_search_only",
            "projects/briefs/ or docs/ after tested decision",
            "Tooling research informs architecture only after a tested implementation decision.",
        )

    if has_any(combined, ["brand", "voice", "tone", "visual", "positioning", "icp", "ideal customer", "persona"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "brand_or_positioning_reference",
            "selective_semantic_candidate",
            f"{reference}brand/",
            "Durable brand context belongs in reference material or brand context, not raw hot memory.",
        )

    if has_any(combined, ["decision", "decided", "preference", "always", "never", "ongoing", "remember", "must", "pending"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "durable_memory_candidate",
            "review_before_routine",
            f"{dated_memory}; distill to {hot_memory} only if still active",
            "Potential durable fact; summarize in dated memory first and promote only the active stable piece.",
        )

    if has_any(combined, ["sop", "process", "workflow", "requirements", "api", "integration", "policy", "guide", "reference"]):
        return IntakeItem(
            path,
            rel_path,
            size_bytes,
            "reference_candidate",
            "selective_semantic_candidate",
            reference,
            "Reusable knowledge should become a curated reference with source provenance.",
        )

    return IntakeItem(
        path,
        rel_path,
        size_bytes,
        "review_needed",
        "deep_search_only",
        f"{scope_prefix}/intake/parked/ or {reference}",
        "No strong deterministic signal; keep staged until a human reviews its purpose.",
    )


def escape_cell(value: str) -> str:
    return value.replace("|", "\\|").replace("\n", " ")


def render_report(
    workspace: Path,
    client: str | None,
    dirs: dict[str, Path],
    items: list[IntakeItem],
    policy: dict,
    today: str,
) -> str:
    scope = f"Client: {client}" if client else "Root AI-OS"
    report_title = f"Context Intake Promotion Plan: {client or 'root'}"
    lines = [
        f"# {report_title}",
        "",
        f"Generated: {today}",
        f"Scope: {scope}",
        f"Workspace: {workspace}",
        f"Inbox: {dirs['inbox'].relative_to(workspace).as_posix()}/",
        f"Policy: {DEFAULT_POLICY.as_posix()}",
        "",
        "## Summary",
        "",
        f"- Inbox files reviewed: {len(items)}",
        "- Files moved: 0",
        "- Files promoted: 0",
        "- Approval required before any memory, reference, skill, or infrastructure adoption.",
        "",
        "## Promotion Plan",
        "",
    ]
    if items:
        lines.extend(
            [
                "| Source | Size | Classification | Index tier | Proposed destination | Reason |",
                "|---|---:|---|---|---|---|",
            ]
        )
        for item in items:
            lines.append(
                "| "
                + " | ".join(
                    [
                        f"`{escape_cell(item.rel_path)}`",
                        str(item.size_bytes),
                        escape_cell(item.classification),
                        escape_cell(item.index_tier),
                        f"`{escape_cell(item.proposed_destination)}`",
                        escape_cell(item.reason),
                    ]
                )
                + " |"
            )
    else:
        lines.append("No inbox files found. The folder scaffold is ready for future intake.")

    promotion_rules = policy.get("promotion_rules", {})
    lines.extend(
        [
            "",
            "## Promotion Rules",
            "",
        ]
    )
    for key, rule in promotion_rules.items():
        lines.append(f"- `{key}`: {rule}")

    lines.extend(
        [
            "",
            "## Approval Gate",
            "",
            "No source material was moved or promoted by this report. Approve specific rows before changing hot memory, reference files, skill libraries, docs, or infrastructure.",
            "",
            "## Next Actions",
            "",
            "1. Review each proposed destination.",
            "2. Approve, revise, or park specific rows.",
            "3. Apply approved promotions with source links back to the inbox file.",
            "4. Re-run `bash scripts/test-context-intake.sh` and `bash scripts/test-memory-index-policy.sh` after infrastructure changes.",
            "",
        ]
    )
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", default=".", help="AI-OS workspace root. Defaults to current directory.")
    scope = parser.add_mutually_exclusive_group(required=True)
    scope.add_argument("--client", help="Client slug to process, for example acme.")
    scope.add_argument("--root", action="store_true", help="Process the root context inbox.")
    parser.add_argument("--date", default=dt.date.today().isoformat(), help="Report date, YYYY-MM-DD.")
    parser.add_argument("--init-only", action="store_true", help="Only create the folder scaffold.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    workspace = Path(args.workspace).expanduser().resolve()
    if not workspace.is_dir():
        raise SystemExit(f"Workspace does not exist: {workspace}")

    client = slugify(args.client) if args.client else None
    policy = load_policy(workspace)
    dirs = ensure_scope_dirs(workspace, client)

    report_path = dirs["review"] / f"{args.date}_{client or 'root'}_promotion-plan.md"
    if args.init_only:
        items: list[IntakeItem] = []
    else:
        files = iter_inbox_files(dirs["inbox"])
        items = [classify_file(path, workspace, client, policy) for path in files]

    report = render_report(workspace, client, dirs, items, policy, args.date)
    report_path.write_text(report, encoding="utf-8")
    print(report_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
