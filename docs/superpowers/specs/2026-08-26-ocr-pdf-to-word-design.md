# OCR PDF/Image → Word (Gemini + OpenAI) — Design

Date: 2026-08-26
Status: Draft (awaiting user review)

## 1. Goal

Rebuild the existing **AIOMT OCR PDF/Image** app (`chuyen-pdf-app-2299k.vercel.app`) as a
Vercel + Supabase full-stack app that:

- OCRs PDF/images → Markdown, preserving LaTeX formulas, tables, and figures.
- Supports **two OCR provider types**: Gemini (Google direct) and OpenAI-compatible
  Chat Completions (custom base URL).
- **Rotates multiple user-provided keys** per provider when a key is rate-limited.
- Exports **large Markdown (>1,000,000 characters)** to Word `.docx` with OMML formulas
  (Pandoc) and MathType OLE objects (MathType server).
- Stores cut figures **temporarily on the server (Supabase)**, stores the final `.docx`
  **on the server for 3 days**, and **deletes temp images** after export.
- **Core features must not break** — reliability is the top constraint.

## 2. What the original app does (research findings)

The original is a **Vite + React + TypeScript SPA**, almost entirely client-side:

- `pdf.js` renders PDF pages to canvas (client-side) — `pdf.worker.min` bundle, `getDocument`.
- Gemini key stored in `localStorage`; calls `generativelanguage.googleapis.com` **directly
  from the browser** (CORS-allowed). Sends the **raw PDF in one request** ("Gemini + cắt ảnh"
  mode) OR all page images in one request ("Gemma + bảng" mode via Vertex AI).
- Gemini is prompted to emit Markdown with:
  - inline math `$...$`, block math `$$...$$`,
  - pipe tables,
  - page markers `<!-- Trang N -->`,
  - **figure cut markers** `[[IMAGE:page,x1,y1,x2,y2|caption]]` where coordinates are
    **permille** (0–1000, i.e. ×1e3 of page width/height).
- The app parses those markers, **cuts the region from the rendered page canvas** → base64 PNG.
- `.docx` is **assembled in the browser** with the `docx` npm library, embedding:
  - cut figure PNGs,
  - OMML from the external **Pandoc server** (`pandoc-server.onrender.com/convert`, LaTeX→OMML),
  - MathType OLE from the external **MathType server** (`latex2mathtypeweb.onrender.com`, LaTeX→OLE).
- A separate PyMuPDF service (`pymupdf-2026.onrender.com`) exists as `pdfRender` backup.
- Output is a browser download (no server storage).

The provided sample (`trích mẫu.txt`, ~1.19 MB / >1M chars, 171 dense lines) is a
text+math physics exam: `<!-- Trang 1..5 -->`, inline `$...$`, block `$$...$$`, Markdown
headings/bold/italic, **no figures and no tables** in this particular sample.

**Key implication:** the original's client-side approach is proven for large files and
avoids server time/size limits. The new app keeps the client-side heavy lifting and adds a
thin Vercel + Supabase layer only for the new storage/retention requirements.

## 3. Architecture overview

**Stack:** Next.js (App Router) + TypeScript on **Vercel**; **Supabase** (Storage) for
temp figures + 3-day `.docx` retention; external Pandoc + MathType servers reused as-is.

**Byte-flow principle (critical):** Vercel serverless functions have a ~4.5 MB request-body
limit and 10–60 s+ execution caps. The PDF (~1 MB), the page images, the cut figures, and the
final `.docx` (can be many MB) all **flow directly from the browser** to their destinations:
- PDF → Gemini API (browser direct).
- Page images → OpenAI-compatible endpoint (browser direct).
- Cut figures → Supabase Storage via **signed upload URLs** (browser direct).
- Final `.docx` → Supabase Storage via **signed upload URL** (browser direct).

Vercel functions only do small-JSON work: issue signed URLs, finalize a job, serve a
download link, and run a daily cleanup cron. No heavy bytes transit Vercel.

```
Browser (heavy work)                  Vercel (small JSON)        Supabase Storage
┌──────────────────────┐  POST /api/jobs        ┌──────────┐   temp-images/  (short)
│ pdf.js render pages   │ ─────────────────────>│ issue    │   word-exports/ (3-day)
│ OCR (Gemini/OpenAI)   │  signed URLs back      │ signed   │
│ key rotation          │ <───────────────────── │ URLs     │
│ cut figures           │                        └──────────┘
│ assemble .docx        │  upload figures ────────────────────────────────> temp-images/
│ (docx+Pandoc+MathType)│  upload .docx   ────────────────────────────────> word-exports/
│                       │  POST /api/jobs/{id}/finalize (delete temps, return link)
└──────────────────────┘
```

External services (called from the browser, same as original): Pandoc server (LaTeX→OMML),
MathType server (LaTeX→OLE).

## 4. Approaches considered (Word assembly location)

**A. Client-side assembly + server storage (RECOMMENDED).** Browser assembles the `.docx`
(proven from the original) using `docx` + Pandoc + MathType, then uploads it to Supabase.
Cut figures are staged to Supabase `temp-images` (satisfies "lưu temp ở server") and deleted
after the `.docx` is uploaded. Most reliable for >1M-char files; no Vercel time/size risk.
Trade-off: the staged temp figures are not consumed server-side (they're a server-side
mirror/record as the spec requires), so there's minor redundancy.

**B. Server-side assembly.** Browser uploads cut figures to Supabase temp, sends Markdown
+ figure refs to a Vercel function that assembles the `.docx` (Pandoc + MathType + `docx`),
stores it, deletes temps, returns a link. Coherent (temps are used server-side) but risks
Vercel execution-time and memory limits for >1M-char docs with many formula conversions;
would require Vercel Pro/Fluid and still risks timeouts.

**C. Hybrid.** Server-side for small docs, client-side fallback for large. Most complex;
two code paths to maintain and test.

**Chosen: A.** It best satisfies the strongest constraints ("core features must not break"
and ">1M chars") while still meeting the literal temp-on-server / 3-day-Word / delete-temps
requirements. The temp-figure staging is real (objects exist in Supabase and are purged), so
the requirement is met; they additionally enable a server-side figure preview/gallery and
survive a page refresh during a session if we later want that.

## 5. Components

### 5.1 Client modules (`src/lib/`)
- `pdf-render.ts` — `pdfjs-dist` renders a PDF to page PNGs at a configurable scale
  (1.5×/2×/2.5×/3×) via canvas → `data:image/png;base64,...`. Used for OpenAI vision input,
  preview, and figure cutting. Same approach as the original.
- `providers/gemini.ts` — sends the raw PDF (inlineData, `application/pdf`) in one
  `generateContent` request with the core prompt; returns Markdown. Models configurable
  (default `gemini-3.5-flash`; also `3.6-flash`, `3.1-flash-lite`, `3-flash-preview`).
- `providers/openai.ts` — sends page images as `image_url` data URLs in a
  `{baseUrl}/chat/completions` request with the core prompt; returns Markdown. `baseUrl`,
  model name, and keys are all user-provided.
- `key-rotation.ts` — `KeyPool` per provider: round-robin with per-key cooldown on
  rate-limit; see §6.
- `image-cut.ts` — parse `[[IMAGE:page,x1,y1,x2,y2|caption]]` markers (permille coords),
  cut regions from the rendered page canvas → base64 PNGs, replace markers with image refs.
- `latex-convert.ts` — collect all `$...$`/`$$...$$`, call Pandoc (→OMML) and MathType
  (→OLE) with bounded concurrency + caching + per-formula fallback (see §9).
- `export-docx.ts` — assemble `.docx` with the `docx` library: paragraphs/headings/tables
  from Markdown, embedded figure PNGs, OMML runs for inline math, MathType OLE objects for
  block math. Mirrors the original's `docxExportService` + `mathtypeExport` chunk.
- `markdown.ts` — minimal Markdown→docx element mapping (headings, bold/italic, lists, pipe
  tables, code). We do NOT need a full Markdown parser; Pandoc handles math, we handle prose.
- `storage.ts` — talk to our `/api/jobs` endpoints, upload to Supabase via signed URLs.
- `prompt.ts` — the core OCR prompt (LaTeX rules, table rules, page markers, figure markers)
  + user extra-prompt. Adapted from the original's embedded prompt.

### 5.2 Server endpoints (Next.js Route Handlers, `src/app/api/`)
All use the Supabase **service-role key** (server env only, never in the browser).

- `POST /api/jobs` — body `{ filename, charCount? }` → creates a `jobId` (uuid), returns
  `{ jobId }`. (Object keys are derived from `jobId`; no DB required — id is encoded in path.)
- `POST /api/jobs/{id}/upload-urls` — body `{ keys: string[] }` where each key is a full
  storage path (`temp-images/{id}/{n}.png` or `word-exports/{id}.docx`). Returns a short-lived
  (≤15 min) **signed upload URL per key**. The client calls this once it knows how many
  figures it cut (after OCR) and again for the final `.docx` path. Supabase signed URLs are
  per-object, so one URL per requested key.
- `POST /api/jobs/{id}/finalize` — body `{ filename, charCount, status }`. Server marks the
  export ready: creates a **3-day signed download URL** for `word-exports/{id}.docx`, deletes
  `temp-images/{id}/*` (satisfies "xóa temp ảnh"), returns `{ downloadUrl, expiresAt, id }`.
- `GET /api/jobs/{id}` — if the object still exists and is within 3 days, returns a fresh
  signed download URL; otherwise 410 Gone.
- `GET /api/cleanup` — **Vercel Cron** (daily, e.g. `0 3 * * *`). Lists objects in
  `temp-images` and `word-exports`, deletes any older than 3 days (by `created` metadata).
  Protected by a `CRON_SECRET` bearer token. (Idempotent; also deletes orphaned temps.)

> Supabase signed URLs: upload URLs are short-lived (≤15 min) and scoped to a key; download
> URLs are created with 3-day expiry. Because Supabase signed-URL max expiry is 7 days, 3-day
> expiry is supported directly. The daily cron is the authoritative retention enforcer.

### 5.3 Supabase
- **Storage buckets** (both private; server-managed via service role):
  - `temp-images` — `{jobId}/{n}.png`. Deleted on finalize (and by cron if orphaned).
  - `word-exports` — `{jobId}.docx`. Retained 3 days (cron-enforced).
- **RLS:** deny all direct client access to both buckets. Only the server (service role)
  reads/writes. The browser uploads via signed URLs issued by the server.
- **No Postgres table required** for v1 (id is encoded in the storage path; cleanup uses
  object `created` metadata). A small `exports` table is a documented future addition if we
  want a "my recent exports" list or richer metadata.

## 6. Key rotation design (client-side)

```
KeyPool { keys: string[]; index: number; cooldowns: Map<key, untilMs> }
```
- `nextKey()` — round-robin, skipping keys whose `cooldowns[key] > now`; throws
  `AllKeysExhausted` if none available.
- `runWithRotation(fn)` — calls `fn(key)`; on **429 / 503 / "rate limit"** response, marks
  that key cooled-down (default 60 s, configurable), advances to the next key, retries. Cap
  attempts at `keys.length * 2` to avoid infinite loops.
- Two independent pools: `geminiKeys` and `openaiKeys`, each with its own `baseUrl`/`model`
  config for OpenAI.
- Persisted in `localStorage` (per user's choice). Keys never sent to our server (they go
  only to the chosen provider directly from the browser).
- UI: add/remove keys per provider, show per-key status (ok / cooling-down), show last error.

## 7. OCR pipeline

1. User selects provider, adds keys, sets model/max-pages/render-scale/extra-prompt,
   uploads a PDF (or up to 30 images, matching the original) and an output filename.
2. **If OpenAI-compatible:** render PDF → page PNGs (`pdf-render.ts`) first (vision needs
   images). **If Gemini:** skip rendering for OCR (raw PDF is sent).
3. Build the core prompt (`prompt.ts`) + user extra-prompt, append LaTeX/table/figure rules.
4. Call the provider **with key rotation**:
   - Gemini: one request with inlineData PDF → Markdown.
   - OpenAI-compatible: one request with all page images as `image_url` → Markdown.
   (Both match the original's "one request" philosophy; pagination/max-pages caps input size.)
5. Markdown streams into the editor; live preview renders LaTeX + tables (KaTeX + a small
   table renderer). Stats update: pages, completed, errors, formulas, figures, characters.

## 8. Figure cutting

- After OCR, parse `[[IMAGE:page,x1,y1,x2,y2|caption]]` (permille, 0–1000).
- Render the referenced page at the chosen scale (reuse `pdf-render.ts`), cut the rectangle
  `(x1%,y1%)-(x2%,y2%)` from the canvas → base64 PNG.
- Replace each marker in the Markdown with an internal image ref (e.g. `[[IMG:0]]`) kept for
  the editor/preview; the actual base64 is held in memory and staged to Supabase temp.
- If a marker is malformed or the page can't render, keep the marker as visible text + record
  an error count (do not fail the whole export).

## 9. Word export pipeline (client assembles, server stores)

1. **Stage figures:** for each cut PNG, upload to Supabase `temp-images/{jobId}/{n}.png` via
   a signed upload URL from `/api/jobs`. (Satisfies "lưu temp ở server".)
2. **Convert math:** `latex-convert.ts` collects every `$...$` and `$$...$$`:
   - Pandoc server: LaTeX → OMML (inline + block). Bounded concurrency (e.g. 4), cache by
     normalized LaTeX string, 3 retries with backoff. On final failure, fall back to the raw
     LaTeX as visible text and increment an error counter (never abort the export).
   - MathType server: LaTeX → MathType OLE (for block formulas, per the original's MathType
     mode). Same retry/fallback policy.
3. **Assemble `.docx`:** `export-docx.ts` walks the Markdown, emitting paragraphs, headings,
   bold/italic, lists, pipe tables (via `docx` Table), inline math as OMML runs, block math as
   MathType OLE objects, and embedded figure PNGs. Output: a `Blob`.
4. **Upload `.docx`:** to Supabase `word-exports/{jobId}.docx` via the signed upload URL.
5. **Finalize:** `POST /api/jobs/{jobId}/finalize` → server deletes `temp-images/{jobId}/*`,
   returns a 3-day download link. (Satisfies "xuất word lưu server 3 ngày" + "xóa temp ảnh".)
6. UI shows the download link + expiry, plus the per-step counts (formulas ok/failed, figures,
   characters) like the original. Fallback: if finalize/upload fails, offer a direct browser
   download of the in-memory `.docx` so the user never loses their result.

## 10. Large-file (>1M char) handling

- OCR result loads into the editor as a plain string; the editor is a `<textarea>`-backed or
  CodeMirror large-content component to avoid virtual-DOM overhead on huge strings.
- Live preview renders incrementally / on-demand (KaTeX per visible block) to avoid locking
  the UI on a 1M-char document.
- Math conversion: bounded concurrency + caching keeps external calls and memory bounded even
  with thousands of formulas.
- `.docx` assembly: the `docx` library builds in memory; a 1.19 MB Markdown + embedded images
  stays well under Vercel/browser memory limits. The `.docx` uploads directly to Supabase
  (object limit 50 MB) — no Vercel body limit involved.
- Pandoc/MathType are called from the browser (as in the original), so their latency does not
  count against any Vercel function timeout.

## 11. Reliability & error handling ("core features must not break")

- **External services:** Pandoc + MathType wrapped with retries (3×, exponential backoff),
  per-formula fallback to raw LaTeX text, and clear counts ("X công thức lỗi"). A service
  being down degrades formulas to readable text but never fails the whole export.
- **Key rotation:** a single rate-limited/bad key never fails the job; only "all keys
  exhausted" is a hard error, surfaced clearly.
- **pdf.js:** robust, well-supported; rendering failures are per-page and reported, not fatal.
- **Supabase upload:** if staging or final upload fails, fall back to a direct browser
  download of the in-memory `.docx` so the result is never lost.
- **Partial failures:** every step reports counts (pages, completed, errors, formulas,
  figures, characters) mirroring the original's stats panel.
- **No silent failures:** all async steps either succeed with visible progress or surface a
  specific, actionable error.

## 12. Environment & deploy

Vercel env vars (server-only):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — server access to Storage.
- `CRON_SECRET` — protects `GET /api/cleanup`.
- `PANDOC_URL` (= `https://pandoc-server.onrender.com/convert`),
  `MATHTYPE_URL` (= `https://latex2mathtypeweb.onrender.com`) — exposed to the client via a
  small `GET /api/config` endpoint (so the URLs aren't hardcoded in the bundle and can be
  rotated without redeploy). PyMuPDF backup URL optional.

Vercel Cron (`vercel.json`): `0 3 * * *` → `/api/cleanup`.

Deploy: `next build` on Vercel; no special runtime needed (all heavy work is client-side).

## 13. UI (mirrors the original, Vietnamese)

- Header: app name + mode badges (Gemini / OpenAI, OMML / MathType).
- **OCR setup panel:** provider selector (Gemini / OpenAI-compatible), key list (add/remove
  multiple keys per provider, show rotation status), model selector, max pages, render scale,
  extra prompt. For OpenAI: base URL + model name fields.
- **Source:** file dropzone (PDF or up to 30 images) + Ctrl+V paste + output filename.
- **Actions:** OCR button, Results / Original pages tabs, Copy, Markdown view, Export Word.
- **Stats:** pages / completed / errors / formulas / figures / characters.
- **Editor + live preview** (split), editable before export.
- Export result: download link (3-day) + expiry, with a direct-download fallback.

## 14. Out of scope (v1) / future

- Supabase Postgres `exports` table / "recent exports" history (use Storage metadata for now).
- Server-side `.docx` assembly (Approach B) — revisit only if client-side proves insufficient.
- Gemma/Vertex AI mode (the original's second mode) — not requested; Gemini + OpenAI only.
- Auth / multi-tenant — keys are per-browser in localStorage; no accounts.
- Replacing Pandoc/MathType with in-process conversion — explicitly kept as external services
  per user's choice.

## 15. Risks & open items

- **Pandoc/MathType exact request/response contract:** the original bundle is minified; the
  exact payload fields aren't readable. **Mitigation:** probe the live endpoints during
  implementation (send a small LaTeX sample, inspect response) before wiring `latex-convert.ts`.
- **OpenAI custom-endpoint CORS:** browser-direct calls require the user's endpoint to allow
  CORS. Documented as a requirement; the original relied on the same pattern for Gemini.
  (If a user's endpoint lacks CORS, that's their endpoint config; a server proxy is a possible
  future addition but reintroduces Vercel time limits.)
- **Vercel plan:** all heavy work is client-side, so the app works on the **Hobby** plan; only
  the cron requires Vercel Cron (available on Hobby with limits; Pro recommended for
  reliability).
- **3-day retention authority:** Supabase signed-URL expiry + daily cron both enforce it; the
  cron is the source of truth and handles orphaned temp images too.
