# OCR PDF/Image → Word (Gemini + OpenAI, Vercel + Supabase) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the AIOMT OCR PDF/Image app as a Next.js + Vercel + Supabase app: OCR PDF/images → Markdown (LaTeX + tables + figure cut markers) via **Gemini (Google direct)** or **OpenAI-compatible (custom base URL)** with client-side **key rotation on rate-limit**, then export **>1M-char Markdown** → Word `.docx` (OMML via Pandoc server / MathType OLE via MathType server), stage cut figures temporarily on Supabase, store the `.docx` on Supabase for 3 days, delete temp figures, daily cleanup cron.

**Architecture:** Heavy work stays **client-side** (proven from the original app): pdf.js renders pages, the browser calls the OCR provider directly, figures cut from rendered pages, `.docx` produced by the external Pandoc/MathType servers. Vercel serverless functions do only small JSON (issue Supabase signed URLs, finalize jobs, cleanup cron) — all heavy bytes bypass Vercel (its ~4.5 MB body limit). Supabase holds two **private** buckets: `temp-images` (per-job, deleted at finalize) and `word-exports` (3-day retention, daily cron).

**Tech Stack:** Next.js 15 (App Router) + TypeScript + React 19; pdfjs-dist; jszip; katex; @supabase/supabase-js (server only); Vitest; plain CSS dark theme. External services (verified live on 2026-08-26):
- Pandoc: `POST https://pandoc-server.onrender.com/convert` JSON `{"markdown": "..."}` → docx blob (OMML math, pipe tables, data-URI images embedded).
- MathType: `POST https://latex2mathtypeweb.onrender.com/api/convert-markdown` JSON `{"markdown": "...", "formula_mode": "mathtype"}` → docx blob with MathType OLE + header `X-Stats: "converted,failed"`.

## Global Constraints

- Node ≥ 20; every file TypeScript strict mode.
- All heavy bytes (PDF→Gemini, page images→OpenAI, figures→Supabase, `.docx`→Supabase) flow directly from the browser; never through a Vercel function body.
- Keys live in `localStorage` (user-entered), sent only to the chosen OCR provider; never to our server.
- Figure cut markers: `[[IMAGE:page,x1,y1,x2,y2|caption]]` with coordinates in **permille** (0–1000 of page width/height).
- Output markdown format (per sample `trích mẫu.txt`): `<!-- Trang N -->` page markers, `$...$` inline / `$$...$$` block LaTeX, Markdown headings/bold/italic, pipe tables.
- Word export must handle Markdown > 1,000,000 characters.
- Word files retained 3 days (signed URL expiry + daily cron both enforce it); temp figures deleted at finalize (cron as safety net).
- UI copy in Vietnamese; dark theme similar to the original.
- Every task ends with a green `npm test` (or documented manual verification for UI) and a commit.

---

### Task 1: Scaffold Next.js project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.mjs`, `vitest.config.ts`, `.gitignore`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`

**Interfaces:**
- Produces: project layout; `@/*` path alias → `./src/*`; scripts `dev`, `build`, `start`, `test`, `test:watch`.

- [ ] **Step 1: Create package.json and config files**

`package.json`:

```json
{
  "name": "gemini-ocr-mathtype",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.49.0",
    "jszip": "^3.10.1",
    "katex": "^0.16.21",
    "next": "^15.1.6",
    "pdfjs-dist": "^4.10.38",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/katex": "^0.16.7",
    "@types/node": "^22.13.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.3",
    "vitest": "^3.0.5"
  },
  "engines": { "node": ">=20" }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.mjs`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': `${process.cwd()}/src` } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`.gitignore`:

```
node_modules/
.next/
out/
.env
.env.local
.env*.local
*.tsbuildinfo
next-env.d.ts
.DS_Store
```

`.env.example`:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=dat-mot-chuoi-ngau-nhien
PANDOC_URL=https://pandoc-server.onrender.com/convert
MATHTYPE_URL=https://latex2mathtypeweb.onrender.com
```

- [ ] **Step 2: Create app shell files**

`src/app/layout.tsx`:

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AIOMT OCR PDF/Image',
  description: 'OCR tài liệu Toán và bảng biểu → Word, giữ công thức và hình minh họa',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx` (temporary placeholder, replaced in Task 16):

```tsx
export default function Page() {
  return <main className="container"><h1>AIOMT OCR</h1><p>Đang xây dựng...</p></main>;
}
```

`src/app/globals.css`:

```css
@import 'katex/dist/katex.min.css';

:root {
  --bg: #0f1220; --card: #1a1f33; --ink: #e7e9f3; --mut: #9aa3c0;
  --acc: #6c8cff; --line: #2b3253; --ok: #3ecf8e; --err: #ff6b6b;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
  font-family: system-ui, 'Segoe UI', Roboto, sans-serif; }
.container { max-width: 1280px; margin: 0 auto; padding: 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
button { cursor: pointer; }
```

- [ ] **Step 3: Install dependencies and verify build**

Run: `npm install`

Expected: installs cleanly, no peer-dependency errors.

Run: `npm run build`

Expected: build succeeds with the placeholder page (first run creates `next-env.d.ts`).

- [ ] **Step 4: Init git and commit**

```bash
git init
git add -A
git commit -m "chore: scaffold Next.js 15 + TS + Vitest project"
```

---

### Task 2: Key pool with rotation (client-side)

**Files:**
- Create: `src/lib/key-rotation.ts`
- Test: `src/lib/key-rotation.test.ts`

**Interfaces:**
- Produces: `KeyPool`, `KeyPoolExhaustedError`, `isRateLimitError(err): boolean`, `runWithRotation<T>(pool, fn, opts?): Promise<T>` with `opts: { maxAttempts?, isRateLimit?, onRotated?: (info: { key: string; attempts: number }) => void }`.

- [ ] **Step 1: Write the failing test**

`src/lib/key-rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { KeyPool, KeyPoolExhaustedError, isRateLimitError, runWithRotation } from './key-rotation';

describe('KeyPool', () => {
  it('rotates round-robin', () => {
    const pool = KeyPool.create(['a', 'b', 'c']);
    expect([pool.nextKey(), pool.nextKey(), pool.nextKey(), pool.nextKey()]).toEqual(['a', 'b', 'c', 'a']);
  });

  it('skips cooled-down keys', () => {
    const pool = KeyPool.create(['a', 'b']);
    pool.markRateLimited('a', 0);
    expect(pool.nextKey(1)).toBe('b');
    expect(pool.nextKey(1)).toBe('b');
  });

  it('throws when all keys are cooled down or none exist', () => {
    const pool = KeyPool.create(['a']);
    pool.markRateLimited('a', 0);
    expect(() => pool.nextKey(1)).toThrow(KeyPoolExhaustedError);
    expect(() => KeyPool.create([]).nextKey()).toThrow(KeyPoolExhaustedError);
  });

  it('serializes state including cooldowns', () => {
    const pool = KeyPool.create(['a', 'b']);
    pool.nextKey();
    pool.markRateLimited('b', 0);
    const state = pool.serialize();
    expect(state.keys).toEqual(['a', 'b']);
    const restored = new KeyPool(state);
    expect(restored.nextKey(1)).toBe('a');
  });
});

describe('isRateLimitError', () => {
  it('detects 429/503 and rate-limit messages', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 503 })).toBe(true);
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('quota exhausted'))).toBe(true);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(new Error('invalid key'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('runWithRotation', () => {
  it('returns result on first success', async () => {
    const pool = KeyPool.create(['a', 'b']);
    const result = await runWithRotation(pool, async (key) => key);
    expect(result).toBe('a');
  });

  it('rotates to next key on rate limit', async () => {
    const pool = KeyPool.create(['a', 'b']);
    const seen: string[] = [];
    const result = await runWithRotation(pool, async (key) => {
      seen.push(key);
      if (key === 'a') throw Object.assign(new Error('429'), { status: 429 });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(seen).toEqual(['a', 'b']);
  });

  it('throws immediately on non-rate-limit errors', async () => {
    const pool = KeyPool.create(['a', 'b']);
    let calls = 0;
    await expect(
      runWithRotation(pool, async () => { calls++; throw new Error('bad api key'); }),
    ).rejects.toThrow('bad api key');
    expect(calls).toBe(1);
  });

  it('throws KeyPoolExhaustedError when every key is rate-limited', async () => {
    const pool = KeyPool.create(['a']);
    await expect(
      runWithRotation(pool, async () => { throw Object.assign(new Error('429'), { status: 429 }); }, { maxAttempts: 2 }),
    ).rejects.toThrow(KeyPoolExhaustedError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/key-rotation.test.ts`

Expected: FAIL — `Cannot find module './key-rotation'`.

- [ ] **Step 3: Write the implementation**

`src/lib/key-rotation.ts`:

```ts
export interface KeyPoolState {
  keys: string[];
  index: number;
  cooldowns: Record<string, number>;
}

export class KeyPoolExhaustedError extends Error {
  constructor(message = 'Tất cả API key đều đang bị giới hạn tốc độ. Vui lòng đợi hoặc thêm key mới.') {
    super(message);
    this.name = 'KeyPoolExhaustedError';
  }
}

const DEFAULT_COOLDOWN_MS = 60_000;

export class KeyPool {
  private keys: string[];
  private index: number;
  private cooldowns: Map<string, number>;
  private cooldownMs: number;

  constructor(state: KeyPoolState, opts?: { cooldownMs?: number }) {
    this.keys = state.keys.slice();
    this.index = state.index ?? 0;
    this.cooldowns = new Map(Object.entries(state.cooldowns ?? {}));
    this.cooldownMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  static create(keys: string[], opts?: { cooldownMs?: number }): KeyPool {
    return new KeyPool({ keys, index: 0, cooldowns: {} }, opts);
  }

  get size(): number {
    return this.keys.length;
  }

  isAvailable(key: string, now = Date.now()): boolean {
    const until = this.cooldowns.get(key);
    return !until || until <= now;
  }

  nextKey(now = Date.now()): string {
    if (this.keys.length === 0) throw new KeyPoolExhaustedError('Chưa có API key nào.');
    for (let i = 0; i < this.keys.length; i++) {
      this.index = this.index % this.keys.length;
      const key = this.keys[this.index];
      this.index += 1;
      if (this.isAvailable(key, now)) return key;
    }
    throw new KeyPoolExhaustedError();
  }

  markRateLimited(key: string, now = Date.now()): void {
    this.cooldowns.set(key, now + this.cooldownMs);
  }

  serialize(): KeyPoolState {
    return { keys: this.keys.slice(), index: this.index, cooldowns: Object.fromEntries(this.cooldowns) };
  }
}

export function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: number; message?: string; name?: string };
    if (e.status === 429 || e.status === 503 || e.code === 429) return true;
    const text = `${e.message ?? ''} ${e.name ?? ''}`.toLowerCase();
    return /rate.?limit|quota|too many request|resource.?exhausted/i.test(text);
  }
  return false;
}

export async function runWithRotation<T>(
  pool: KeyPool,
  fn: (key: string) => Promise<T>,
  opts?: {
    maxAttempts?: number;
    isRateLimit?: (err: unknown) => boolean;
    onRotated?: (info: { key: string; attempts: number }) => void;
  },
): Promise<T> {
  const isRL = opts?.isRateLimit ?? isRateLimitError;
  const maxAttempts = opts?.maxAttempts ?? Math.max(4, pool.size * 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pool.nextKey();
    try {
      return await fn(key);
    } catch (err) {
      lastError = err;
      if (!isRL(err)) throw err;
      pool.markRateLimited(key);
      opts?.onRotated?.({ key, attempts: attempt + 1 });
    }
  }
  throw lastError instanceof KeyPoolExhaustedError ? lastError : new KeyPoolExhaustedError();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/key-rotation.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/key-rotation.ts src/lib/key-rotation.test.ts
git commit -m "feat: key pool with round-robin rotation and rate-limit cooldown"
```

---

### Task 3: Markdown markers, stats, sanitization

**Files:**
- Create: `src/lib/markdown/markers.ts`
- Test: `src/lib/markdown/markers.test.ts`

**Interfaces:**
- Produces: `ImageMarker { page, x1, y1, x2, y2, caption, raw }` (permille coords), `parseImageMarkers(md): ImageMarker[]`, `countFormulas(md)`, `countDataUriImages(md)`, `countCharacters(md)`, `countPages(md)`, `sanitizeMarkdownForPandoc(md)`.

- [ ] **Step 1: Write the failing test**

`src/lib/markdown/markers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  parseImageMarkers, countFormulas, countDataUriImages, countCharacters, countPages,
  sanitizeMarkdownForPandoc,
} from './markers';

const SAMPLE = `<!-- Trang 1 -->

### Bài 1

Cho $\\alpha = 11^{\\circ}$ và $F_a = \\eta v^2$.

$$\n\\int_0^{x_0} \\frac{dx}{1-x^2}\n$$

Hình vẽ:

[[IMAGE:1,200,120,700,650|Đồ thị]]

![pic](data:image/png;base64,iVBORw0KGgo=)
`;

describe('parseImageMarkers', () => {
  it('parses marker fields and caption', () => {
    const markers = parseImageMarkers(SAMPLE);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.page).toBe(1);
    expect(m.x1).toBe(200); expect(m.y1).toBe(120);
    expect(m.x2).toBe(700); expect(m.y2).toBe(650);
    expect(m.caption).toBe('Đồ thị');
  });

  it('handles markers without caption', () => {
    const markers = parseImageMarkers('x [[IMAGE:2,10,20,30,40]] y');
    expect(markers[0].caption).toBe('');
  });

  it('ignores malformed markers', () => {
    expect(parseImageMarkers('[[IMAGE:abc]] [[image:1,2,3,4,5]]')).toHaveLength(0);
  });
});

describe('counters', () => {
  it('counts block and inline formulas', () => {
    expect(countFormulas(SAMPLE)).toBe(3);
  });

  it('counts data-uri images', () => {
    expect(countDataUriImages(SAMPLE)).toBe(1);
  });

  it('counts characters and pages', () => {
    expect(countCharacters(SAMPLE)).toBe(SAMPLE.length);
    expect(countPages('<!-- Trang 1 -->\n<!-- Trang 2 -->\n<!-- Trang 1 -->')).toBe(2);
  });
});

describe('sanitizeMarkdownForPandoc', () => {
  it('strips BOM and converts standalone --- to *** outside fences', () => {
    expect(sanitizeMarkdownForPandoc('\uFEFF# Tiêu đề\n\n---\n\nNội dung\n')).toBe('# Tiêu đề\n\n***\n\nNội dung\n');
  });

  it('leaves --- inside code fences untouched', () => {
    expect(sanitizeMarkdownForPandoc('```\n---\n```\n')).toBe('```\n---\n```\n');
  });

  it('normalizes CRLF and non-breaking spaces', () => {
    expect(sanitizeMarkdownForPandoc('a\r\nb\u00a0c')).toBe('a b c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/markdown/markers.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/markdown/markers.ts`:

```ts
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
  /\[\[IMAGE\s*:\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:\|\s*([^\]]*?))?\]\]/gi;

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
  const src = md.replace(/^\uFEFF/, '').replace(/\r\n?/g, ' ').replace(/\u00a0/g, ' ');
  let inFence = false;
  let fenceChar = '';
  return src
    .split(' ')
    .map((part) => {
      const fence = part.match(/^\s*(```+|~~~+)/);
      if (fence) {
        const ch = fence[1][0];
        if (inFence) {
          if (ch === fenceChar) { inFence = false; fenceChar = ''; }
        } else {
          inFence = true; fenceChar = ch;
        }
        return part;
      }
      return !inFence && /^\s*---\s*$/.test(part) ? '***' : part;
    })
    .join(' ');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/markdown/markers.test.ts`

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown/markers.ts src/lib/markdown/markers.test.ts
git commit -m "feat: parse image markers, stats counters, pandoc sanitizer"
```

---

### Task 4: Build export markdown (marker → data-URI image)

**Files:**
- Create: `src/lib/markdown/build-markdown.ts`
- Test: `src/lib/markdown/build-markdown.test.ts`

**Interfaces:**
- Consumes: `parseImageMarkers`, `ImageMarker` from Task 3.
- Produces: `markerKey(m): string`, `buildExportMarkdown(md, images: Map<string, string>): string` (map accepts either `markerKey(m)` or the raw marker text as key; markers without an image are left untouched).

- [ ] **Step 1: Write the failing test**

`src/lib/markdown/build-markdown.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildExportMarkdown, markerKey } from './build-markdown';
import { parseImageMarkers } from './markers';

describe('buildExportMarkdown', () => {
  const md = 'Trước.\n\n[[IMAGE:1,200,120,700,650|Đồ thị]]\n\nSau.\n';
  const url = 'data:image/png;base64,AAAA';

  it('replaces markers having an image with markdown image syntax', () => {
    const marker = parseImageMarkers(md)[0];
    const out = buildExportMarkdown(md, new Map([[markerKey(marker), url]]));
    expect(out).toContain(`![Đồ thị](${url})`);
    expect(out).not.toContain('[[IMAGE:');
  });

  it('accepts raw marker text as map key too', () => {
    const marker = parseImageMarkers(md)[0];
    const out = buildExportMarkdown(md, new Map([[marker.raw, url]]));
    expect(out).toContain(`![Đồ thị](${url})`);
  });

  it('leaves markers without images untouched', () => {
    const out = buildExportMarkdown(md, new Map());
    expect(out).toBe(md);
  });

  it('uses a fallback alt text when caption is empty', () => {
    const md2 = '[[IMAGE:2,10,20,30,40]]';
    const marker = parseImageMarkers(md2)[0];
    const out = buildExportMarkdown(md2, new Map([[markerKey(marker), url]]));
    expect(out).toBe('![hình](data:image/png;base64,AAAA)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/markdown/build-markdown.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/markdown/build-markdown.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/markdown/build-markdown.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/markdown/build-markdown.ts src/lib/markdown/build-markdown.test.ts
git commit -m "feat: build export markdown with data-uri images"
```

---

### Task 5: DOCX post-processing (Times New Roman + question labels)

**Files:**
- Create: `src/lib/export/postprocess.ts`
- Test: `src/lib/export/postprocess.test.ts`

**Interfaces:**
- Produces: `forceTimesNewRomanRuns(documentXml): string`, `ensureDocDefaultsFont(stylesXml): string`, `styleQuestionLabels(documentXml): string`, `postprocessPandocDocx(blob): Promise<Blob>` (falls back to the original blob on any failure).

- [ ] **Step 1: Write the failing test**

`src/lib/export/postprocess.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  forceTimesNewRomanRuns, ensureDocDefaultsFont, styleQuestionLabels, postprocessPandocDocx,
} from './postprocess';

const RFONTS = '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';

describe('forceTimesNewRomanRuns', () => {
  it('adds rPr with Times New Roman to plain text runs', () => {
    const xml = '<w:p><w:r><w:t>Hello</w:t></w:r></w:p>';
    expect(forceTimesNewRomanRuns(xml)).toContain(`<w:r><w:rPr>${RFONTS}</w:rPr><w:t>Hello</w:t></w:r>`);
  });

  it('injects font into existing rPr and replaces existing w:rFonts', () => {
    const xml = '<w:r><w:rPr><w:b/><w:rFonts w:ascii="Calibri"/></w:rPr><w:t>X</w:t></w:r>';
    const out = forceTimesNewRomanRuns(xml);
    expect(out).toContain(RFONTS);
    expect(out).not.toContain('Calibri');
    expect(out).toContain('<w:b/>');
  });

  it('does not touch non-text runs', () => {
    const xml = '<w:r><w:drawing><wp:inline/></w:drawing></w:r>';
    expect(forceTimesNewRomanRuns(xml)).toBe(xml);
  });
});

describe('ensureDocDefaultsFont', () => {
  it('adds docDefaults block when missing', () => {
    const out = ensureDocDefaultsFont('<w:styles><w:style w:type="paragraph"/></w:styles>');
    expect(out).toContain('<w:docDefaults><w:rPrDefault><w:rPr>');
    expect(out).toContain(RFONTS);
  });

  it('patches existing docDefaults rPr', () => {
    const out = ensureDocDefaultsFont('<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>');
    expect(out).toContain(RFONTS);
    expect(out).not.toContain('Calibri');
  });
});

describe('styleQuestionLabels', () => {
  it('styles "Câu 1." blue+bold at paragraph start', () => {
    const xml = '<w:p><w:r><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr><w:t>Câu 1. Nội dung</w:t></w:r></w:p>';
    const out = styleQuestionLabels(xml);
    expect(out).toContain('<w:b/><w:bCs/>');
    expect(out).toContain('<w:color w:val="1D4ED8"/>');
    expect(out).toContain('>Câu 1.</w:t>');
    expect(out).toContain('> Nội dung</w:t>');
  });

  it('styles "a)" bold (not blue) and leaves other paragraphs alone', () => {
    const xml = '<w:p><w:r><w:t>a) Đáp án</w:t></w:r></w:p><w:p><w:r><w:t>Thường</w:t></w:r></w:p>';
    const out = styleQuestionLabels(xml);
    expect(out).toContain('<w:b/><w:bCs/>');
    expect(out).not.toContain('1D4ED8');
    expect(out).toContain('>Thường</w:t>');
  });
});

describe('postprocessPandocDocx', () => {
  it('patches document.xml and styles.xml of a real docx', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Xin chào</w:t></w:r></w:p></w:body></w:document>');
    zip.file('word/styles.xml', '<w:styles><w:style w:type="paragraph"/></w:styles>');
    const blob = await zip.generateAsync({ type: 'blob' });
    const out = await postprocessPandocDocx(blob);
    expect(out.size).toBeGreaterThan(0);
    const outZip = await JSZip.loadAsync(out);
    const docXml = await outZip.file('word/document.xml')!.async('string');
    const stylesXml = await outZip.file('word/styles.xml')!.async('string');
    expect(docXml).toContain(RFONTS);
    expect(stylesXml).toContain('<w:docDefaults>');
  });

  it('returns the original blob if the input is not a zip', async () => {
    const blob = new Blob(['not a docx'], { type: 'application/octet-stream' });
    const out = await postprocessPandocDocx(blob);
    expect(out).toBe(blob);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/export/postprocess.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/export/postprocess.ts`:

```ts
const RFONTS =
  '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>';
const LABEL_BLUE = '1D4ED8';

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function xmlUnescape(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (ent) => {
    if (ent === '&amp;') return '&';
    if (ent === '&lt;') return '<';
    if (ent === '&gt;') return '>';
    if (ent === '&quot;') return '"';
    if (ent === '&apos;') return "'";
    const num = ent.startsWith('&#x') ? parseInt(ent.slice(3, -1), 16) : parseInt(ent.slice(2, -1), 10);
    return Number.isFinite(num) ? String.fromCodePoint(num) : ent;
  });
}

function patchRPrWithFonts(rPr: string): string {
  return /<w:rFonts\b/.test(rPr)
    ? rPr.replace(/<w:rFonts\b[^/]*(?:\/>|>[\s\S]*?<\/w:rFonts>)/, RFONTS)
    : rPr.replace(/<w:rPr>/, `<w:rPr>${RFONTS}`);
}

export function forceTimesNewRomanRuns(documentXml: string): string {
  return documentXml.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner: string) => {
    if (!/<w:t\b/.test(inner)) return run;
    if (/<w:rPr>[\s\S]*?<\/w:rPr>/.test(inner)) {
      return `<w:r>${inner.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr) => patchRPrWithFonts(rPr))}</w:r>`;
    }
    return `<w:r><w:rPr>${RFONTS}</w:rPr>${inner}</w:r>`;
  });
}

export function ensureDocDefaultsFont(stylesXml: string): string {
  if (/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.test(stylesXml)) {
    return stylesXml.replace(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/, (block) => {
      if (/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/.test(block)) {
        return block.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/, (rpd) =>
          /<w:rPr>[\s\S]*?<\/w:rPr>/.test(rpd)
            ? rpd.replace(/<w:rPr>[\s\S]*?<\/w:rPr>/, (rPr) => patchRPrWithFonts(rPr))
            : rpd.replace(/<\/w:rPrDefault>/, `<w:rPr>${RFONTS}</w:rPr></w:rPrDefault>`),
        );
      }
      return block.replace(
        /<\/w:docDefaults>/,
        `<w:rPrDefault><w:rPr>${RFONTS}</w:rPr></w:rPrDefault></w:docDefaults>`,
      );
    });
  }
  return stylesXml.replace(
    /<w:styles([^>]*)>/,
    `<w:styles$1><w:docDefaults><w:rPrDefault><w:rPr>${RFONTS}</w:rPr></w:rPrDefault></w:docDefaults>`,
  );
}

interface LabelStyle {
  label: string;
  blue: boolean;
  bold: boolean;
}

function detectLabel(paragraphText: string): LabelStyle | null {
  const t = paragraphText.replace(/^\s+/, '');
  let m = t.match(/^((?:Câu|Bài)\s+\d+\s*[.:])/i);
  if (m) return { label: m[1], blue: true, bold: true };
  m = t.match(/^([A-D]\.)\s*/u);
  if (m) return { label: m[1], blue: true, bold: true };
  m = t.match(/^([a-d]\))\s*/u);
  if (m) return { label: m[1], blue: false, bold: true };
  return null;
}

function paragraphText(xml: string): string {
  let text = '';
  xml.replace(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g, (full, t: string) => {
    text += xmlUnescape(t);
    return full;
  });
  return text;
}

function buildStyledRun(text: string, style: { bold: boolean; blue: boolean }): string {
  const rPr = `${style.bold ? '<w:b/><w:bCs/>' : ''}${style.blue ? `<w:color w:val="${LABEL_BLUE}"/>` : ''}`;
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
  return `<w:r><w:rPr>${rPr}</w:rPr><w:t${space}>${xmlEscape(text)}</w:t></w:r>`;
}

export function styleQuestionLabels(documentXml: string): string {
  return documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (para) => {
    const label = detectLabel(paragraphText(para));
    if (!label) return para;
    let used = false;
    return para.replace(/<w:r>([\s\S]*?)<\/w:r>/g, (run, inner: string) => {
      if (used || !/<w:t\b/.test(inner)) return run;
      const m = inner.match(/<w:t([^>]*)>([\s\S]*?)<\/w:t>/);
      if (!m) return run;
      const raw = xmlUnescape(m[2]);
      const lead = raw.match(/^\s*/)?.[0] ?? '';
      const rest = raw.slice(lead.length);
      if (!rest.startsWith(label.label)) return run;
      used = true;
      const after = rest.slice(label.label.length);
      const runs: string[] = [];
      if (lead) runs.push(buildStyledRun(lead, { bold: false, blue: false }));
      runs.push(buildStyledRun(label.label, { bold: label.bold, blue: label.blue }));
      if (after) runs.push(buildStyledRun(after, { bold: false, blue: false }));
      return runs.join('');
    });
  });
}

export async function postprocessPandocDocx(blob: Blob): Promise<Blob> {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    const doc = zip.file('word/document.xml');
    if (doc) {
      let xml = await doc.async('string');
      xml = forceTimesNewRomanRuns(xml);
      xml = styleQuestionLabels(xml);
      zip.file('word/document.xml', xml);
    }
    const styles = zip.file('word/styles.xml');
    if (styles) {
      zip.file('word/styles.xml', ensureDocDefaultsFont(await styles.async('string')));
    }
    return await zip.generateAsync({ type: 'blob' });
  } catch {
    return blob;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/export/postprocess.test.ts`

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/postprocess.ts src/lib/export/postprocess.test.ts
git commit -m "feat: docx post-processing (Times New Roman + question labels)"
```

---

### Task 6: OCR core prompt builder

**Files:**
- Create: `src/lib/providers/prompt.ts`
- Test: `src/lib/providers/prompt.test.ts`

**Interfaces:**
- Produces: `buildCorePrompt(opts?: { extraPrompt?: string }): string`.

- [ ] **Step 1: Write the failing test**

`src/lib/providers/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildCorePrompt } from './prompt';

describe('buildCorePrompt', () => {
  const prompt = buildCorePrompt();

  it('demands plain markdown without code fences', () => {
    expect(prompt).toContain('Markdown thuần');
    expect(prompt).toContain('KHÔNG dùng code fence');
  });

  it('demands page markers', () => {
    expect(prompt).toContain('<!-- Trang N -->');
  });

  it('demands LaTeX inline/block and pipe tables', () => {
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('$$...$$');
    expect(prompt).toContain('|---|');
  });

  it('demands figure markers with permille coordinates and example', () => {
    expect(prompt).toContain('[[IMAGE:trang,x1,y1,x2,y2|chú thích]]');
    expect(prompt).toContain('[[IMAGE:1,200,120,700,650|Đồ thị]]');
    expect(prompt).toContain('PHẦN NGHÌN');
  });

  it('keeps Vietnamese and appends extra prompt', () => {
    expect(prompt).toContain('tiếng Việt giữ nguyên');
    const withExtra = buildCorePrompt({ extraPrompt: '  Giữ số thứ tự câu hỏi.  ' });
    expect(withExtra).toContain('Giữ số thứ tự câu hỏi.');
    expect(withExtra).toContain('YÊU CẦU BỔ SUNG');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/providers/prompt.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/providers/prompt.ts`:

```ts
export interface PromptOptions {
  extraPrompt?: string;
}

export function buildCorePrompt(opts: PromptOptions = {}): string {
  const lines = [
    'Bạn là công cụ OCR chuyên nghiệp. Hãy chuyển nội dung tài liệu thành Markdown thuần (plain Markdown), KHÔNG dùng code fence (không bọc toàn bộ kết quả trong ```).',
    '',
    'QUY TẮC BẮT BUỘC:',
    '1. Giữ nguyên ngôn ngữ của tài liệu (tiếng Việt giữ nguyên, không dịch).',
    '2. Giữ nguyên thứ tự và toàn bộ nội dung; không tóm tắt, không thêm ý kiến.',
    '3. Đầu mỗi trang ghi đúng một dòng: <!-- Trang N --> (N là số trang, bắt đầu từ 1).',
    '4. Công thức toán: công thức nội tuyến dùng $...$; công thức riêng một dòng dùng $$...$$. Viết LaTeX chuẩn (dùng \\frac, \\sqrt, \\int, \\sum, \\alpha, \\circ, \\text{...} khi cần).',
    '5. Bảng biểu: dùng bảng Markdown (pipe table) với dòng phân cách |---|. Ô chứa công thức dùng $...$.',
    '6. Chữ in đậm **...**, in nghiêng *...*; tiêu đề dùng # / ## / ### theo cấp độ.',
    '7. HÌNH ẢNH/BIỂU ĐỒ/ĐỒ THỊ: KHÔNG mô tả nội dung hình. Đặt đúng vị trí hình một marker:',
    '   [[IMAGE:trang,x1,y1,x2,y2|chú thích]]',
    '   trong đó trang là số trang; x1,y1 là góc trên-trái và x2,y2 là góc dưới-phải của hình,',
    '   tính theo PHẦN NGHÌN (permille) chiều rộng/chiều cao trang (giá trị từ 0 đến 1000).',
    '   Ví dụ hình nằm từ 20% đến 70% chiều rộng và từ 12% đến 65% chiều cao trang 1: [[IMAGE:1,200,120,700,650|Đồ thị]]',
    '8. Câu hỏi trắc nghiệm giữ nguyên nhãn (A., B., C., D. hoặc a), b), c), d)).',
  ];
  if (opts.extraPrompt?.trim()) {
    lines.push('', 'YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:');
    lines.push(opts.extraPrompt.trim());
  }
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/providers/prompt.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/prompt.ts src/lib/providers/prompt.test.ts
git commit -m "feat: core OCR prompt with LaTeX/table/figure-marker rules"
```

---

### Task 7: Gemini provider (raw PDF → Markdown, with rotation)

**Files:**
- Create: `src/lib/providers/gemini.ts`
- Test: `src/lib/providers/gemini.test.ts`

**Interfaces:**
- Consumes: `runWithRotation`, `buildCorePrompt`.
- Produces: `ocrPdfWithGemini(opts: GeminiOcrOptions): Promise<string>` with `GeminiOcrOptions { pdfBase64, keys, model, extraPrompt?, onProgress?, onRotated? }`, plus constant `GEMINI_API_BASE`.

- [ ] **Step 1: Write the failing test**

`src/lib/providers/gemini.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ocrPdfWithGemini } from './gemini';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ocrPdfWithGemini', () => {
  it('posts the PDF with the core prompt and returns the markdown', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ candidates: [{ content: { parts: [{ text: '# Kết quả\n' }, { text: 'Tiếp\n' }] } }] });
    }));

    const result = await ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1'], model: 'gemini-3.5-flash' });
    expect(result).toBe('# Kết quả\nTiếp\n');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('k1');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.contents[0].parts[0].text).toContain('[[IMAGE:');
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'application/pdf', data: 'UERG' });
  });

  it('rotates to the next key on 429', async () => {
    const keys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>)['x-goog-api-key'];
      keys.push(key);
      if (key === 'k1') return jsonResponse({ error: { message: 'quota' } }, 429);
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
    }));

    const result = await ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1', 'k2'], model: 'gemini-3.5-flash' });
    expect(result).toBe('ok');
    expect(keys).toEqual(['k1', 'k2']);
  });

  it('throws without rotating on non-rate-limit errors', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return jsonResponse({ error: { message: 'API key not valid' } }, 400);
    }));
    await expect(ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1', 'k2'], model: 'm' })).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });

  it('throws when the response is empty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ candidates: [] })));
    await expect(ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1'], model: 'm' })).rejects.toThrow(/rỗng/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/providers/gemini.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/providers/gemini.ts`:

```ts
import { KeyPool, runWithRotation } from '@/lib/key-rotation';
import { buildCorePrompt } from './prompt';

export interface GeminiOcrOptions {
  pdfBase64: string;
  keys: string[];
  model: string;
  extraPrompt?: string;
  onProgress?: (msg: string) => void;
  onRotated?: (info: { key: string; attempts: number }) => void;
}

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export async function ocrPdfWithGemini(opts: GeminiOcrOptions): Promise<string> {
  const pool = KeyPool.create(opts.keys);
  const prompt = buildCorePrompt({ extraPrompt: opts.extraPrompt });
  const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(opts.model)}:generateContent`;
  return runWithRotation(
    pool,
    async (key) => {
      opts.onProgress?.(`Đang gửi PDF tới ${opts.model}...`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType: 'application/pdf', data: opts.pdfBase64 } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw Object.assign(new Error(`Gemini API lỗi ${res.status}: ${errText.slice(0, 300)}`), { status: res.status });
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error('Gemini trả về kết quả rỗng.');
      return text;
    },
    { onRotated: opts.onRotated },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/providers/gemini.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/gemini.ts src/lib/providers/gemini.test.ts
git commit -m "feat: gemini provider (raw pdf, key rotation)"
```

---

### Task 8: OpenAI-compatible provider (page images → Markdown, with rotation)

**Files:**
- Create: `src/lib/providers/openai.ts`
- Test: `src/lib/providers/openai.test.ts`

**Interfaces:**
- Consumes: `runWithRotation`, `buildCorePrompt`.
- Produces: `normalizeBaseUrl(baseUrl): string`, `ocrImagesWithOpenAI(opts: OpenAIOcrOptions): Promise<string>` with `OpenAIOcrOptions { pageImages: string[], keys, baseUrl, model, extraPrompt?, maxTokens?, onProgress?, onRotated? }`.

- [ ] **Step 1: Write the failing test**

`src/lib/providers/openai.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeBaseUrl, ocrImagesWithOpenAI } from './openai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1/// ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('')).toBe('');
  });
});

describe('ocrImagesWithOpenAI', () => {
  it('posts images to {base}/chat/completions with Bearer auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ choices: [{ message: { content: '# Kết quả\n' } }] });
    }));

    const result = await ocrImagesWithOpenAI({
      pageImages: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      keys: ['sk-1'],
      baseUrl: 'https://api.example.com/v1/',
      model: 'gpt-4o',
      maxTokens: 16000,
    });
    expect(result).toBe('# Kết quả\n');
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(16000);
    const content = body.messages[0].content;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('[[IMAGE:');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    expect(content[2].image_url.url).toBe('data:image/png;base64,BBB');
  });

  it('omits max_tokens when not set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'x' } }] })));
    const init: RequestInit[] = [];
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (_u: string, i: RequestInit) => { init.push(i); return jsonResponse({ choices: [{ message: { content: 'x' } }] }); });
    await ocrImagesWithOpenAI({ pageImages: ['data:image/png;base64,A'], keys: ['k'], baseUrl: 'https://x.test', model: 'm' });
    const body = JSON.parse(init[0].body as string);
    expect('max_tokens' in body).toBe(false);
  });

  it('rotates keys on 429', async () => {
    const used: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>).Authorization.replace('Bearer ', '');
      used.push(key);
      if (key === 'a') return jsonResponse({ error: { message: 'rate limit' } }, 429);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }));
    const result = await ocrImagesWithOpenAI({ pageImages: ['data:image/png;base64,A'], keys: ['a', 'b'], baseUrl: 'https://x.test', model: 'm' });
    expect(result).toBe('ok');
    expect(used).toEqual(['a', 'b']);
  });

  it('throws when baseUrl is missing', async () => {
    await expect(ocrImagesWithOpenAI({ pageImages: [], keys: ['k'], baseUrl: '  ', model: 'm' })).rejects.toThrow(/Base URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/providers/openai.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/providers/openai.ts`:

```ts
import { KeyPool, runWithRotation } from '@/lib/key-rotation';
import { buildCorePrompt } from './prompt';

export interface OpenAIOcrOptions {
  pageImages: string[];
  keys: string[];
  baseUrl: string;
  model: string;
  extraPrompt?: string;
  maxTokens?: number;
  onProgress?: (msg: string) => void;
  onRotated?: (info: { key: string; attempts: number }) => void;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

export async function ocrImagesWithOpenAI(opts: OpenAIOcrOptions): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl);
  if (!base) throw new Error('Chưa nhập Base URL cho OpenAI.');
  const pool = KeyPool.create(opts.keys);
  const prompt = buildCorePrompt({ extraPrompt: opts.extraPrompt });
  const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: prompt },
  ];
  for (const img of opts.pageImages) content.push({ type: 'image_url', image_url: { url: img } });
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [{ role: 'user', content }],
  };
  if (opts.maxTokens && opts.maxTokens > 0) body.max_tokens = opts.maxTokens;
  return runWithRotation(
    pool,
    async (key) => {
      opts.onProgress?.(`Đang gửi ảnh tới ${opts.model}...`);
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw Object.assign(new Error(`OpenAI API lỗi ${res.status}: ${errText.slice(0, 300)}`), { status: res.status });
      }
      const data = await res.json();
      const message = data?.choices?.[0]?.message?.content;
      const text = typeof message === 'string'
        ? message
        : (message?.map?.((p: { text?: string }) => p?.text ?? '').join('') ?? '');
      if (!text.trim()) throw new Error('OpenAI trả về kết quả rỗng.');
      return text;
    },
    { onRotated: opts.onRotated },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/providers/openai.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/providers/openai.ts src/lib/providers/openai.test.ts
git commit -m "feat: openai-compatible provider (images, custom base url, rotation)"
```

---

### Task 9: PDF render, image cutting, base64 helpers

**Files:**
- Create: `src/lib/base64.ts`, `src/lib/pdf/render-pages.ts`, `src/lib/pdf/cut-image.ts`
- Test: `src/lib/pdf/pdf.test.ts`

**Interfaces:**
- Produces: `arrayBufferToBase64(buf): string`, `dataUrlToBlob(dataUrl): Blob`, `computeRenderScale(choice): number`, `clampPageCount(total, maxPages): number`, `RenderedPage { pageNumber, dataUrl, width, height }`, `renderPdfToImages(data, opts): Promise<RenderedPage[]>` (browser-only; pdfjs imported dynamically), `fileToDataUrl(file): Promise<string>`, `markerToPixelRect(marker, pageW, pageH): PixelRect`, `clampRect(rect, maxW, maxH): PixelRect`, `cutImageFromDataUrl(dataUrl, rect): Promise<string>` (browser canvas), `getImageDimensions(dataUrl): Promise<{width,height}>`.

- [ ] **Step 1: Write the failing test**

`src/lib/pdf/pdf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { arrayBufferToBase64 } from '../base64';
import { computeRenderScale, clampPageCount } from './render-pages';
import { markerToPixelRect, clampRect } from './cut-image';
import type { ImageMarker } from '../markdown/markers';

describe('arrayBufferToBase64', () => {
  it('encodes bytes', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(arrayBufferToBase64(buf)).toBe('aGVsbG8=');
  });

  it('handles large buffers in chunks', () => {
    const big = new Uint8Array(200_000).fill(65).buffer;
    const out = arrayBufferToBase64(big);
    expect(out.startsWith('QUFB')).toBe(true);
    expect(out.endsWith('QUFB')).toBe(true);
  });
});

describe('computeRenderScale / clampPageCount', () => {
  it('maps choices and clamps outliers', () => {
    expect(computeRenderScale('1.5')).toBe(1.5);
    expect(computeRenderScale('3')).toBe(3);
    expect(computeRenderScale('9')).toBe(2);
    expect(computeRenderScale('abc')).toBe(2);
  });

  it('clamps page counts', () => {
    expect(clampPageCount(50, 30)).toBe(30);
    expect(clampPageCount(3, 30)).toBe(3);
    expect(clampPageCount(10, 0)).toBe(1);
  });
});

describe('markerToPixelRect / clampRect', () => {
  const marker: ImageMarker = { page: 1, x1: 200, y1: 120, x2: 700, y2: 650, caption: '', raw: '' };

  it('converts permille to pixels', () => {
    const rect = markerToPixelRect(marker, 1000, 2000);
    expect(rect).toEqual({ x: 200, y: 240, w: 500, h: 1060 });
  });

  it('clamps out-of-bounds rects to page bounds', () => {
    const bad: ImageMarker = { page: 1, x1: -10, y1: -10, x2: 1200, y2: 5000, caption: '', raw: '' };
    const rect = markerToPixelRect(bad, 500, 500);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(500);
    expect(rect.y + rect.h).toBeLessThanOrEqual(500);
    expect(rect.w).toBeGreaterThan(0);
    expect(rect.h).toBeGreaterThan(0);
  });

  it('enforces a 1px minimum', () => {
    expect(clampRect({ x: 100, y: 100, w: -5, h: 0 }, 200, 200).w).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pdf/pdf.test.ts`

Expected: FAIL — modules missing.

- [ ] **Step 3: Write the implementations**

`src/lib/base64.ts`:

```ts
export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s);
  if (!m) throw new Error('Data URL ảnh không hợp lệ.');
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function fileToDataUrl(file: File): Promise<string> {
  const base64 = arrayBufferToBase64(await file.arrayBuffer());
  return `data:${file.type || 'image/png'};base64,${base64}`;
}
```

`src/lib/pdf/render-pages.ts`:

```ts
export type RenderScaleChoice = '1.5' | '2' | '2.5' | '3';
export const RENDER_SCALE_OPTIONS: RenderScaleChoice[] = ['1.5', '2', '2.5', '3'];

export function computeRenderScale(choice: string): number {
  const n = Number(choice);
  return Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : 2;
}

export function clampPageCount(totalPages: number, maxPages: number): number {
  const max = Math.max(1, Math.floor(maxPages));
  return Math.max(1, Math.min(totalPages, max));
}

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export async function renderPdfToImages(
  data: ArrayBuffer,
  opts: { scale: number; maxPages: number; onProgress?: (done: number, total: number) => void },
): Promise<RenderedPage[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const total = clampPageCount(doc.numPages, opts.maxPages);
  const pages: RenderedPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: opts.scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas render PDF.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      pageNumber: i,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });
    opts.onProgress?.(i, total);
  }
  return pages;
}
```

`src/lib/pdf/cut-image.ts`:

```ts
import type { ImageMarker } from '@/lib/markdown/markers';

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampRect(rect: PixelRect, maxW: number, maxH: number): PixelRect {
  const x = Math.max(0, Math.min(rect.x, maxW - 1));
  const y = Math.max(0, Math.min(rect.y, maxH - 1));
  const w = Math.max(1, Math.min(rect.w, maxW - x));
  const h = Math.max(1, Math.min(rect.h, maxH - y));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function markerToPixelRect(m: ImageMarker, pageWidth: number, pageHeight: number): PixelRect {
  const x = (m.x1 / 1000) * pageWidth;
  const y = (m.y1 / 1000) * pageHeight;
  const w = ((m.x2 - m.x1) / 1000) * pageWidth;
  const h = ((m.y2 - m.y1) / 1000) * pageHeight;
  return clampRect({ x, y, w, h }, pageWidth, pageHeight);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không tải được ảnh trang để cắt.'));
    img.src = src;
  });
}

export async function cutImageFromDataUrl(dataUrl: string, rect: PixelRect): Promise<string> {
  const img = await loadImage(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas cắt ảnh.');
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return canvas.toDataURL('image/png');
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Không đọc được kích thước ảnh.'));
    img.src = dataUrl;
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/pdf/pdf.test.ts`

Expected: PASS (7 tests). (pdfjs-dist and canvas stay untouched by these tests; the browser-only functions are verified in Task 18.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/base64.ts src/lib/pdf/render-pages.ts src/lib/pdf/cut-image.ts src/lib/pdf/pdf.test.ts
git commit -m "feat: pdf render, image cutting, base64 helpers"
```

---

### Task 10: Export service (Pandoc + MathType + orchestration)

**Files:**
- Create: `src/lib/export/pandoc.ts`, `src/lib/export/mathtype.ts`, `src/lib/export/export-service.ts`
- Test: `src/lib/export/export-service.test.ts`

**Interfaces:**
- Consumes: `buildExportMarkdown`, `sanitizeMarkdownForPandoc`, `postprocessPandocDocx`.
- Produces: `convertMarkdownToDocx(markdown, pandocUrl, opts?): Promise<Blob>`, `convertMarkdownToMathTypeDocx(markdown, mathTypeUrl, opts?): Promise<MathTypeResult { blob, converted, failed }>`, `exportWord(opts: ExportWordOptions): Promise<ExportWordResult { blob, filename, converted, failed }>`, `sanitizeFileName(name): string`, type `ExportMode = 'equation' | 'mathtype'`.

- [ ] **Step 1: Write the failing test**

`src/lib/export/export-service.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportWord, sanitizeFileName } from './export-service';

afterEach(() => { vi.unstubAllGlobals(); });

function docxResponse(): Response {
  return new Response(new Blob(['PK-fake-docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  });
}

describe('sanitizeFileName', () => {
  it('normalizes Vietnamese and special chars', () => {
    expect(sanitizeFileName('Đề thi Vật lí 10')).toBe('De_thi_Vat_li_10');
    expect(sanitizeFileName('   ')).toBe('tai_lieu_ocr');
  });
});

describe('exportWord equation mode', () => {
  it('posts sanitized markdown to pandoc and returns processed blob', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return docxResponse();
    }));

    const result = await exportWord({
      markdown: '# Đề\n\n$x^2$\n', images: new Map(), mode: 'equation',
      baseName: 'De_thi', pandocUrl: 'https://pandoc.test/convert', mathTypeUrl: 'https://mt.test',
    });
    expect(result.filename).toBe('De_thi_equation.docx');
    expect(result.blob.type).toContain('wordprocessingml');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://pandoc.test/convert');
    expect((calls[0].body as { markdown: string }).markdown).toContain('$x^2$');
  });
});

describe('exportWord mathtype mode', () => {
  it('posts {markdown, formula_mode} to /api/convert-markdown and parses X-Stats', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(new Blob(['PK-fake'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), {
        status: 200,
        headers: { 'X-Stats': '12,1' },
      });
    }));

    const result = await exportWord({
      markdown: '# Đề\n', images: new Map(), mode: 'mathtype',
      baseName: 'De_thi', pandocUrl: 'https://pandoc.test/convert', mathTypeUrl: 'https://mt.test/',
    });
    expect(result.filename).toBe('De_thi_mathtype.docx');
    expect(result.converted).toBe(12);
    expect(result.failed).toBe(1);
    expect(calls[0].url).toBe('https://mt.test/api/convert-markdown');
    expect(calls[0].body).toMatchObject({ formula_mode: 'mathtype' });
  });

  it('replaces image markers with data-uri images in the posted markdown', async () => {
    let posted = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      posted = JSON.parse(init.body as string).markdown;
      return docxResponse();
    }));
    const md = '[[IMAGE:1,200,120,700,650|Hình]]';
    const images = new Map([['1:200,120,700,650', 'data:image/png;base64,AAA']]);
    await exportWord({ markdown: md, images, mode: 'equation', baseName: 'x', pandocUrl: 'https://p.test', mathTypeUrl: 'https://m.test' });
    expect(posted).toBe('![Hình](data:image/png;base64,AAA)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/export/export-service.test.ts`

Expected: FAIL — modules missing.

- [ ] **Step 3: Write the implementations**

`src/lib/export/pandoc.ts`:

```ts
import { sanitizeMarkdownForPandoc } from '@/lib/markdown/markers';

export const DEFAULT_PANDOC_URL = 'https://pandoc-server.onrender.com/convert';

export async function convertMarkdownToDocx(
  markdown: string,
  pandocUrl: string,
  opts?: { attempts?: number },
): Promise<Blob> {
  const url = pandocUrl || DEFAULT_PANDOC_URL;
  const attempts = opts?.attempts ?? 2;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: sanitizeMarkdownForPandoc(markdown) }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const yamlHint = /YAML parse exception|scanning an alias/i.test(text)
          ? ' Nội dung vẫn chứa khối YAML không hợp lệ; hãy thử xóa phần --- ở đầu tài liệu.'
          : '';
        throw new Error(`Pandoc Server Error: ${res.status}${text ? ` - ${text}` : ''}${yamlHint}`);
      }
      return await res.blob();
    } catch (err) {
      lastError = err;
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}
```

`src/lib/export/mathtype.ts`:

```ts
import { sanitizeMarkdownForPandoc } from '@/lib/markdown/markers';

export const DEFAULT_MATHTYPE_URL = 'https://latex2mathtypeweb.onrender.com';

export interface MathTypeResult {
  blob: Blob;
  converted: number;
  failed: number;
}

export async function convertMarkdownToMathTypeDocx(
  markdown: string,
  mathTypeUrl: string,
  opts?: { attempts?: number },
): Promise<MathTypeResult> {
  const base = (mathTypeUrl || DEFAULT_MATHTYPE_URL).replace(/\/+$/, '');
  const url = `${base}/api/convert-markdown`;
  const attempts = opts?.attempts ?? 2;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: sanitizeMarkdownForPandoc(markdown), formula_mode: 'mathtype' }),
      });
      if (!res.ok) {
        let message = `Lỗi máy chủ MathType (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch { /* keep default message */ }
        throw new Error(message);
      }
      const [converted, failed] = (res.headers.get('X-Stats') ?? '0,0')
        .split(',')
        .map((n) => parseInt(n, 10) || 0);
      return { blob: await res.blob(), converted, failed };
    } catch (err) {
      lastError = err;
      if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastError;
}
```

`src/lib/export/export-service.ts`:

```ts
import { buildExportMarkdown } from '@/lib/markdown/build-markdown';
import { convertMarkdownToDocx } from './pandoc';
import { convertMarkdownToMathTypeDocx } from './mathtype';
import { postprocessPandocDocx } from './postprocess';

export type ExportMode = 'equation' | 'mathtype';

export interface ExportWordOptions {
  markdown: string;
  images: Map<string, string>;
  mode: ExportMode;
  baseName: string;
  pandocUrl: string;
  mathTypeUrl: string;
  onProgress?: (msg: string) => void;
}

export interface ExportWordResult {
  blob: Blob;
  filename: string;
  converted: number;
  failed: number;
}

export function sanitizeFileName(name: string): string {
  const cleaned = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'tai_lieu_ocr';
}

export async function exportWord(opts: ExportWordOptions): Promise<ExportWordResult> {
  const finalMarkdown = buildExportMarkdown(opts.markdown, opts.images);
  const safeName = sanitizeFileName(opts.baseName);
  if (opts.mode === 'equation') {
    opts.onProgress?.('Đang gọi Pandoc chuyển Markdown → Word (OMML)...');
    const blob = await convertMarkdownToDocx(finalMarkdown, opts.pandocUrl);
    opts.onProgress?.('Đang chuẩn hóa font cho Word...');
    const processed = await postprocessPandocDocx(blob);
    return { blob: processed, filename: `${safeName}_equation.docx`, converted: 0, failed: 0 };
  }
  opts.onProgress?.('Đang gọi MathType chuyển công thức → OLE...');
  const result = await convertMarkdownToMathTypeDocx(finalMarkdown, opts.mathTypeUrl);
  return { blob: result.blob, filename: `${safeName}_mathtype.docx`, converted: result.converted, failed: result.failed };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/export/export-service.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/export/pandoc.ts src/lib/export/mathtype.ts src/lib/export/export-service.ts src/lib/export/export-service.test.ts
git commit -m "feat: export service (pandoc OMML + mathtype OLE orchestration)"
```

---

### Task 11: Markdown preview renderer (safe HTML + KaTeX)

**Files:**
- Create: `src/lib/preview/md-html.ts`
- Test: `src/lib/preview/md-html.test.ts`

**Interfaces:**
- Produces: `renderMarkdownPreview(md, opts?: { maxChars?: number; images?: Map<string, string> }): { html: string; truncated: boolean }`.

- [ ] **Step 1: Write the failing test**

`src/lib/preview/md-html.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderMarkdownPreview } from './md-html';

describe('renderMarkdownPreview', () => {
  it('renders headings, bold, italic and paragraphs', () => {
    const { html } = renderMarkdownPreview('# Tiêu đề\n\nĐoạn **đậm** và *nghiêng*.');
    expect(html).toContain('<h1>Tiêu đề</h1>');
    expect(html).toContain('<strong>đậm</strong>');
    expect(html).toContain('<em>nghiêng</em>');
  });

  it('renders inline and block math with katex classes', () => {
    const { html } = renderMarkdownPreview('Inline $x^2$ và\n\n$$\\frac{1}{2}$$\n');
    expect(html).toContain('katex');
    expect(html.match(/katex/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders pipe tables as <table>', () => {
    const { html } = renderMarkdownPreview('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('renders data-uri images and page markers', () => {
    const { html } = renderMarkdownPreview('<!-- Trang 1 -->\n\n![pic](data:image/png;base64,AAA)\n');
    expect(html).toContain('Trang 1');
    expect(html).toContain('src="data:image/png;base64,AAA"');
  });

  it('substitutes cut images and shows unresolved markers as badges', () => {
    const md = '[[IMAGE:1,200,120,700,650|Hình]]';
    const images = new Map([['1:200,120,700,650', 'data:image/png;base64,BBB']]);
    expect(renderMarkdownPreview(md, { images }).html).toContain('data:image/png;base64,BBB');
    expect(renderMarkdownPreview(md).html).toContain('[[IMAGE:1,200,120,700,650|Hình]]');
  });

  it('escapes raw HTML and truncates large content', () => {
    const { html } = renderMarkdownPreview('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const long = 'a'.repeat(5000);
    const result = renderMarkdownPreview(long, { maxChars: 1000 });
    expect(result.truncated).toBe(true);
  });

  it('preserves sub-question labels a) b) and A. B.', () => {
    const { html } = renderMarkdownPreview('a) Ý đầu\nb) Ý hai\n');
    expect(html).toContain('a)');
    expect(html).toContain('b)');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/preview/md-html.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/preview/md-html.ts`:

```ts
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

  html = html.replace(/\[\[IMAGE\s*:\s*(\d+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:\|\s*([^\]]*?))?\]\]/gi, (raw, page: string, x1: string, y1: string, x2: string, y2: string, caption: string) => {
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
```

Note on inline math stashing: katex output contains `$`? No — KaTeX HTML has no `$`, but it does contain `&lt;`-free entities, fine. However — order matters: block math before inline; and `$` inside escaped text is fine. One subtle bug: stashing inline math BEFORE escaping means the token string `\u0000N\u0000` survives escaping (no HTML chars) — good. And after `escapeHtml`, tokens' contents (KaTeX HTML) are NOT escaped — good, they're injected raw at restore. KaTeX output is safe HTML (SVG/span from trusted source). OK.

But careful: `inlineFormat` applied after escaping — `**đậm**` becomes `<strong>` on escaped text — safe since content is already escaped.

One more issue: the bold regex on escaped text containing `&amp;` etc. — fine.

The `$x^2$` inline test: `'Inline $x^2$ và'` — the inline math regex `/\$(?!\s)(?:\\.|[^$\n])+?\$/g` matches `$x^2$` — good. `'$$\\frac{1}{2}$$'` — block first. Good.

Also the a) b) test: lines `a) Ý đầu` — not list-matching (my list regexes are `- * +` and `\d+[.)]`), so they land in a paragraph with `<p>` containing `a)` — test just checks `a)` present. Good.

The page marker test expects 'Trang 1' — the page-mark div contains it. Good.

The image marker test: unresolved → `[[IMAGE:1,200,120,700,650|Hình]]` — escaped: `[[IMAGE:1,200,120,700,650|Hình]]` — no HTML chars, stays. Good.

`<script>` test: escaped → `&lt;script&gt;` — then inlineFormat on it — no effect. Good.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/preview/md-html.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/preview/md-html.ts src/lib/preview/md-html.test.ts
git commit -m "feat: markdown preview renderer with katex, tables, figures"
```

---

### Task 12: Settings store (localStorage persistence + validation)

**Files:**
- Create: `src/lib/settings-store.ts`
- Test: `src/lib/settings-store.test.ts`

**Interfaces:**
- Produces: `ProviderMode = 'gemini' | 'openai'`, `Settings` interface, `GEMINI_MODELS: string[]`, `RENDER_SCALE_OPTIONS`, `DEFAULT_SETTINGS`, `parseSettings(raw: unknown): Settings`, `serializeSettings(s): string`, `loadSettings(storage): Settings`, `saveSettings(storage, s): void`.

- [ ] **Step 1: Write the failing test**

`src/lib/settings-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, parseSettings, serializeSettings, loadSettings, saveSettings, type Settings,
} from './settings-store';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

describe('parseSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and filters empty keys', () => {
    const s = parseSettings({
      provider: 'openai', geminiKeys: ['a', '', ' ', 'b'], openaiKeys: 'not-array',
      openaiBaseUrl: 'https://x.test/v1', openaiModel: 'custom', geminiModel: 'gemini-3.6-flash',
      maxPages: 10, renderScale: '3', extraPrompt: 'giữ nguyên', baseName: 'De_2026',
    });
    expect(s.provider).toBe('openai');
    expect(s.geminiKeys).toEqual(['a', 'b']);
    expect(s.openaiKeys).toEqual([]);
    expect(s.openaiBaseUrl).toBe('https://x.test/v1');
    expect(s.geminiModel).toBe('gemini-3.6-flash');
    expect(s.maxPages).toBe(10);
    expect(s.renderScale).toBe('3');
    expect(s.baseName).toBe('De_2026');
  });

  it('clamps numbers and falls back invalid enums', () => {
    const s = parseSettings({ provider: 'xyz', maxPages: -5, renderScale: '9', openaiMaxTokens: 'abc' });
    expect(s.provider).toBe('gemini');
    expect(s.maxPages).toBe(1);
    expect(s.renderScale).toBe('2');
    expect(s.openaiMaxTokens).toBeNull();
  });
});

describe('load/save roundtrip', () => {
  it('saves and loads settings', () => {
    const storage = memoryStorage();
    const s: Settings = { ...DEFAULT_SETTINGS, provider: 'openai', openaiKeys: ['sk-x'], baseName: 'Bai_1' };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toMatchObject({ provider: 'openai', openaiKeys: ['sk-x'], baseName: 'Bai_1' });
  });

  it('loads defaults when storage is empty or corrupt', () => {
    const storage = memoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    storage.setItem('aiomt_settings_v1', '{broken');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('serializeSettings is JSON', () => {
    expect(JSON.parse(serializeSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/settings-store.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementation**

`src/lib/settings-store.ts`:

```ts
export type ProviderMode = 'gemini' | 'openai';

export interface Settings {
  provider: ProviderMode;
  geminiKeys: string[];
  openaiKeys: string[];
  openaiBaseUrl: string;
  openaiModel: string;
  openaiMaxTokens: number | null;
  geminiModel: string;
  maxPages: number;
  renderScale: string;
  extraPrompt: string;
  baseName: string;
}

export const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  geminiKeys: [],
  openaiKeys: [],
  openaiBaseUrl: '',
  openaiModel: 'gpt-4o',
  openaiMaxTokens: null,
  geminiModel: 'gemini-3.5-flash',
  maxPages: 30,
  renderScale: '2',
  extraPrompt: '',
  baseName: 'tai_lieu_ocr',
};

export const STORAGE_KEY = 'aiomt_settings_v1';

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function asNumber(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback;
}

export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;
  const provider: ProviderMode = o.provider === 'openai' ? 'openai' : 'gemini';
  const maxPages = asNumber(o.maxPages, DEFAULT_SETTINGS.maxPages, 1, 200);
  const renderScale = ['1.5', '2', '2.5', '3'].includes(String(o.renderScale)) ? String(o.renderScale) : '2';
  const maxTokensRaw = o.openaiMaxTokens === '' || o.openaiMaxTokens === null || o.openaiMaxTokens === undefined
    ? null
    : asNumber(o.openaiMaxTokens, 0, 0, 1_000_000) || null;
  return {
    provider,
    geminiKeys: asStringArray(o.geminiKeys),
    openaiKeys: asStringArray(o.openaiKeys),
    openaiBaseUrl: asString(o.openaiBaseUrl, ''),
    openaiModel: asString(o.openaiModel, DEFAULT_SETTINGS.openaiModel),
    openaiMaxTokens: maxTokensRaw,
    geminiModel: asString(o.geminiModel, DEFAULT_SETTINGS.geminiModel),
    maxPages,
    renderScale,
    extraPrompt: typeof o.extraPrompt === 'string' ? o.extraPrompt : '',
    baseName: asString(o.baseName, DEFAULT_SETTINGS.baseName),
  };
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'>, s: Settings): void {
  try {
    storage.setItem(STORAGE_KEY, serializeSettings(s));
  } catch {
    // localStorage đầy hoặc bị chặn — bỏ qua, app vẫn chạy với state hiện tại.
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/settings-store.test.ts`

Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings-store.ts src/lib/settings-store.test.ts
git commit -m "feat: settings store with localStorage persistence and validation"
```

---

### Task 13: Jobs service (Supabase storage + retention)

**Files:**
- Create: `src/lib/supabase-server.ts`, `src/lib/jobs.ts`
- Test: `src/lib/jobs.test.ts`

**Interfaces:**
- Produces: `getSupabaseAdmin()` (server-only; reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`), `JobsService` with `issueUploadUrls(jobId, blobs, bucket)`, `finalize(jobId, fileName, blob)`, `getDownloadUrl(jobId, fileName, bucket?)`, `deleteTempImages(jobId)`, `cleanupOld(now, maxAgeMs)`, `splitKey(key)`. Uses dependency injection (Supabase client + clock) so tests don't hit the network.

- [ ] **Step 1: Write the failing test**

`src/lib/jobs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { JobsService, splitKey } from './jobs';

type UploadFn = (path: string, file: Blob, opts?: Record<string, unknown>) => Promise<{ path: string }>;
type SignedFn = (path: string, expires: number) => Promise<{ data: { signedUrl: string }; error: null }>;
type ListFn = (path: string, opts?: Record<string, unknown>) => Promise<{ data: unknown[]; error: null }>;
type RemoveFn = (paths: string[]) => Promise<{ data: unknown; error: null }>;

function fakeStorage(opts: { upload: UploadFn; createSignedUrl: SignedFn; list: ListFn; remove: RemoveFn }) {
  return {
    from: () => ({
      upload: opts.upload,
      createSignedUrl: opts.createSignedUrl,
      list: opts.list,
      remove: opts.remove,
    }),
  };
}

describe('splitKey', () => {
  it('returns ["temp-images", key] for temp image keys', () => {
    expect(splitKey('temp-images/j-abc/p1.png')).toEqual(['temp-images', 'j-abc/p1.png']);
  });
  it('returns ["word-exports", key] for word export keys', () => {
    expect(splitKey('word-exports/j-abc/file.docx')).toEqual(['word-exports', 'j-abc/file.docx']);
  });
});

describe('JobsService', () => {
  const now = new Date('2026-08-26T00:00:00Z').getTime();
  const fixedClock = () => now;

  it('issueUploadUrls uploads blobs and returns signed URLs', async () => {
    const uploaded: string[] = [];
    const storage = fakeStorage({
      upload: async (path) => { uploaded.push(path); return { path }; },
      createSignedUrl: async (path, _expires) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: null, error: null }),
    });
    const svc = new JobsService(storage as never, fixedClock);
    const blobs = [new Blob(['a'], { type: 'image/png' }), new Blob(['b'], { type: 'image/png' })];
    const urls = await svc.issueUploadUrls('j-1', blobs, 'temp-images');
    expect(uploaded).toEqual(['j-1/0.png', 'j-1/1.png']);
    expect(urls).toEqual(['https://signed/test/j-1/0.png', 'https://signed/test/j-1/1.png']);
  });

  it('finalize uploads to word-exports and returns a signed download URL', async () => {
    let uploadedPath = '';
    const storage = fakeStorage({
      upload: async (path) => { uploadedPath = path; return { path }; },
      createSignedUrl: async (path, expires) => ({ data: { signedUrl: `https://d.test/${path}?ex=${expires}` }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: null, error: null }),
    });
    const svc = new JobsService(storage as never, fixedClock);
    const url = await svc.finalize('j-2', 'file.docx', new Blob(['PK'], { type: 'application/octet-stream' }));
    expect(uploadedPath).toBe('j-2/file.docx');
    expect(url).toContain('https://d.test/j-2/file.docx');
  });

  it('deleteTempImages lists and removes all files under the job folder', async () => {
    const removed: string[] = [];
    const storage = fakeStorage({
      upload: async () => ({ path: '' }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async () => ({ data: [{ name: 'p0.png' }, { name: 'p1.png' }], error: null }),
      remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
    });
    const svc = new JobsService(storage as never, fixedClock);
    await svc.deleteTempImages('j-3');
    expect(removed).toEqual(['j-3/p0.png', 'j-3/p1.png']);
  });

  it('cleanupOld removes job folders older than maxAge', async () => {
    const oldTs = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();
    const youngTs = new Date(now - 1 * 60 * 60 * 1000).toISOString();
    const removed: string[] = [];
    const storage = fakeStorage({
      upload: async () => ({ path: '' }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async (path) => ({
        data: path === ''
          ? [{ name: 'j-old', updated_at: oldTs }, { name: 'j-young', updated_at: youngTs }]
          : [{ name: 'file.docx', updated_at: oldTs }],
        error: null,
      }),
      remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
    });
    const svc = new JobsService(storage as never, fixedClock);
    const count = await svc.cleanupOld(now, 3 * 24 * 60 * 60 * 1000);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(removed.some((p) => p.startsWith('j-old'))).toBe(true);
    expect(removed.some((p) => p.startsWith('j-young'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/jobs.test.ts`

Expected: FAIL — module missing.

- [ ] **Step 3: Write the implementations**

`src/lib/supabase-server.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY ở biến môi trường server.');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
```

`src/lib/jobs.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export const SIGNED_URL_TTL = 3 * 24 * 60 * 60; // 3 ngày (giây)

export function splitKey(key: string): [string, string] {
  const slash = key.indexOf('/');
  return slash >= 0 ? [key.slice(0, slash), key.slice(slash + 1)] : ['', key];
}

export class JobsService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issueUploadUrls(jobId: string, blobs: Blob[], bucket: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const path = `${jobId}/${i}.png`;
      const { error } = await this.supabase.storage.from(bucket).upload(path, blobs[i], {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) throw new Error(`Upload ảnh thất bại (${path}): ${error.message}`);
      const signed = await this.supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
      if (signed.error || !signed.data?.signedUrl) throw new Error(`Không tạo được signed URL (${path}).`);
      out.push(signed.data.signedUrl);
    }
    return out;
  }

  async finalize(jobId: string, fileName: string, blob: Blob): Promise<string> {
    const path = `${jobId}/${fileName}`;
    const { error } = await this.supabase.storage.from('word-exports').upload(path, blob, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    });
    if (error) throw new Error(`Lưu Word thất bại (${path}): ${error.message}`);
    const signed = await this.supabase.storage.from('word-exports').createSignedUrl(path, SIGNED_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error('Không tạo được signed URL tải Word.');
    return signed.data.signedUrl;
  }

  async getDownloadUrl(jobId: string, fileName: string, bucket = 'word-exports'): Promise<string> {
    const signed = await this.supabase.storage.from(bucket).createSignedUrl(`${jobId}/${fileName}`, SIGNED_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error('File Word đã hết hạn hoặc không tồn tại.');
    return signed.data.signedUrl;
  }

  async deleteTempImages(jobId: string): Promise<void> {
    const bucket = this.supabase.storage.from('temp-images');
    const list = await bucket.list(jobId);
    if (list.error) throw new Error(`Không liệt kê được temp-images (${jobId}).`);
    const paths = (list.data ?? []).map((f) => `${jobId}/${f.name}`);
    if (paths.length === 0) return;
    const { error } = await bucket.remove(paths);
    if (error) throw new Error(`Không xóa được temp-images (${jobId}): ${error.message}`);
  }

  async cleanupOld(now: number, maxAgeMs: number): Promise<number> {
    const cutoff = new Date(now - maxAgeMs);
    let removed = 0;
    for (const bucketName of ['temp-images', 'word-exports']) {
      const storage = this.supabase.storage.from(bucketName);
      const folders = await storage.list('');
      if (folders.error) continue;
      for (const folder of folders.data ?? []) {
        const updated = folder.updated_at ? new Date(folder.updated_at) : new Date(0);
        if (updated >= cutoff) continue;
        const files = await storage.list(folder.name);
        if (files.error) continue;
        const paths = (files.data ?? []).map((f) => `${folder.name}/${f.name}`);
        if (paths.length > 0) {
          const { error } = await storage.remove(paths);
          if (!error) removed += paths.length;
        }
      }
    }
    return removed;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/jobs.test.ts`

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase-server.ts src/lib/jobs.ts src/lib/jobs.test.ts
git commit -m "feat: jobs service (supabase upload, signed urls, retention cleanup)"
```

---

### Task 14: API routes (Next 15 App Router, server-only)

**Files:**
- Create: `src/app/api/config/route.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[id]/upload-urls/route.ts`, `src/app/api/jobs/[id]/finalize/route.ts`, `src/app/api/jobs/[id]/route.ts`, `src/app/api/cleanup/route.ts`

**Endpoints:**
- `GET /api/config` → `{ pandocUrl, mathTypeUrl, maxUploadBytes }` (public, from env).
- `POST /api/jobs` → `{ jobId }` (generates `j-<id>`).
- `POST /api/jobs/[id]/upload-urls` (multipart `images[]`) → `{ urls: string[] }` (uploads temp images, returns signed URLs).
- `POST /api/jobs/[id]/finalize` (multipart `file` + `fileName`) → `{ url, fileName }` (saves Word, deletes temp images).
- `GET /api/jobs/[id]?fileName=...` → `{ url }` (fresh signed URL).
- `POST /api/cleanup` (header `x-cron-secret`) → `{ removed }` (cron retention sweep).

- [ ] **Step 1: Write the route implementations**

`src/app/api/config/route.ts`:

```ts
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    pandocUrl: process.env.PANDOC_URL || 'https://pandoc-server.onrender.com/convert',
    mathTypeUrl: process.env.MATHTYPE_URL || 'https://latex2mathtypeweb.onrender.com',
    maxUploadBytes: 18 * 1024 * 1024,
  });
}
```

`src/app/api/jobs/route.ts`:

```ts
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const jobId = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return NextResponse.json({ jobId });
}
```

`src/app/api/jobs/[id]/upload-urls/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const form = await req.formData();
  const files = form.getAll('images[]');
  if (files.length === 0) return NextResponse.json({ error: 'Không có ảnh để upload.' }, { status: 400 });
  const blobs = files
    .filter((f): f is File => f instanceof File)
    .map((f) => new Blob([f.stream()], { type: f.type || 'image/png' }));
  try {
    const svc = new JobsService(getSupabaseAdmin());
    const urls = await svc.issueUploadUrls(jobId, blobs, 'temp-images');
    return NextResponse.json({ urls });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

`src/app/api/jobs/[id]/finalize/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const form = await req.formData();
  const file = form.get('file');
  const fileName = (form.get('fileName') as string) || 'export.docx';
  if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
  const blob = new Blob([await file.arrayBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const svc = new JobsService(getSupabaseAdmin());
  try {
    const url = await svc.finalize(jobId, fileName, blob);
    await svc.deleteTempImages(jobId);
    return NextResponse.json({ url, fileName });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
```

`src/app/api/jobs/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const fileName = req.nextUrl.searchParams.get('fileName');
  if (!fileName) return NextResponse.json({ error: 'Thiếu fileName.' }, { status: 400 });
  try {
    const svc = new JobsService(getSupabaseAdmin());
    const url = await svc.getDownloadUrl(jobId, fileName);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
```

`src/app/api/cleanup/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const svc = new JobsService(getSupabaseAdmin());
  const removed = await svc.cleanupOld(Date.now(), 3 * 24 * 60 * 60 * 1000);
  return NextResponse.json({ removed });
}
```

- [ ] **Step 2: Type-check the routes**

Run: `npx tsc --noEmit`

Expected: PASS (no errors). The `params: Promise<{id}>` signature matches Next 15. `req.nextUrl` is available on `NextRequest`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api
git commit -m "feat: api routes (config, jobs, upload-urls, finalize, download, cleanup cron)"
```

---

### Task 15: UI shell — SetupPanel, KeysEditor, Dropzone, StatsBar

**Files:**
- Create: `src/components/SetupPanel.tsx`, `src/components/KeysEditor.tsx`, `src/components/Dropzone.tsx`, `src/components/StatsBar.tsx`, `src/hooks/useSettings.ts`
- Update: `src/app/page.tsx` (full client shell)

**Interfaces:**
- `useSettings()` hook: `{ settings, setSettings, update(partial) }` backed by `loadSettings`/`saveSettings`.
- `SetupPanel`: renders provider toggle, model select, keys editor, base URL, max pages, render scale, extra prompt, base name.
- `KeysEditor`: textarea (one key per line) → string[].
- `Dropzone`: drag-and-drop + click → `File` (PDF only).
- `StatsBar`: shows character count, page count, formula count, image count.

- [ ] **Step 1: Write the hooks and components**

`src/hooks/useSettings.ts`:

```ts
'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings-store';

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettingsState(loadSettings(localStorage));
  }, []);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(localStorage, s);
  }, []);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(localStorage, next);
      return next;
    });
  }, []);

  return { settings, setSettings, update };
}
```

`src/components/KeysEditor.tsx`:

```tsx
'use client';

interface Props {
  label: string;
  keys: string[];
  placeholder?: string;
  onChange: (keys: string[]) => void;
}

export function KeysEditor({ label, keys, placeholder, onChange }: Props) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea
        className="keys-textarea"
        value={keys.join('\n')}
        placeholder={placeholder ?? 'Một key mỗi dòng'}
        rows={4}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.split('\n').map((k) => k.trim()).filter(Boolean))}
      />
      <span className="field-hint">{keys.length} key</span>
    </label>
  );
}
```

`src/components/Dropzone.tsx`:

```tsx
'use client';
import { useRef, useState } from 'react';

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function Dropzone({ onFile, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`dropzone${dragging ? ' dropzone--over' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (disabled) return;
        const f = e.dataTransfer.files[0];
        if (f && f.type === 'application/pdf') onFile(f);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }}
      />
      <span>Kéo thả file PDF vào đây, hoặc nhấn để chọn.</span>
    </div>
  );
}
```

`src/components/StatsBar.tsx`:

```tsx
'use client';

interface Props {
  characters: number;
  pages: number;
  formulas: number;
  images: number;
}

export function StatsBar({ characters, pages, formulas, images }: Props) {
  const fmt = (n: number) => n.toLocaleString('vi-VN');
  return (
    <div className="stats-bar">
      <span title="Kí tự"><b>{fmt(characters)}</b> kí tự</span>
      <span title="Trang"><b>{fmt(pages)}</b> trang</span>
      <span title="Công thức"><b>{fmt(formulas)}</b> công thức</span>
      <span title="Ảnh"><b>{fmt(images)}</b> ảnh</span>
    </div>
  );
}
```

`src/components/SetupPanel.tsx`:

```tsx
'use client';
import { GEMINI_MODELS, type Settings } from '@/lib/settings-store';
import { KeysEditor } from './KeysEditor';

interface Props {
  settings: Settings;
  update: (partial: Partial<Settings>) => void;
}

export function SetupPanel({ settings, update }: Props) {
  return (
    <section className="panel setup-panel">
      <h2>Cấu hình</h2>
      <div className="provider-toggle">
        <button
          type="button"
          className={settings.provider === 'gemini' ? 'active' : ''}
          onClick={() => update({ provider: 'gemini' })}
        >Gemini API</button>
        <button
          type="button"
          className={settings.provider === 'openai' ? 'active' : ''}
          onClick={() => update({ provider: 'openai' })}
        >OpenAI Completions</button>
      </div>

      {settings.provider === 'gemini' ? (
        <>
          <KeysEditor
            label="Gemini API Keys"
            keys={settings.geminiKeys}
            placeholder="AIza... mỗi dòng một key"
            onChange={(geminiKeys) => update({ geminiKeys })}
          />
          <label className="field">
            <span className="field-label">Model</span>
            <select value={settings.geminiModel} onChange={(e) => update({ geminiModel: e.target.value })}>
              {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </>
      ) : (
        <>
          <KeysEditor
            label="OpenAI API Keys"
            keys={settings.openaiKeys}
            placeholder="sk-... mỗi dòng một key"
            onChange={(openaiKeys) => update({ openaiKeys })}
          />
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              type="url"
              value={settings.openaiBaseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => update({ openaiBaseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input
              type="text"
              value={settings.openaiModel}
              placeholder="gpt-4o"
              onChange={(e) => update({ openaiModel: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Max tokens (tùy chọn)</span>
            <input
              type="number"
              min={0}
              value={settings.openaiMaxTokens ?? ''}
              placeholder="để trống = mặc định"
              onChange={(e) => update({ openaiMaxTokens: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </>
      )}

      <label className="field">
        <span className="field-label">Số trang tối đa</span>
        <input
          type="number"
          min={1}
          max={200}
          value={settings.maxPages}
          onChange={(e) => update({ maxPages: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span className="field-label">Độ phân giải render</span>
        <select value={settings.renderScale} onChange={(e) => update({ renderScale: e.target.value })}>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
          <option value="2.5">2.5x</option>
          <option value="3">3x</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Hướng dẫn thêm (tùy chọn)</span>
        <textarea
          rows={3}
          value={settings.extraPrompt}
          placeholder="Bổ sung yêu cầu cho mô hình..."
          onChange={(e) => update({ extraPrompt: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">Tên file xuất</span>
        <input
          type="text"
          value={settings.baseName}
          onChange={(e) => update({ baseName: e.target.value })}
        />
      </label>
    </section>
  );
}
```

`src/app/page.tsx` (shell — flows wired in Task 16):

```tsx
'use client';
import { useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { SetupPanel } from '@/components/SetupPanel';
import { Dropzone } from '@/components/Dropzone';
import { StatsBar } from '@/components/StatsBar';

export default function Home() {
  const { settings, update } = useSettings();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

  return (
    <main className="app">
      <header className="app-header">
        <h1>OCR PDF → Word</h1>
        <p className="subtitle">Gemini / OpenAI · Pandoc · MathType · Supabase</p>
      </header>
      <div className="layout">
        <SetupPanel settings={settings} update={update} />
        <section className="panel work-panel">
          <h2>Tài liệu</h2>
          <Dropzone onFile={setPdfFile} disabled={busy} />
          {pdfFile && <p className="file-name">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
          <StatsBar characters={0} pages={0} formulas={0} images={0} />
          <p className="status">{status}</p>
          {/* Flows wired in Task 16: OCR run, cut+stage, export */}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify the app compiles and renders**

Run: `npx next build`

Expected: build succeeds. (Server components compile; the `'use client'` shell renders.)

Dev smoke: `npx next dev` → open `http://localhost:3000` → SetupPanel + Dropzone visible, keys persist on reload.

- [ ] **Step 3: Commit**

```bash
git add src/components src/hooks src/app/page.tsx
git commit -m "feat: ui shell (setup panel, keys editor, dropzone, stats bar, settings hook)"
```

---

### Task 16: UI flows — OCR run, cut + stage, export + finalize

**Files:**
- Create: `src/components/EditorPane.tsx`, `src/components/PreviewPane.tsx`, `src/components/ExportMenu.tsx`, `src/lib/orchestrate.ts`
- Update: `src/app/page.tsx` (wire flows)

**Interfaces:**
- `orchestrate.ts`: `runOcrGemini(file, settings, onProgress): Promise<string>`, `runOcrOpenAI(file, settings, onProgress): Promise<{ markdown, pageImages }>` (renders PDF, sends pages), `stageImages(markdown, pageImages): Promise<{ images: Map, count }>` (cuts each marker from its page, returns data-URL map keyed by `markerKey`).
- `EditorPane`: editable textarea bound to `markdown` state.
- `PreviewPane`: renders `renderMarkdownPreview` HTML via `dangerouslySetInnerHTML` (output is sanitized by the renderer).
- `ExportMenu`: two buttons (Equation / MathType); calls `exportWord`, uploads via `/api/jobs/[id]/finalize`, falls back to browser download on server failure.

- [ ] **Step 1: Write the orchestration helpers**

`src/lib/orchestrate.ts`:

```ts
import { arrayBufferToBase64 } from './base64';
import { renderPdfToImages, computeRenderScale } from './pdf/render-pages';
import { ocrPdfWithGemini } from './providers/gemini';
import { ocrImagesWithOpenAI } from './providers/openai';
import { parseImageMarkers } from './markdown/markers';
import { markerToPixelRect, cutImageFromDataUrl, getImageDimensions } from './pdf/cut-image';
import type { Settings } from './settings-store';
import { markerKey } from './markdown/build-markdown';

export type OcrProgress = (msg: string) => void;

export async function runOcrGemini(file: File, settings: Settings, onProgress: OcrProgress): Promise<string> {
  onProgress('Đang đọc PDF...');
  const pdfBase64 = arrayBufferToBase64(await file.arrayBuffer());
  onProgress(`Đang OCR ${settings.geminiModel}...`);
  return ocrPdfWithGemini({
    pdfBase64,
    keys: settings.geminiKeys,
    model: settings.geminiModel,
    extraPrompt: settings.extraPrompt,
    onProgress,
    onRotated: ({ attempts }) => onProgress(`Rate-limited — chuyển key (lần ${attempts})...`),
  });
}

export async function runOcrOpenAI(
  file: File,
  settings: Settings,
  onProgress: OcrProgress,
): Promise<{ markdown: string; pageImages: { pageNumber: number; dataUrl: string }[] }> {
  onProgress('Đang render PDF thành ảnh...');
  const scale = computeRenderScale(settings.renderScale);
  const pages = await renderPdfToImages(await file.arrayBuffer(), {
    scale,
    maxPages: settings.maxPages,
    onProgress: (done, total) => onProgress(`Render trang ${done}/${total}...`),
  });
  const pageImages = pages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }));
  onProgress(`Đang OCR ${pageImages.length} trang với ${settings.openaiModel}...`);
  const markdown = await ocrImagesWithOpenAI({
    pageImages: pageImages.map((p) => p.dataUrl),
    keys: settings.openaiKeys,
    baseUrl: settings.openaiBaseUrl,
    model: settings.openaiModel,
    maxTokens: settings.openaiMaxTokens ?? undefined,
    extraPrompt: settings.extraPrompt,
    onProgress,
    onRotated: ({ attempts }) => onProgress(`Rate-limited — chuyển key (lần ${attempts})...`),
  });
  return { markdown, pageImages };
}

export async function stageImages(
  markdown: string,
  pageImages: { pageNumber: number; dataUrl: string }[],
): Promise<{ images: Map<string, string>; count: number }> {
  const markers = parseImageMarkers(markdown);
  const images = new Map<string, string>();
  for (const m of markers) {
    const page = pageImages.find((p) => p.pageNumber === m.page);
    if (!page) continue;
    const dims = await getImageDimensions(page.dataUrl);
    const rect = markerToPixelRect(m, dims.width, dims.height);
    const url = await cutImageFromDataUrl(page.dataUrl, rect);
    images.set(markerKey(m), url);
  }
  return { images, count: images.size };
}
```

`src/components/PreviewPane.tsx`:

```tsx
'use client';
import { useMemo } from 'react';
import { renderMarkdownPreview } from '@/lib/preview/md-html';

interface Props {
  markdown: string;
  images: Map<string, string>;
}

export function PreviewPane({ markdown, images }: Props) {
  const { html, truncated } = useMemo(() => renderMarkdownPreview(markdown, { images }), [markdown, images]);
  return (
    <div className="preview-pane">
      {truncated && <div className="truncation-note">Nội dung dài — đang xem trước 300K kí tự đầu.</div>}
      <div className="preview-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
```

`src/components/EditorPane.tsx`:

```tsx
'use client';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function EditorPane({ value, onChange }: Props) {
  return (
    <div className="editor-pane">
      <textarea
        className="editor-textarea"
        value={value}
        spellCheck={false}
        placeholder="Markdown OCR sẽ xuất hiện ở đây. Bạn có thể sửa trước khi xuất."
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
```

`src/components/ExportMenu.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { exportWord, type ExportMode } from '@/lib/export/export-service';

interface Props {
  markdown: string;
  images: Map<string, string>;
  baseName: string;
  pandocUrl: string;
  mathTypeUrl: string;
  onStatus: (msg: string) => void;
}

export function ExportMenu({ markdown, images, baseName, pandocUrl, mathTypeUrl, onStatus }: Props) {
  const [busy, setBusy] = useState(false);

  async function doExport(mode: ExportMode) {
    setBusy(true);
    try {
      onStatus(`Đang xuất Word (${mode})...`);
      const { blob, filename, converted, failed } = await exportWord({
        markdown, images, mode, baseName, pandocUrl, mathTypeUrl, onProgress: onStatus,
      });

      let saved = false;
      try {
        onStatus('Đang lưu lên server (3 ngày)...');
        const form = new FormData();
        form.append('file', blob, filename);
        form.append('fileName', filename);
        const createJob = await fetch('/api/jobs', { method: 'POST' });
        if (createJob.ok) {
          const { jobId } = await createJob.json();
          const finalizeRes = await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST', body: form });
          if (finalizeRes.ok) {
            const { url } = await finalizeRes.json();
            onStatus(`Đã lưu. Tải trong 3 ngày: ${url}`);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            saved = true;
          }
        }
      } catch (err) {
        onStatus(`Lưu server thất bại — tải trực tiếp. (${(err as Error).message})`);
      }

      if (!saved) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        onStatus(`Đã tải ${filename}${mode === 'mathtype' ? ` (${converted} thành công, ${failed} lỗi)` : ''}.`);
      }
    } catch (err) {
      onStatus(`Xuất thất bại: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="export-menu">
      <button type="button" disabled={busy || !markdown.trim()} onClick={() => doExport('equation')}>
        Xuất Word (Equation / OMML)
      </button>
      <button type="button" disabled={busy || !markdown.trim()} onClick={() => doExport('mathtype')}>
        Xuất Word (MathType OLE)
      </button>
    </div>
  );
}
```

Update `src/app/page.tsx` to wire the flows:

```tsx
'use client';
import { useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { SetupPanel } from '@/components/SetupPanel';
import { Dropzone } from '@/components/Dropzone';
import { StatsBar } from '@/components/StatsBar';
import { EditorPane } from '@/components/EditorPane';
import { PreviewPane } from '@/components/PreviewPane';
import { ExportMenu } from '@/components/ExportMenu';
import { runOcrGemini, runOcrOpenAI, stageImages } from '@/lib/orchestrate';
import { countCharacters, countPages, countFormulas, countDataUriImages, parseImageMarkers } from '@/lib/markdown/markers';
import { renderPdfToImages, computeRenderScale } from '@/lib/pdf/render-pages';

export default function Home() {
  const { settings, update } = useSettings();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pandocUrl, setPandocUrl] = useState('https://pandoc-server.onrender.com/convert');
  const [mathTypeUrl, setMathTypeUrl] = useState('https://latex2mathtypeweb.onrender.com');

  // Fetch runtime config once on mount
  useState(() => {
    fetch('/api/config').then((r) => r.json()).then((c) => {
      if (c.pandocUrl) setPandocUrl(c.pandocUrl);
      if (c.mathTypeUrl) setMathTypeUrl(c.mathTypeUrl);
    }).catch(() => {});
  });

  const markers = parseImageMarkers(markdown);
  const stats = {
    characters: countCharacters(markdown),
    pages: countPages(markdown),
    formulas: countFormulas(markdown),
    images: countDataUriImages(markdown) + markers.length,
  };

  async function runOcr() {
    if (!pdfFile) return;
    if (settings.provider === 'gemini' && settings.geminiKeys.length === 0) { setStatus('Nhập ít nhất một Gemini API key.'); return; }
    if (settings.provider === 'openai' && settings.openaiKeys.length === 0) { setStatus('Nhập ít nhất một OpenAI API key.'); return; }
    setBusy(true); setStatus('');
    try {
      let md: string;
      let pageImages: { pageNumber: number; dataUrl: string }[] = [];
      if (settings.provider === 'gemini') {
        md = await runOcrGemini(pdfFile, settings, setStatus);
      } else {
        const r = await runOcrOpenAI(pdfFile, settings, setStatus);
        md = r.markdown; pageImages = r.pageImages;
      }
      setMarkdown(md);
      const ms = parseImageMarkers(md);
      if (ms.length > 0) {
        if (pageImages.length === 0 && settings.provider === 'gemini') {
          const pages = await renderPdfToImages(await pdfFile.arrayBuffer(), {
            scale: computeRenderScale(settings.renderScale),
            maxPages: settings.maxPages,
          });
          pageImages = pages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }));
        }
        setStatus(`Đang cắt ${ms.length} ảnh từ ${pageImages.length} trang...`);
        const { images: staged } = await stageImages(md, pageImages);
        setImages(staged);
      }
      setStatus('OCR hoàn tất.');
    } catch (err) {
      setStatus(`Lỗi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>OCR PDF → Word</h1>
        <p className="subtitle">Gemini / OpenAI · Pandoc · MathType · Supabase</p>
      </header>
      <div className="layout">
        <SetupPanel settings={settings} update={update} />
        <section className="panel work-panel">
          <h2>Tài liệu</h2>
          <Dropzone onFile={setPdfFile} disabled={busy} />
          {pdfFile && <p className="file-name">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
          <div className="actions">
            <button type="button" disabled={busy || !pdfFile} onClick={runOcr}>{busy ? 'Đang xử lý...' : 'Chạy OCR'}</button>
          </div>
          <StatsBar {...stats} />
          <p className="status">{status}</p>
          {markdown && (
            <>
              <ExportMenu markdown={markdown} images={images} baseName={settings.baseName} pandocUrl={pandocUrl} mathTypeUrl={mathTypeUrl} onStatus={setStatus} />
              <div className="panes">
                <EditorPane value={markdown} onChange={setMarkdown} />
                <PreviewPane markdown={markdown} images={images} />
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build`

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/EditorPane.tsx src/components/PreviewPane.tsx src/components/ExportMenu.tsx src/lib/orchestrate.ts src/app/page.tsx
git commit -m "feat: ui flows (ocr run, cut+stage images, export+finalize+fallback)"
```

---

### Task 17: Supabase setup SQL, Vercel config, README, env

**Files:**
- Create: `supabase/setup.sql`, `vercel.json`, `README.md`, update `.env.example`

- [ ] **Step 1: Write the Supabase setup SQL**

`supabase/setup.sql`:

```sql
-- OCR PDF → Word: Supabase Storage setup
-- Run in Supabase SQL Editor (or via supabase CLI). Safe to re-run.

-- Private buckets: no public access. All access via service-role key (server) + signed URLs.
insert into storage.buckets (id, name, public)
values ('temp-images', 'temp-images', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('word-exports', 'word-exports', false)
on conflict (id) do nothing;

-- RLS: deny all client (anon) access. Server uses service-role key (bypasses RLS).
alter table storage.objects enable row level security;

drop policy if exists "deny_anon_temp_images" on storage.objects;
create policy "deny_anon_temp_images" on storage.objects
  for all using (bucket_id = 'temp-images' and false) with check (bucket_id = 'temp-images' and false);

drop policy if exists "deny_anon_word_exports" on storage.objects;
create policy "deny_anon_word_exports" on storage.objects
  for all using (bucket_id = 'word-exports' and false) with check (bucket_id = 'word-exports' and false);
```

- [ ] **Step 2: Write Vercel config (cron cleanup)**

`vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cleanup", "schedule": "0 3 * * *" }
  ]
}
```

- [ ] **Step 3: Write the README**

`README.md`:

````markdown
# OCR PDF → Word

OCR tài liệu PDF sang Markdown (Gemini hoặc OpenAI-compatible), cắt ảnh hình/khung, xuất Word với công thức OMML (Pandoc) hoặc MathType OLE. File Word lưu trên Supabase 3 ngày.

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Supabase Storage (private buckets, signed URLs)
- pdfjs-dist (render PDF → ảnh), JSZip (post-process docx), KaTeX (preview)
- Pandoc Server (OMML) + MathType Server (OLE) — external Render services

## Setup

### 1. Supabase
1. Tạo project tại supabase.com.
2. SQL Editor → chạy `supabase/setup.sql` (tạo 2 private bucket + RLS deny-all).
3. Settings → API: lấy **Project URL** và **service_role** key.

### 2. Vercel
1. Import repo → Vercel.
2. Environment Variables:
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key
   - `CRON_SECRET` = chuỗi ngẫu nhiên bất kỳ (bảo vệ `/api/cleanup`)
   - `PANDOC_URL` (tùy chọn) = `https://pandoc-server.onrender.com/convert`
   - `MATHTYPE_URL` (tùy chọn) = `https://latex2mathtypeweb.onrender.com`
3. Deploy. Cron dọn dẹp chạy mỗi ngày 03:00.

### 3. Chạy local
```bash
npm install
cp .env.example .env.local   # điền Supabase + CRON_SECRET
npm run dev
```

## Cách dùng
1. Chọn provider (Gemini hoặc OpenAI), dán API keys (mỗi dòng một key — tự rotate khi rate-limit).
2. Kéo thả PDF → "Chạy OCR".
3. Sửa Markdown nếu cần → xem trước KaTeX.
4. "Xuất Word (Equation)" hoặc "Xuất Word (MathType)". File lưu server 3 ngày + tải về máy.

## Lưu trữ
- `temp-images/`: ảnh cắt tạm, xóa sau khi xuất.
- `word-exports/`: file Word, signed URL hết hạn sau 3 ngày, cron xóa file cũ.
````

- [ ] **Step 4: Update .env.example**

`.env.example`:

```bash
# Supabase (server-only)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Cron cleanup secret (set in Vercel env too)
CRON_SECRET=change-me

# External services (optional — defaults built in)
PANDOC_URL=https://pandoc-server.onrender.com/convert
MATHTYPE_URL=https://latex2mathtypeweb.onrender.com
```

- [ ] **Step 5: Commit**

```bash
git add supabase/setup.sql vercel.json README.md .env.example
git commit -m "feat: supabase setup sql, vercel cron, readme, env example"
```

---

### Task 18: E2E verification + hardening checklist

**Files:** No new files. Manual + automated verification.

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`

Expected: All tests PASS (Tasks 2-13: ~40 tests).

- [ ] **Step 2: Type-check the whole project**

Run: `npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npx next build`

Expected: build succeeds, no runtime errors in output.

- [ ] **Step 4: Manual E2E (local with real keys + Supabase)**

Prereq: `.env.local` filled, `npm run dev` running, a Gemini key and an OpenAI-compatible key available.

1. **Gemini path:** drop `Vật lí 10 Trại hè hùng vương 2026.pdf` → provider Gemini → paste key → "Chạy OCR".
   - Verify: Markdown appears with `<!-- Trang N -->`, `$...$` formulas, `[[IMAGE:...]]` markers, headings, tables.
   - Verify: preview renders KaTeX math + figure placeholders/markers.
2. **Image cut:** after OCR, markers replaced with actual cut images in preview.
3. **Export Equation:** click "Xuất Word (Equation)" → `.docx` downloads → open in Word → Times New Roman, OMML formulas render, question labels styled, images embedded.
4. **Export MathType:** click "Xuất Word (MathType)" → `.docx` downloads → open in Word → MathType OLE formulas editable.
5. **OpenAI path:** switch provider → paste key + base URL + model → "Chạy OCR" → verify same Markdown shape.
6. **Key rotation:** use a deliberately-invalid first key + valid second key → verify it rotates and succeeds; check status shows "chuyển key".
7. **Large file:** OCR a >30-page PDF → verify it completes, Markdown > 100K chars, export produces a docx.
8. **Server save + 3-day URL:** export → verify status shows a `supabase.co` signed URL → reload page → file still downloadable via the URL (before 3-day expiry).
9. **Temp cleanup:** after export, check Supabase `temp-images` bucket → job folder empty.
10. **Cleanup cron:** `curl -X POST http://localhost:3000/api/cleanup -H "x-cron-secret: $CRON_SECRET"` → verify old folders removed.

- [ ] **Step 5: Hardening review**

Check each:
- [ ] No `service_role` key in client bundle (search build output for the key string — must be absent).
- [ ] `/api/cleanup` returns 401 without `x-cron-secret`.
- [ ] RLS denies anon: `supabase.storage.from('temp-images').list()` from client → empty/error.
- [ ] No `dangerouslySetInnerHTML` on un-sanitized input — `renderMarkdownPreview` escapes all raw text before token restore; KaTeX output is trusted.
- [ ] PDF worker loads: browser console has no pdfjs worker errors.
- [ ] Error states: OCR with no key → friendly message; export with no markdown → button disabled.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: e2e verification + hardening pass"
```

- [ ] **Step 7: Deploy**

```bash
vercel --prod
```

Verify on the deployed URL: repeat Step 4 steps 1-5 (OCR + export) against the live Vercel + Supabase. Confirm cron visible in Vercel dashboard (Project → Settings → Cron Jobs).

---

## Verification Summary

After all 18 tasks:
- `npx vitest run` → all unit tests pass (key rotation, markers, build-markdown, postprocess, prompt, gemini, openai, pdf helpers, export service, preview, settings, jobs).
- `npx tsc --noEmit` → no type errors.
- `npx next build` → production build succeeds.
- Manual E2E: Gemini + OpenAI OCR, image cut, both export modes, key rotation, large files, server save + 3-day URL, temp cleanup, cron.
- Hardening: service-role key server-only, RLS deny-all, cleanup auth-gated, preview sanitized.