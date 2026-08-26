import katex from 'katex';

export interface PreviewOptions {
  maxChars?: number;
  images?: Map<string, string>;
}

export interface PreviewResult {
  html: string;
  truncated: boolean;
}

const DEFAULT_MAX_CHARS = 300_000;
const TOKEN_RE = /\u0000(\d+)\u0000/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function katexInline(latex: string): string {
  try {
    return `<span class="math-inline">${katex.renderToString(latex, { displayMode: false, throwOnError: false, strict: false })}</span>`;
  } catch {
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

function katexBlock(latex: string): string {
  try {
    return `<div class="math-block">${katex.renderToString(latex, { displayMode: true, throwOnError: false, strict: false })}</div>`;
  } catch {
    return `<pre class="math-block">${escapeHtml(latex)}</pre>`;
  }
}

function inlineFormat(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
}

function renderTable(lines: string[]): string {
  const rows = lines
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''));
  const header = rows[0] ?? [];
  const body = rows.slice(1).filter((r) => !r.every((c) => /^:?-{1,}:?$/.test(c)));
  const cells = (r: string[]) => r.map((c) => `<td>${inlineFormat(c)}</td>`).join('');
  const headCells = header.map((c) => `<th>${inlineFormat(c)}</th>`).join('');
  return `<table class="md-table"><thead><tr>${headCells}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r)}</tr>`).join('')}</tbody></table>`;
}

export function renderMarkdownPreview(md: string, opts: PreviewOptions = {}): PreviewResult {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const truncated = md.length > maxChars;
  const src = truncated ? md.slice(0, maxChars) : md;
  const images = opts.images ?? new Map<string, string>();
  const tokens: string[] = [];
  const stash = (s: string): string => {
    tokens.push(s);
    return `\u0000${tokens.length - 1}\u0000`;
  };

  let html = src;

  html = html.replace(/<!--\s*Trang\s+(\d+)\s*-->/gi, (_, n: string) => stash(`<div class="page-mark">Trang ${n}</div>`));

  html = html.replace(/!\[([^\]]*)\]\((data:image\/[a-zA-Z0-9.+-]+;base64,[^)]+)\)/g, (_, alt: string, url: string) =>
    stash(`<figure class="md-figure"><img src="${url}" alt="${escapeHtml(alt)}"><figcaption>${escapeHtml(alt)}</figcaption></figure>`),
  );

  // Case-sensitive (uppercase IMAGE only) to stay consistent with parseImageMarkers in markers.ts.
  html = html.replace(/\[\[IMAGE\s*:\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:\|\s*([^\]]*?))?\]\]/g, (raw, page: string, x1: string, y1: string, x2: string, y2: string, caption: string) => {
    const key = `${page}:${x1},${y1},${x2},${y2}`;
    const url = images.get(key) ?? images.get(raw);
    if (url) return stash(`<figure class="md-figure"><img src="${url}" alt="${escapeHtml(caption || '')}"></figure>`);
    return stash(`<div class="img-marker">${escapeHtml(raw)}</div>`);
  });

  html = html.replace(/\$\$([\s\S]*?)\$\$/g, (_, latex: string) => stash(katexBlock(latex)));
  html = html.replace(/\$(?!\s)(?:\\.|[^$\n])+?\$/g, (m) => stash(katexInline(m.slice(1, -1))));

  html = escapeHtml(html);

  const lines = html.split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;
  const flush = () => {
    if (para.length > 0) {
      out.push(`<p>${inlineFormat(para.join(' '))}</p>`);
      para = [];
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      flush();
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      flush();
      const table: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        table.push(lines[i]);
        i++;
      }
      out.push(renderTable(table));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      i++;
      continue;
    }
    if (/^(\s*[-*+])\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^(\s*[-*+])\s+/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\s*[-*+]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flush();
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(`<li>${inlineFormat(lines[i].replace(/^\s*\d+[.)]\s+/, ''))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    if (/^\s*(\*\*\*|---)\s*$/.test(line)) {
      flush();
      out.push('<hr>');
      i++;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();

  const joined = out.join('\n');
  const restored = joined.replace(TOKEN_RE, (_, idx: string) => tokens[Number(idx)] ?? '');
  return { html: restored, truncated };
}
