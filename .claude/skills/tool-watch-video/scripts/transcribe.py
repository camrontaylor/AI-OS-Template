#!/usr/bin/env python3
"""Use an installed MLX-Whisper backend and serialize its actual return value."""
import argparse, json, sys
from datetime import date
from pathlib import Path

def serialize(value):
    if hasattr(value,'tolist'): return value.tolist()
    raise TypeError(f'Unsupported transcript value: {type(value).__name__}')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('media');parser.add_argument('output_dir')
    parser.add_argument('--model',default='mlx-community/whisper-large-v3-turbo')
    parser.add_argument('--date',default=date.today().isoformat());args=parser.parse_args()
    if not Path(args.media).is_file(): parser.error('Media file is missing')
    try: import mlx_whisper
    except ImportError:
        print('MLX-Whisper is unavailable. Use an installed supported backend or supply a transcript.',file=sys.stderr)
        return 2
    result=mlx_whisper.transcribe(args.media,path_or_hf_repo=args.model)
    folder=Path(args.output_dir);folder.mkdir(parents=True,exist_ok=True)
    (folder/f'{args.date}_transcript-raw.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=serialize)+'\n')
    (folder/f'{args.date}_transcript.txt').write_text(result.get('text','').strip()+'\n')
    print(f'Transcript saved in {folder.resolve()}');return 0

if __name__=='__main__': raise SystemExit(main())
