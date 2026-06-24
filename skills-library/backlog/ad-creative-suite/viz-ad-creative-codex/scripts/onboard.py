#!/usr/bin/env python3
"""First-run onboarding wizard for the ad creative factory skills."""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_RATIOS = ["4:5", "1:1", "9:16"]
DEFAULT_PLATFORMS = ["Meta", "TikTok", "Google"]


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "client"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def skill_dir() -> Path:
    return Path(__file__).resolve().parents[1]


def workspace_root(skill_path: Path) -> Path:
    parts = skill_path.parts
    if ".claude" in parts:
        idx = parts.index(".claude")
        return Path(*parts[:idx])
    if skill_path.parent.name == "ad-creative-suite":
        return skill_path.parent.parent.parent.parent
    return Path.cwd()


def load_template(skill_path: Path) -> Dict[str, Any]:
    template_path = skill_path / "assets" / "onboarding-profile.template.json"
    with template_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ask(prompt: str, default: str = "", quick: bool = False) -> str:
    if quick:
        return default
    suffix = f" [{default}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    return answer or default


def ask_list(prompt: str, default: Optional[List[str]] = None, quick: bool = False) -> List[str]:
    default = default or []
    if quick:
        return default
    suffix = f" [{', '.join(default)}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    if not answer:
        return default
    return [item.strip() for item in answer.split(",") if item.strip()]


def command_status(command: str) -> str:
    return "set" if shutil.which(command) else "missing"


def connection_status(skill_name: str) -> Dict[str, str]:
    package_json = skill_dir() / "package.json"
    node_modules = skill_dir() / "node_modules"
    status = {
        "codex_native_imagegen": "runtime_tool_required" if skill_name.endswith("-codex") else "not_applicable",
        "FAL_KEY": "set" if os.environ.get("FAL_KEY") else "missing",
        "FIGMA_TOKEN": "set" if os.environ.get("FIGMA_TOKEN") else "missing",
        "FIGMA_FILE_KEY": "set" if os.environ.get("FIGMA_FILE_KEY") else "missing",
        "node": command_status("node"),
        "local_html_render": "unknown",
    }
    if skill_name.endswith("-figma"):
        status["local_html_render"] = "ready" if package_json.exists() and node_modules.exists() else "needs_npm_install"
    return status


def recommended_connections(skill_name: str, status: Dict[str, str]) -> List[str]:
    recommendations: List[str] = []
    if skill_name.endswith("-fal"):
        if status["FAL_KEY"] != "set":
            recommendations.append("Add FAL_KEY to .env for fal.ai generation.")
        if status["node"] != "set":
            recommendations.append("Install Node 18+ for the bundled fal REST runner.")
    if skill_name.endswith("-figma"):
        if status["FIGMA_TOKEN"] != "set" and status["local_html_render"] != "ready":
            recommendations.append("Set FIGMA_TOKEN or run npm install in this skill folder for the local HTML fallback.")
        if status["node"] != "set":
            recommendations.append("Install Node 18+ for the deterministic local HTML renderer.")
    return recommendations


def next_setup_action(skill_name: str, status: Dict[str, str]) -> str:
    if skill_name.endswith("-codex"):
        return "Run bash scripts/setup.sh, then use Codex native image generation in Step 7 or save the prompt pack for a subscription UI."
    if skill_name.endswith("-fal"):
        if status["FAL_KEY"] != "set":
            return "Add FAL_KEY to .env, then rerun bash scripts/setup.sh."
        if status["node"] != "set":
            return "Install Node 18+, then rerun bash scripts/setup.sh."
    if skill_name.endswith("-figma"):
        if status["FIGMA_TOKEN"] != "set" and status["local_html_render"] != "ready":
            return "Set FIGMA_TOKEN or run npm install in this skill folder for the local HTML fallback."
    return "Run bash scripts/setup.sh, then create the first campaign brief."


def collect_examples(quick: bool = False) -> List[Dict[str, str]]:
    if quick:
        return []
    print("\nExamples help the skill improve immediately. Add URLs, file paths, or short notes.")
    examples: List[Dict[str, str]] = []
    for label in ["imitate", "avoid", "winning", "losing", "compliance"]:
        value = ask(f"Example to {label} (optional)", "", quick)
        if value:
            examples.append({"label": label, "value": value})
    return examples


def build_profile(client: str, quick: bool = False) -> Dict[str, Any]:
    skill_path = skill_dir()
    skill_name = skill_path.name
    client_slug = slugify(client)
    profile = load_template(skill_path)
    timestamp = now_iso()

    profile["skill_name"] = skill_name
    profile["client_name"] = client
    profile["client_slug"] = client_slug
    profile["created_at"] = timestamp
    profile["updated_at"] = timestamp

    print(f"\nAd Creative Onboarding: {client} ({skill_name})")
    print("Press Enter to accept defaults. Store notes, paths, or URLs; do not paste secrets.\n")

    profile["first_success"]["activation_goal"] = ask(
        "First successful use",
        profile["first_success"]["activation_goal"],
        quick,
    )
    profile["first_success"]["time_to_value_target_minutes"] = int(
        ask("Target minutes to first useful batch", "30", quick) or "30"
    )
    profile["first_success"]["first_batch_shape"]["concepts"] = int(
        ask("Default number of concepts", "3", quick) or "3"
    )
    profile["first_success"]["first_batch_shape"]["variants_per_concept"] = int(
        ask("Default variants per concept", "2", quick) or "2"
    )
    profile["first_success"]["first_batch_shape"]["aspect_ratios"] = ask_list(
        "Default aspect ratios",
        DEFAULT_RATIOS,
        quick,
    )

    profile["business"]["offer"] = ask("Offer/product", "", quick)
    profile["business"]["website_url"] = ask("Website URL", "", quick)
    profile["business"]["landing_pages"] = ask_list("Landing page URLs", [], quick)
    profile["business"]["primary_goal"] = ask("Primary goal", "lead form submissions", quick)
    profile["business"]["primary_metric"] = ask("Primary metric", "CPA", quick)
    profile["business"]["target_cpa_or_roas"] = ask("Target CPA/ROAS if known", "", quick)
    profile["business"]["funnel_stage"] = ask("Funnel stage", "cold acquisition", quick)

    profile["audience"]["icp"] = ask("ICP / buyer", "", quick)
    profile["audience"]["awareness_stage"] = ask("Awareness stage", "problem-aware", quick)
    profile["audience"]["markets"] = ask_list("Target markets", ["United States"], quick)
    profile["audience"]["languages"] = ask_list("Target languages", ["English"], quick)
    profile["audience"]["exclusions"] = ask_list("Audience exclusions", [], quick)

    profile["platforms"]["default_platforms"] = ask_list("Default platforms", DEFAULT_PLATFORMS, quick)
    profile["platforms"]["formats"] = ask_list("Default formats", ["feed", "stories", "reels"], quick)
    profile["platforms"]["aspect_ratios"] = ask_list("Default export ratios", DEFAULT_RATIOS, quick)
    profile["platforms"]["launch_status_default"] = ask("Default launch status", "paused_for_review", quick)
    profile["platforms"]["budget_sensitivity"] = ask("Budget safeguard notes", "", quick)

    profile["creative_preferences"]["tone"] = ask("Copy tone", "direct, specific, non-hype", quick)
    profile["creative_preferences"]["visual_style"] = ask("Visual style", "", quick)
    profile["creative_preferences"]["photo_style"] = ask("Photo style", "", quick)
    profile["creative_preferences"]["typography_notes"] = ask("Typography notes", "", quick)
    profile["creative_preferences"]["color_notes"] = ask("Color notes", "", quick)
    profile["creative_preferences"]["layout_preferences"] = ask("Layout preferences", "", quick)
    profile["creative_preferences"]["do_not_use"] = ask_list("Do-not-use words, claims, or styles", [], quick)

    profile["brand_assets"]["logo_path"] = ask("Logo path", "", quick)
    profile["brand_assets"]["product_photos_path"] = ask("Product photo folder", "", quick)
    profile["brand_assets"]["style_anchors"] = ask_list("Style anchor paths or URLs", [], quick)
    profile["brand_assets"]["figma_file_key"] = ask("Figma file key if any", os.environ.get("FIGMA_FILE_KEY", ""), quick)
    profile["brand_assets"]["brand_extraction_url"] = profile["business"]["website_url"]

    profile["compliance"]["regulated_category"] = ask("Regulated category or special ad category", "", quick)
    profile["compliance"]["mandatory_disclaimers"] = ask_list("Mandatory disclaimers", [], quick)
    profile["compliance"]["banned_claims"] = ask_list("Banned claims", [], quick)
    profile["compliance"]["approval_notes"] = ask("Approval workflow notes", "operator approves before generation; client approves before launch", quick)

    profile["measurement"]["conversion_event"] = ask("Conversion event", "", quick)
    profile["measurement"]["tracking_status"] = ask("Pixel/conversion tracking status", "unknown", quick)
    profile["measurement"]["campaign_naming_convention"] = ask(
        "Campaign naming convention",
        "{client}_{platform}_{offer}_{funnel}_{date}",
        quick,
    )
    profile["measurement"]["utm_convention"] = ask(
        "UTM convention",
        "utm_source={platform}&utm_medium=paid_social&utm_campaign={campaign}&utm_content={creative_id}",
        quick,
    )
    profile["measurement"]["reporting_cadence"] = ask("Reporting cadence", "24h, 48h, 7d", quick)
    profile["measurement"]["minimum_impressions_before_decision"] = int(
        ask("Minimum impressions before judging creative", "1000", quick) or "1000"
    )

    profile["media_buying"]["ad_accounts"] = ask_list("Ad accounts or platform workspaces", [], quick)
    profile["media_buying"]["connected_platforms"] = ask_list("Connected ad/reporting platforms", [], quick)
    profile["media_buying"]["monthly_budget"] = ask("Typical monthly budget", "", quick)
    profile["media_buying"]["test_budget"] = ask("Default creative test budget", "", quick)
    profile["media_buying"]["daily_spend_cap"] = ask("Daily spend cap or approval threshold", "", quick)
    profile["media_buying"]["audience_sources"] = ask_list(
        "Audience sources (customer lists, pixels, lookalikes, keywords)",
        [],
        quick,
    )
    profile["media_buying"]["retargeting_windows"] = ask_list("Retargeting windows", ["7d", "30d", "90d"], quick)
    profile["media_buying"]["exclusions"] = ask_list("Default paid media exclusions", ["existing customers", "recent converters"], quick)
    profile["media_buying"]["frequency_cap_notes"] = ask("Frequency/fatigue notes", "", quick)
    profile["media_buying"]["pause_thresholds"] = ask_list("Pause thresholds", [], quick)
    profile["media_buying"]["launch_permissions"] = ask(
        "Launch permissions",
        "operator can prepare, client approves launch",
        quick,
    )

    profile["performance_history"]["recent_results_source"] = ask("Recent results source (CSV/report/link)", "", quick)
    profile["performance_history"]["winning_patterns"] = ask_list("Winning creative patterns", [], quick)
    profile["performance_history"]["losing_patterns"] = ask_list("Losing creative patterns", [], quick)
    profile["performance_history"]["angles_to_extend"] = ask_list("Angles to extend", [], quick)
    profile["performance_history"]["angles_to_avoid"] = ask_list("Angles to avoid", [], quick)

    profile["operator_preferences"]["approval_workflow"] = ask(
        "Approval workflow",
        "approve brief before generation, approve exports before upload",
        quick,
    )
    profile["operator_preferences"]["testing_style"] = ask("Testing style", "one variable per test", quick)
    profile["operator_preferences"]["default_batch_size"] = ask("Default batch size", "6 creatives", quick)
    profile["operator_preferences"]["output_format"] = ask("Preferred handoff format", "folder + slate.csv + qa-report.md", quick)
    profile["operator_preferences"]["handoff_destination"] = ask("Handoff destination", "", quick)

    profile["examples"] = collect_examples(quick)

    status = connection_status(skill_name)
    profile["tool_connections"] = status
    profile["recommended_connections"] = recommended_connections(skill_name, status)
    profile["next_setup_action"] = next_setup_action(skill_name, status)

    open_gaps: List[str] = []
    if not profile["business"]["offer"]:
        open_gaps.append("Offer/product missing")
    if not profile["business"]["website_url"] and not profile["brand_assets"]["logo_path"]:
        open_gaps.append("No website URL or logo path for brand lock")
    if profile["measurement"]["tracking_status"] in ("", "unknown"):
        open_gaps.append("Conversion tracking status unknown")
    open_gaps.extend(profile["recommended_connections"])
    profile["open_gaps"] = open_gaps
    profile["status"] = "ready" if not open_gaps else "partial"

    return profile


def save_profile(profile: Dict[str, Any]) -> Path:
    root = workspace_root(skill_dir())
    out_dir = root / "projects" / profile["skill_name"] / "onboarding" / profile["client_slug"]
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "onboarding-profile.json"
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(profile, handle, indent=2)
        handle.write("\n")
    return out_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run first-use onboarding for an ad creative skill.")
    parser.add_argument("--client", required=True, help="Client name.")
    parser.add_argument("--quick", action="store_true", help="Write a default profile without prompts.")
    args = parser.parse_args()

    profile = build_profile(args.client, args.quick)
    path = save_profile(profile)

    print("\nSaved onboarding profile:")
    print(path)
    print(f"\nStatus: {profile['status']}")
    if profile["open_gaps"]:
        print("\nOpen gaps:")
        for gap in profile["open_gaps"]:
            print(f"- {gap}")
    print("\nNext setup action:")
    print(profile["next_setup_action"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
