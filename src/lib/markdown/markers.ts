export interface ImageMarker {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  caption: string;
  raw: string;
}

const IMAGE_MARKER_RE =
  /\[\[IMAGE\s*:\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:\|\s*([^\]]*?))?\]\]/g;

export function parseImageMarkers(md: string): ImageMarker[] {
  const out: ImageMarker[] = [];
  for (const m of md.matchAll(IMAGE_MARKER_RE)) {
    out.push({
      page: Number(m[1]),
      x1: Number(m[2]),
      y1: Number(m[3]),
      x2: Number(m[4]),
      y2: Number(m[5]),
      caption: (m[6] ?? '').trim(),
      raw: m[0],
    });
  }
  return out;
}

export function countBlockFormulas(md: string): number {
  return md.match(/\$\$[\s\S]*?\$\$/g)?.length ?? 0;
}

export function countInlineFormulas(md: string): number {
  const rest = md.replace(/\$\$[\s\S]*?\$\$/g, '');
  return rest.match(/\$(?!\s)(?:\\.|[^$\n])+?\$/g)?.length ?? 0;
}

export function countFormulas(md: string): number {
  return countBlockFormulas(md) + countInlineFormulas(md);
}

export function countDataUriImages(md: string): number {
  return md.match(/!\[[^\]]*\]\(data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+\)/g)?.length ?? 0;
}

export function countCharacters(md: string): number {
  return md.length;
}

export function countPages(md: string): number {
  const nums = new Set<number>();
  for (const m of md.matchAll(/<!--\s*Trang\s+(\d+)\s*-->/gi)) nums.add(Number(m[1]));
  return nums.size;
}

export function sanitizeMarkdownForPandoc(md: string): string {
  // CRLF / lone \r collapse to a space (soft-wrap), \u00a0 → space, strip BOM.
  // Real \n line breaks are preserved so fence detection and standalone --- work.
  const src = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, ' ').replace(/\u00a0/g, ' ');
  let inFence = false;
  let fenceChar = '';
  return src
    .split('\n')
    .map((line) => {
      const fence = line.match(/^\s*(```+|~~~+)/);
      if (fence) {
        const ch = fence[1][0];
        if (inFence) {
          if (ch === fenceChar) { inFence = false; fenceChar = ''; }
        } else {
          inFence = true; fenceChar = ch;
        }
        return line;
      }
      return !inFence && /^\s*---\s*$/.test(line) ? '***' : line;
    })
    .join('\n');
}
