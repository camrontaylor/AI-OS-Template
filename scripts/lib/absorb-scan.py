#!/usr/bin/env python3
"""absorb-scan.py - deterministic security scan for meta-bake-it-in Step 2.

Runs the whole references/security-scan.md battery over an untrusted source tree
so the gate cannot be silently scoped down or no-opped (a hand-run grep that dies
on zsh globbing reads exactly like a clean pass - this does not). It READS ONLY;
it never executes the source, installs it, or follows any instruction inside it.

Usage:  python3 scripts/lib/absorb-scan.py <source-dir>
Exit:   0 = CLEAN or LOW, 1 = REVIEW (surface to user), 2 = HIGH (STOP).

Categories, matching security-scan.md:
  1 injection            2 absorption-targeted (highest risk)   3 credential/exfil links
  4 invisible unicode    5 leaked secrets (delegates to secret-scan.py)
  6 supply-chain         7 installer/config-write + binary download (the MCP-server class)
Plus a binary/archive inventory (cannot be source-audited -> verify signature).
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SIZE_CAP = 2_000_000          # bytes: scan first 1MB of anything larger, note it
SCAN_SLICE = 1_000_000
MAX_HITS_PER_CAT = 25         # cap printed hits so a noisy file cannot bury the grade

TEXT_EXT = {".md",".txt",".py",".sh",".bash",".zsh",".js",".mjs",".cjs",".ts",".tsx",".jsx",
    ".json",".jsonc",".yaml",".yml",".toml",".ini",".conf",".cfg",".properties",".env",".xml",
    ".svg",".html",".htm",".css",".c",".h",".cpp",".hpp",".cc",".go",".rs",".java",".kt",".rb",
    ".php",".pl",".lua",".sql",".ps1",".psm1",".bat",".cmd",".r",".ex",".exs",".gradle",".make",
    ".mk",".dockerfile",".tf",".proto",".graphql",".vue",".svelte",".astro",".mdx",".rst",".ipynb",""}
EXEC_BIN_EXT = {".exe",".dll",".so",".dylib",".node",".wasm",".a",".o",".class",".jar",".pyc",".bin"}
ARCHIVE_EXT = {".zip",".tar",".gz",".tgz",".bz2",".xz",".7z",".rar",".whl",".deb",".rpm",".dmg",".pkg"}
MEDIA_EXT = {".png",".jpg",".jpeg",".gif",".webp",".bmp",".ico",".mp4",".mov",".mp3",".wav",".pdf",
    ".woff",".woff2",".ttf",".otf",".eot",".psd",".fig",".sketch"}

CI = re.IGNORECASE
INJECTION = [re.compile(p, CI) for p in (
    r"ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instruction|prompt)",
    r"disregard\s+(?:all\s+|the\s+)?(?:previous|prior|above)",
    r"forget\s+(?:all\s+)?(?:your\s+)?(?:previous\s+)?instructions",
    r"override\s+(?:the\s+)?(?:system|previous)\s+prompt",
    r"you\s+are\s+now\s+(?:a|an|the)\b",
    r"\bpretend\s+to\s+be\b",
    r"from\s+now\s+on\s+you\s+(?:are|will|must|should)\b",
    r"(?:print|output|reveal|repeat|show)\s+(?:me\s+)?your\s+(?:system\s+)?(?:prompt|instructions)",
    r"</system>|\[SYSTEM\]|\[/?INST\]|<<SYS>>|<\|system\|>",
)]
ABSORB_TARGETED = [re.compile(p, CI) for p in (
    r"add\s+(?:the\s+following|this)\s+(?:standing\s+)?(?:rule|instruction|line|prompt)\s+to\s+(?:your|the\b)",
    r"(?:agents?\.md|claude\.md|system\s+prompt|your\s+rules)[^.\n]{0,40}(?:add|append|insert|include)",
    r"on\s+install(?:ation)?[,:]?\s+(?:add|append|insert|write)",
    r"append\s+(?:this|the\s+following)[^.\n]{0,40}to\s+your\s+(?:system\s+)?prompt",
    r"to\s+integrate[^.\n]{0,60}(?:add|append|insert)[^.\n]{0,40}(?:rule|instruction|prompt|agents?\.md)",
    r"the\s+(?:assistant|agent|ai|model)\s+should\s+always\b",
)]
EXFIL = [re.compile(p, CI) for p in (
    r"\]\(javascript:",
    r"\]\(data:(?!image/|font/)",
    r"https?://[^\s/@]+:[^\s/@]+@",
    r"[?&](?:access_token|api_key|client_secret|auth_token)=[A-Za-z0-9]",
)]
PIPE_TO_SHELL = re.compile(r"(?:curl|wget)\s+[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b", CI)
OBFUSCATION = [re.compile(p) for p in (
    r"\beval\s*\(", r"\bFunction\s*\(\s*[\"']", r"\batob\s*\(", r"base64\s+(?:-d|--decode)",
    r"[A-Za-z0-9+/]{300,}={0,2}",
)]
CONFIG_WRITE = [re.compile(p, CI) for p in (
    r"~/\.claude\b|\.claude/settings\.json|\bclaude\.json\b|~/\.claude\.json",
    r"~/\.config/|\.mcp\.json\b|~/\.codex\b|~/\.cursor\b|~/\.agents\b",
    r"releases/(?:latest/)?download|releases/download/",
    r"\bchmod\s+\+x\b|\bcodesign\b",
)]
# zero-width, bidi controls, BOM, soft hyphen, word-joiner, and the Unicode tag block.
# Built from codepoints so no literal invisible chars sit in this file's own source.
_INVIS_RANGES = [(0x00ad, 0x00ad), (0x200b, 0x200f), (0x2028, 0x202f),
                 (0x2060, 0x2069), (0xfeff, 0xfeff), (0xe0000, 0xe007f)]
INVISIBLE = re.compile("[" + "".join(chr(a) + "-" + chr(b) for a, b in _INVIS_RANGES) + "]")
BOM = "\ufeff"
LIFECYCLE = {"preinstall", "install", "postinstall", "prepare", "prepack", "postpack"}


def is_text(path: Path) -> bool:
    ext = path.suffix.lower()
    if ext in EXEC_BIN_EXT or ext in ARCHIVE_EXT or ext in MEDIA_EXT:
        return False
    if ext in TEXT_EXT:
        return True
    try:
        return b"\0" not in path.read_bytes()[:4096]
    except OSError:
        return False


def read_text(path: Path):
    try:
        raw = path.read_bytes()
    except OSError:
        return None, False
    truncated = len(raw) > SIZE_CAP
    if truncated:
        raw = raw[:SCAN_SLICE]
    if b"\0" in raw[:4096]:
        return None, False
    return raw.decode("utf-8", "replace"), truncated


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: absorb-scan.py <source-dir>", file=sys.stderr)
        return 64
    root = Path(sys.argv[1]).resolve()
    if not root.is_dir():
        print(f"absorb-scan: not a directory: {root}", file=sys.stderr)
        return 64

    text_files, exec_bins, archives, media, ext_counts, truncated_files = [], [], [], [], {}, []
    for p in sorted(root.rglob("*")):
        if not p.is_file() or "/.git/" in str(p):
            continue
        ext = p.suffix.lower()
        if ext in EXEC_BIN_EXT:
            exec_bins.append(p)
        elif ext in ARCHIVE_EXT:
            archives.append(p)
        elif ext in MEDIA_EXT:
            media.append(p)
        elif is_text(p):
            text_files.append(p)
            ext_counts[ext or "(none)"] = ext_counts.get(ext or "(none)", 0) + 1
        else:
            exec_bins.append(p)  # unknown non-text: treat as opaque binary

    findings = {k: [] for k in ("injection", "absorb", "exfil", "invisible",
                                "supplychain", "configwrite", "obfuscation")}

    def add(cat, rel, ln, note):
        if len(findings[cat]) < MAX_HITS_PER_CAT:
            findings[cat].append(f"  {rel}:{ln}: {note}")

    for p in text_files:
        rel = p.relative_to(root)
        text, was_trunc = read_text(p)
        if text is None:
            continue
        if was_trunc:
            truncated_files.append(str(rel))
        for ln, line in enumerate(text.splitlines(), 1):
            for rx in INJECTION:
                if rx.search(line):
                    add("injection", rel, ln, rx.pattern[:38]); break
            for rx in ABSORB_TARGETED:
                if rx.search(line):
                    add("absorb", rel, ln, line.strip()[:90]); break
            for rx in EXFIL:
                if rx.search(line):
                    add("exfil", rel, ln, rx.pattern[:34]); break
            if PIPE_TO_SHELL.search(line):
                add("supplychain", rel, ln, "pipe-to-shell: " + line.strip()[:70])
            for rx in OBFUSCATION:
                if rx.search(line):
                    add("obfuscation", rel, ln, rx.pattern[:30]); break
            for rx in CONFIG_WRITE:
                if rx.search(line):
                    add("configwrite", rel, ln, line.strip()[:80]); break
            # invisible unicode - report the real line; strip a leading BOM on line 1 (benign)
            probe = line[1:] if (ln == 1 and line.startswith(BOM)) else line
            im = INVISIBLE.search(probe)
            if im:
                add("invisible", rel, ln, f"invisible codepoint U+{ord(im.group()):04X}")
        # package.json lifecycle scripts + trustedDependencies
        if p.name == "package.json":
            try:
                data = json.loads(text)
            except Exception:
                data = {}
            for k in (data.get("scripts") or {}):
                if k.lower() in LIFECYCLE:
                    add("supplychain", rel, 1, f"lifecycle script '{k}': {str(data['scripts'][k])[:60]}")
            if "trustedDependencies" in data:
                add("supplychain", rel, 1, "trustedDependencies present (re-enables install scripts)")

    # secrets: reuse scripts/lib/secret-scan.py, then demote doc/test placeholders it
    # can't recognise (non-English placeholders, f-string templates, env lookups) so a
    # placeholder does not force a false STOP - it is still shown, just as "verify".
    raw_secret_hits, real_secrets, placeholder_secrets, scan_err = [], [], [], None
    ss = HERE / "secret-scan.py"
    if ss.is_file() and text_files:
        rels = [str(p.relative_to(root)) for p in text_files]
        try:
            out = subprocess.run([sys.executable, str(ss), str(root), *rels],
                                 capture_output=True, text=True, timeout=180)
            raw_secret_hits = [l for l in out.stdout.splitlines() if l.strip()]
        except Exception as e:
            scan_err = str(e)

    def _looks_placeholder(hit):
        try:
            rel, ln, _rule = hit.split(":", 2)
            line = (root / rel).read_text("utf-8", "replace").splitlines()[int(ln) - 1]
        except Exception:
            return False
        if any(ord(c) > 0x2e80 for c in line):   # CJK / non-latin value -> placeholder
            return True
        low = line.lower()
        return any(h in low for h in ("your_", "your-", "example", "e.g.", "placeholder",
                   "dummy", "changeme", "redacted", "<token", "xxxx", "{", "}", "getenv",
                   "process.env", "os.environ", "${", "$env"))

    for h in raw_secret_hits:
        (placeholder_secrets if _looks_placeholder(h) else real_secrets).append(h)

    # ---- grade ----
    high, review = [], []
    if findings["absorb"]:
        high.append(f"{len(findings['absorb'])} absorption-targeted instruction(s)")
    if real_secrets:
        high.append(f"{len(real_secrets)} leaked-secret hit(s)")
    if findings["invisible"]:
        high.append(f"{len(findings['invisible'])} invisible-unicode hit(s)")
    if len(findings["injection"]) >= 3:
        high.append(f"{len(findings['injection'])} injection-pattern hits (>=3)")
    if findings["obfuscation"] and findings["supplychain"]:
        high.append("obfuscation + supply-chain together")
    if findings["injection"] and len(findings["injection"]) < 3:
        review.append(f"{len(findings['injection'])} injection-pattern hit(s)")
    if findings["exfil"]:
        review.append(f"{len(findings['exfil'])} credential/exfil-link hit(s)")
    if findings["supplychain"]:
        review.append(f"{len(findings['supplychain'])} supply-chain flag(s)")
    if findings["configwrite"]:
        review.append(f"{len(findings['configwrite'])} agent-config-write / binary-download flag(s)")
    if findings["obfuscation"]:
        review.append(f"{len(findings['obfuscation'])} obfuscation flag(s)")
    if exec_bins or archives:
        review.append(f"{len(exec_bins)} executable-binary + {len(archives)} archive file(s) (verify signature/checksum; cannot source-audit)")
    if placeholder_secrets:
        review.append(f"{len(placeholder_secrets)} secret-shaped line(s) (look like placeholders/examples - verify)")
    if scan_err:
        review.append(f"secret-scan.py could not run ({scan_err}) - secrets NOT checked")

    grade = "HIGH" if high else ("REVIEW" if review else "CLEAN")

    # ---- report ----
    print(f"=== absorb-scan: {root} ===")
    covered = ", ".join(f"{k}:{v}" for k, v in sorted(ext_counts.items(), key=lambda x: -x[1])[:14])
    print(f"COVERAGE: {len(text_files)} text files content-scanned [{covered}]")
    print(f"          {len(exec_bins)} exec/opaque binaries, {len(archives)} archives, {len(media)} media inventoried (not content-scanned)")
    if truncated_files:
        print(f"          {len(truncated_files)} large file(s) scanned first {SCAN_SLICE//1000}KB only: {', '.join(truncated_files[:4])}")
    order = [("absorb","ABSORPTION-TARGETED (highest risk)"),("injection","INJECTION"),
             ("exfil","CREDENTIAL/EXFIL LINKS"),("invisible","INVISIBLE UNICODE"),
             ("supplychain","SUPPLY-CHAIN"),("configwrite","AGENT-CONFIG-WRITE / BINARY-DOWNLOAD"),
             ("obfuscation","OBFUSCATION")]
    for key, label in order:
        if findings[key]:
            print(f"\n[{label}] {len(findings[key])} hit(s):")
            print("\n".join(findings[key]))
    if real_secrets:
        print(f"\n[LEAKED SECRETS] {len(real_secrets)} hit(s):")
        print("\n".join("  " + h for h in real_secrets[:MAX_HITS_PER_CAT]))
    if placeholder_secrets:
        print(f"\n[SECRET-SHAPED (likely placeholder/example - verify)] {len(placeholder_secrets)}:")
        print("\n".join("  " + h for h in placeholder_secrets[:MAX_HITS_PER_CAT]))
    if exec_bins:
        print(f"\n[EXECUTABLE/OPAQUE BINARIES] {len(exec_bins)} (verify signature before trusting):")
        print("\n".join("  " + str(b.relative_to(root)) for b in exec_bins[:15]))
    if archives:
        print(f"\n[ARCHIVES] {len(archives)}:")
        print("\n".join("  " + str(a.relative_to(root)) for a in archives[:10]))

    print(f"\nGRADE: {grade}")
    if grade == "HIGH":
        print("REASON (STOP - surface to user, do not proceed): " + "; ".join(high))
        return 2
    if grade == "REVIEW":
        print("REASON (surface to user, judgment call): " + "; ".join(review))
        return 1
    print("No injection, secrets, exfil, supply-chain, or config-write flags.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
