import { parseImageMarkers, type ImageMarker } from './markers';

export function markerKey(m: ImageMarker): string {
  return `${m.page}:${m.x1},${m.y1},${m.x2},${m.y2}`;
}

// Brackets/newlines in alt text would break Markdown image syntax — flatten them.
function sanitizeAlt(caption: string): string {
  const cleaned = (caption || '').replace(/[\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || 'hình';
}

export function buildExportMarkdown(md: string, images: Map<string, string>): string {
  let out = md;
  for (const m of parseImageMarkers(md)) {
    const url = images.get(markerKey(m)) ?? images.get(m.raw);
    if (!url) continue;
    out = out.split(m.raw).join(`![${sanitizeAlt(m.caption)}](${url})`);
  }
  return out;
}
