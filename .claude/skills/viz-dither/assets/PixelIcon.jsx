// viz-dither — PixelIcon (React). Renders a hard-edged 1-bit pixel icon from
// the generated grid data (pixel_icons.py -> pixel-icons.js). currentColor
// tints it; shapeRendering=crispEdges keeps cells square. Size in multiples
// of 12 (24, 36) so every cell is an integer px and edges stay crisp.
import { PIXEL_ICONS, PIXEL_GRID } from './pixel-icons.js';

export function PixelIcon({ name, size = 24, className = '', title }) {
  const cells = PIXEL_ICONS[name];
  if (!cells) return null;
  return (
    <svg
      className={`pixel-icon ${className}`}
      width={size}
      height={size}
      viewBox={`0 0 ${PIXEL_GRID} ${PIXEL_GRID}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
    >
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" />
      ))}
    </svg>
  );
}
