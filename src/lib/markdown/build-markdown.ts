import { parseImageMarkers, type ImageMarker } from './markers';

export function markerKey(m: ImageMarker): string {
  return `${m.page}:${m.x1},${m.y1},${m.x2},${m.y2}`;
}

export function buildExportMarkdown(md: string, images: Map<string, string>): string {
  let out = md;
  for (const m of parseImageMarkers(md)) {
    const url = images.get(markerKey(m)) ?? images.get(m.raw);
    if (!url) continue;
    const alt = m.caption || 'hình';
    out = out.split(m.raw).join(`![${alt}](${url})`);
  }
  return out;
}
