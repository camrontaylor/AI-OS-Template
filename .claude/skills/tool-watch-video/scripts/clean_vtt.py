#!/usr/bin/env python3
"""Clean VTT rolling captions while preserving intentional repeated speech."""
import argparse, html, re
from pathlib import Path

def seconds(value):
    parts=[float(p) for p in value.split(':')]
    return sum(v*(60**i) for i,v in enumerate(reversed(parts)))

def clean(content):
    output=[]; prior_words=[]; prior_end=-1
    for block in re.split(r'\n\s*\n',content.replace('\r','')):
        lines=block.splitlines()
        timing=next((i for i,l in enumerate(lines) if '-->' in l),None)
        if timing is None: continue
        match=re.search(r'([\d:.]+)\s+-->\s+([\d:.]+)',lines[timing])
        if not match: continue
        start,end=map(seconds,match.groups())
        text=html.unescape(re.sub(r'<[^>]*>','', ' '.join(lines[timing+1:]))).strip()
        words=text.split(); overlap=0
        if start < prior_end:
            for count in range(min(len(prior_words),len(words)),0,-1):
                if prior_words[-count:]==words[:count]: overlap=count;break
        new_words=words[overlap:]
        if new_words: output.append(' '.join(new_words))
        prior_words=words; prior_end=end
    return '\n'.join(output)+('\n' if output else '')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output')
    args=parser.parse_args(); target=Path(args.output);target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(clean(Path(args.source).read_text()))
