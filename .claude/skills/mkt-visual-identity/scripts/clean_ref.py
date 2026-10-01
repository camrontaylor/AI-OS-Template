#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "openai>=1.40.0",
#     "pillow>=10.0.0",
# ]
# ///
"""Thin wrapper around gpt-image-2 edit. No internal logic.

Claude writes the cleaning prompt (see references/clean-prompt-patterns.md);
this script just calls the API and saves the result. The whole point of being
thin is that decisions live in the orchestrator (Claude in chat), not in code.

Usage:

    uv run clean_ref.py \\
        --ref brand_context/visual_refs/<ref-name>.png \\
        --prompt-file /tmp/clean-prompt.txt \\
        --output brand_context/templates/<pool>/<slug>/bg.png

Or pass the prompt inline (small enough):

    uv run clean_ref.py \\
        --ref ref.png \\
        --prompt "Edit this photograph surgically..." \\
        --output bg.png

Outputs:
  {output}            — cleaned PNG
  {output}.log.md     — sidecar log: prompt used, model, timestamp, cost estimate
"""
import argparse
import base64
import os
import sys
from datetime import datetime
from pathlib import Path

# ── Env loading (so OPENAI_API_KEY in .env works) ─────────────────────────

def load_env_file() -> None:
    here = Path.cwd()
    for candidate in [here, *here.parents]:
        env = candidate / ".env"
        if env.is_file():
            for raw in env.read_text(encoding="utf-8").splitlines():
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
            return


# ── Main ──────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="Clean a ref image via gpt-image-2 edit. Thin wrapper — Claude writes the prompt.")
    ap.add_argument("--ref", required=True, help="Path to the PRIMARY ref image to edit.")
    ap.add_argument("--ref-aux", action="append", default=[], help="Path to auxiliary input image (e.g., brand headshot to swap into the scene). Repeatable. gpt-image edit accepts multiple inputs.")
    ap.add_argument("--output", required=True, help="Where to write the cleaned bg.png.")
    prompt_src = ap.add_mutually_exclusive_group(required=True)
    prompt_src.add_argument("--prompt", help="Inline prompt string.")
    prompt_src.add_argument("--prompt-file", help="Path to a file containing the prompt.")
    ap.add_argument("--size", default="1024x1536", help="Output size for gpt-image-2 edit (closest to 1080x1350 4:5). Default 1024x1536.")
    ap.add_argument("--model", default="gpt-image-1", help="Model name. (gpt-image-2 alias is also accepted; OpenAI may route either.)")
    args = ap.parse_args()

    load_env_file()

    ref_path = Path(args.ref).resolve()
    if not ref_path.exists():
        print(f"Error: ref not found: {ref_path}", file=sys.stderr)
        return 1

    if args.prompt:
        prompt_text = args.prompt
    else:
        prompt_path = Path(args.prompt_file).resolve()
        if not prompt_path.exists():
            print(f"Error: prompt-file not found: {prompt_path}", file=sys.stderr)
            return 1
        prompt_text = prompt_path.read_text(encoding="utf-8")

    out_path = Path(args.output).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        print("Error: OPENAI_API_KEY not set (check .env).", file=sys.stderr)
        return 1

    # Call gpt-image edit
    try:
        from openai import OpenAI
    except ImportError:
        print("Error: openai package not installed. Install via `uv pip install openai`.", file=sys.stderr)
        return 1

    client = OpenAI(api_key=api_key)

    # Multi-image input: primary + aux images
    aux_paths = []
    for p in (args.ref_aux or []):
        ap_resolved = Path(p).resolve()
        if not ap_resolved.exists():
            print(f"Error: --ref-aux not found: {ap_resolved}", file=sys.stderr)
            return 1
        aux_paths.append(ap_resolved)

    inputs_desc = ref_path.name + ("" if not aux_paths else " + " + ", ".join(a.name for a in aux_paths))
    print(f"  Calling {args.model} with image=[{inputs_desc}] (size={args.size})...", file=sys.stderr)
    started = datetime.utcnow().isoformat() + "Z"

    # OpenAI Python SDK accepts image as a single file OR a list of files.
    # Open all handles, pass the list, then close after the call returns.
    handles = []
    try:
        primary_handle = open(ref_path, "rb")
        handles.append(primary_handle)
        aux_handles = []
        for a in aux_paths:
            h = open(a, "rb")
            handles.append(h)
            aux_handles.append(h)

        if aux_handles:
            image_arg = [primary_handle] + aux_handles
        else:
            image_arg = primary_handle

        result = client.images.edit(
            model=args.model,
            image=image_arg,
            prompt=prompt_text,
            size=args.size,
        )
    finally:
        for h in handles:
            try: h.close()
            except Exception: pass

    finished = datetime.utcnow().isoformat() + "Z"

    if not result.data or not result.data[0].b64_json:
        print("Error: API returned no image data.", file=sys.stderr)
        return 2

    image_bytes = base64.b64decode(result.data[0].b64_json)
    out_path.write_bytes(image_bytes)

    # Sidecar log
    log_path = out_path.with_suffix(out_path.suffix + ".log.md")
    aux_lines = "\n".join(f"- ref_aux: {a}" for a in aux_paths) if aux_paths else "- ref_aux: (none)"
    log = (
        f"# clean_ref log — {out_path.name}\n\n"
        f"{aux_lines}\n"
        f"- timestamp_start: {started}\n"
        f"- timestamp_end: {finished}\n"
        f"- model: {args.model}\n"
        f"- size: {args.size}\n"
        f"- ref: {ref_path}\n"
        f"- output: {out_path}\n\n"
        f"## Prompt used\n\n"
        f"```\n{prompt_text}\n```\n"
    )
    log_path.write_text(log, encoding="utf-8")

    print(f"Wrote: {out_path}")
    print(f"Log:   {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
