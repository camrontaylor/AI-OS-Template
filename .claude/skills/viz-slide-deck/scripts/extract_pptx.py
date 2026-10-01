#!/usr/bin/env python3
"""Read a PPTX without modifying it, extracting text, notes, and image assets."""
import argparse, json, sys
from datetime import date
from pathlib import Path

def iter_shapes(shapes, prefix=()):
    """Walk grouped shapes recursively while keeping stable extraction paths."""
    for index, shape in enumerate(shapes, 1):
        shape_path = prefix + (index,)
        yield shape_path, shape
        children = getattr(shape, 'shapes', None)
        if children is not None:
            yield from iter_shapes(children, shape_path)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('source');parser.add_argument('output_dir')
    parser.add_argument('--date',default=date.today().isoformat());args=parser.parse_args()
    if not Path(args.source).is_file(): parser.error('PPTX source is missing')
    try: from pptx import Presentation
    except ImportError:
        print('python-pptx is unavailable in this Python runtime. Use a supported document runtime or supply slide text.',file=sys.stderr)
        return 2
    deck=Presentation(args.source);folder=Path(args.output_dir);folder.mkdir(parents=True,exist_ok=True)
    images=folder/'assets';images.mkdir(exist_ok=True);slides=[]
    for i,slide in enumerate(deck.slides):
        texts=[];assets=[];tables=[]
        for shape_path,shape in iter_shapes(slide.shapes):
            if shape.has_text_frame: texts.append(shape.text)
            if shape.has_table:
                rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
                tables.append({'shape_path':list(shape_path),'rows':rows})
                texts.append('\n'.join('\t'.join(row) for row in rows))
            if hasattr(shape,'image'):
                image=shape.image;image_id='-'.join(f'{n:03d}' for n in shape_path)
                name=f'{args.date}_slide-{i+1:03d}-image-{image_id}.{image.ext}'
                (images/name).write_bytes(image.blob);assets.append('assets/'+name)
        title=slide.shapes.title.text if slide.shapes.title is not None else (texts[0] if texts else '')
        notes=slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ''
        slides.append({'i':i,'title':title,'texts':texts,'notes':notes,'images':assets,'tables':tables})
    result={'source':str(Path(args.source).resolve()),'slide_count':len(slides),
            'width_emu':deck.slide_width,'height_emu':deck.slide_height,'slides':slides}
    output=folder/f'{args.date}_extracted-slides.json';output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f'Extracted {len(slides)} slides to {output.resolve()}');return 0

if __name__=='__main__': raise SystemExit(main())
