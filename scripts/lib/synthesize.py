#!/usr/bin/env python3
"""
Synthesize a SKILL.local.md or CLAUDE.local.md migration artifact.
Strips content identical to the base file, keeps only the user's delta.

Usage: synthesize.py <local_file> <base_file>
Rewrites local_file in-place.
Exit 0 = ok, 1 = error.
"""
import re, sys


def strip_frontmatter(lines):
    if not lines or lines[0].rstrip() != "---":
        return lines
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            return lines[i + 1:]
    return lines


def split_sections(lines):
    """Split by ## headings. Returns list of (heading, [lines])."""
    sections = []
    heading = ""
    body = []
    for line in lines:
        if line.startswith("## "):
            sections.append((heading, body))
            heading = line.rstrip()
            body = []
        else:
            body.append(line)
    sections.append((heading, body))
    return sections


def is_dated_rule(line):
    return bool(re.match(r"^- \d{4}-\d{2}-\d{2}:", line))


def content_equal(a_lines, b_lines):
    norm = lambda ls: "\n".join(l.rstrip() for l in ls).strip()
    return norm(a_lines) == norm(b_lines)


try:
    local_file, base_file = sys.argv[1], sys.argv[2]
    with open(local_file, encoding="utf-8", errors="replace") as f:
        local_lines = f.read().splitlines()
    with open(base_file, encoding="utf-8", errors="replace") as f:
        base_lines = f.read().splitlines()
except Exception as e:
    print("read error: " + str(e), file=sys.stderr)
    sys.exit(1)

local_lines = strip_frontmatter(local_lines)
while local_lines and not local_lines[0].strip():
    local_lines.pop(0)

local_sections = split_sections(local_lines)
base_sections = split_sections(base_lines)
base_map = {h: c for h, c in base_sections}

out = []

for heading, content in local_sections:
    if not heading:
        continue  # pre-heading content (title, separators) — skip

    base_content = base_map.get(heading)

    if heading == "## Rules":
        base_rules_text = "\n".join(base_map.get("## Rules", []))
        new_entries = [l for l in content if is_dated_rule(l) and l not in base_rules_text]
        out.append((heading, new_entries))
    elif base_content is None:
        out.append((heading, content))  # section not in base — user-added
    elif not content_equal(content, base_content):
        out.append((heading, content))  # user modified this section
    # else: identical to base — drop

# Always include ## Rules (even if empty)
if not any(h == "## Rules" for h, _ in out):
    out.insert(0, ("## Rules", []))

lines_out = []
for heading, content in out:
    lines_out.append(heading)
    lines_out.extend(content)
    lines_out.append("")

while lines_out and not lines_out[-1].strip():
    lines_out.pop()

try:
    with open(local_file, "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out) + "\n")
except Exception as e:
    print("write error: " + str(e), file=sys.stderr)
    sys.exit(1)

sys.exit(0)
