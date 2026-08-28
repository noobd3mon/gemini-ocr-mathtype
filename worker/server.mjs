// OCR Worker — chạy trên Render (free) thay cho chuỗi function 60s của Vercel.
// Không có npm dependencies. Chạy: node server.mjs
//
// Biến môi trường:
//   SUPABASE_URL               — https://<project-ref>.supabase.co (bản gốc, không kèm /rest/v1)
//   SUPABASE_SERVICE_ROLE_KEY  — service_role key
//   WORKER_TOKEN               — chuỗi bí mật; Vercel gửi kèm qua header x-worker-token
//   PORT                       — Render tự set (mặc định 8787 khi chạy local)
//   RENDER_EXTERNAL_URL        — Render tự set; dùng để tự ping giữ tỉnh qua proxy
//
// Endpoints:
//   GET  /health → { ok, active, uptime }  (public — dùng để đánh thức worker)
//   POST /run    → body { jobId }, header x-worker-token → trả lời ngay rồi chạy nền
import http from 'node:http';
import { createRequire } from 'node:module';
import {
  GEMINI_API_BASE, batchRanges, buildCorePrompt, buildModelChain, isModelUnavailableError,
  isRateLimitError, makeKeyPool, sleep, sniffImageMime,
} from './worker-core.mjs';

const require = createRequire(import.meta.url);
const Buffer = require('node:buffer').Buffer;

const PORT = Number(process.env.PORT || 8787);
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SERVICE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const WORKER_TOKEN = (process.env.WORKER_TOKEN || '').trim();

/** Số lần tối đa worker chịu CHỜ qua rate-limit cho cùng một nhóm trang. */
const MAX_RATE_LIMIT_WAITS = 30;
const RATE_LIMIT_WAIT_MS = 45_000;
const LOCK_MS = 5 * 60_000; // lock nhịp tim — gia hạn sau mỗi trang; nếu worker chết, 5 phút sau job khác/restart chạy lại được

const activeJobs = new Set();

// ===== Supabase Storage REST (không cần SDK) =====
function storageHeaders(extra = {}) {
  return { Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function getState(jobId) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/ocr-jobs/${jobId}/state.json`, {
    headers: storageHeaders(),
  });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`getState ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = JSON.parse(await res.text());
  if (!raw || typeof raw.status !== 'string' || !Array.isArray(raw.chunks)) return null;
  return raw;
}

async function putState(jobId, state) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/ocr-jobs/${jobId}/state.json`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json', 'x-upsert': 'true' }),
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`putState ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function getPageDataUrl(jobId, page) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/temp-images/${jobId}/${page}.png`, {
    headers: storageHeaders(),
  });
  if (!res.ok) throw new Error(`Không đọc được ảnh trang ${page + 1} (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mime = sniffImageMime(bytes);
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

// ===== Gọi provider (mirror của src/lib/providers) =====
async function callGemini({ keys, model, prompt, dataUrls, onRotated }) {
  const pool = makeKeyPool(keys);
  const parts = [{ text: prompt }, ...dataUrls.map((url) => {
    const m = url.match(/^data:([^;]+);base64,(.*)$/s);
    if (!m) throw new Error('Data URL ảnh trang không hợp lệ.');
    return { inlineData: { mimeType: m[1], data: m[2] } };
  })];
  return runWithRotation(pool, async (key) => {
    const res = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Gemini API lỗi ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    }
    const data = await res.json();
    const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    if (!out.trim()) throw new Error('Gemini trả về kết quả rỗng.');
    return out;
  }, { onRotated });
}

async function callOpenAI({ keys, model, baseUrl, prompt, dataUrls, onRotated }) {
  const base = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!base) throw new Error('Job OpenAI thiếu Base URL.');
  const pool = makeKeyPool(keys);
  const content = [{ type: 'text', text: prompt }, ...dataUrls.map((url) => ({ type: 'image_url', image_url: { url } }))];
  return runWithRotation(pool, async (key) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content }] }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`OpenAI API lỗi ${res.status}: ${text.slice(0, 300)}`), { status: res.status });
    }
    const data = await res.json();
    const message = data?.choices?.[0]?.message?.content;
    const out = typeof message === 'string' ? message : (message?.map?.((p) => p?.text ?? '').join('') ?? '');
    if (!out.trim()) throw new Error('OpenAI trả về kết quả rỗng.');
    return out;
  }, { onRotated });
}

async function runWithRotation(pool, fn, { onRotated }) {
  const maxAttempts = Math.max(4, 8);
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pool.nextKey();
    if (key === null) {
      const err = new Error('Tất cả API key đều đang bị giới hạn tốc độ.');
      err.rateLimited = true;
      throw err;
    }
    try {
      return await fn(key);
    } catch (err) {
      lastError = err;
      if (!isRateLimitError(err)) throw err;
      pool.markRateLimited(key);
      onRotated?.({ attempts: attempt + 1 });
    }
  }
  if (lastError && isRateLimitError(lastError)) {
    lastError.rateLimited = true;
  }
  throw lastError;
}

/** OCR một nhóm trang, tự CHỜ qua rate-limit và lùi model khi model 404/hết hạn mức kéo dài. */
async function ocrPagesWithRetry(jobId, state, pages, updateProgress) {
  const ladder = state.provider === 'gemini' ? buildModelChain(state.model) : [state.model];
  let modelIdx = 0;
  let waits = 0;
  while (true) {
    const model = ladder[modelIdx];
    const from = pages[0] + 1;
    const to = pages[pages.length - 1] + 1;
    const prompt = buildCorePrompt({
      extraPrompt: state.extraPrompt,
      pageRange: from !== 1 ? { from, to } : undefined,
    });
    const dataUrls = [];
    for (const page of pages) dataUrls.push(await getPageDataUrl(jobId, page));
    const args = {
      keys: state.keys, model, prompt, dataUrls,
      onRotated: ({ attempts }) => {
        updateProgress(`Rate-limited — chuyển key (lần ${attempts})...`);
      },
    };
    try {
      updateProgress(`Đang OCR trang ${from}${to !== from ? `-${to}` : ''} bằng ${model}...`);
      const markdown = state.provider === 'gemini'
        ? await callGemini(args)
        : await callOpenAI({ ...args, baseUrl: state.baseUrl });
      return markdown;
    } catch (err) {
      if (isModelUnavailableError(err) && modelIdx < ladder.length - 1) {
        console.log(`[job ${jobId}] model ${model} không khả dụng — lùi về ${ladder[modelIdx + 1]}`);
        modelIdx += 1;
        continue;
      }
      if (isRateLimitError(err)) {
        waits += 1;
        if (waits > MAX_RATE_LIMIT_WAITS) {
          throw new Error(`Bị giới hạn tốc độ liên tục sau ${MAX_RATE_LIMIT_WAITS} lần chờ — hãy thử lại sau hoặc thêm key.`);
        }
        // Chờ qua rate-limit thay vì chết như trên Vercel — đây là lợi thế của worker.
        if (waits % 3 === 0 && modelIdx < ladder.length - 1) {
          console.log(`[job ${jobId}] hết hạn mức kéo dài ở ${model} — lùi về ${ladder[modelIdx + 1]}`);
          modelIdx += 1;
        }
        updateProgress(`Hết hạn mức — chờ ${Math.round(RATE_LIMIT_WAIT_MS / 1000)}s rồi thử lại (lần ${waits})...`);
        await sleep(RATE_LIMIT_WAIT_MS + Math.floor(Math.random() * 10_000));
        continue;
      }
      throw err;
    }
  }
}

// ===== Vòng lặp chính của một job =====
// Mọi ghi state đi qua hàng đợi tuần tự — progress write không bao giờ đè lên
// bản ghi mới hơn (nextBatch/chunks).
function makeWriteQueue() {
  let chain = Promise.resolve();
  return (jobId, state) => {
    const p = chain.then(() => putState(jobId, state));
    chain = p.catch(() => {});
    return p;
  };
}

async function runJobLoop(jobId) {
  activeJobs.add(jobId);
  const queuePut = makeWriteQueue();
  try {
    while (true) {
      const state = await getState(jobId);
      if (!state) throw new Error('Job không tồn tại.');
      if (state.status === 'done' || state.status === 'error') return;

      const per = state.pagesPerStep ?? 1;
      const from = state.nextBatch * per;
      if (from >= state.pageCount) {
        state.status = 'done';
        state.keys = [];
        state.progressText = 'Hoàn tất.';
        state.updatedAt = Date.now();
        await queuePut(jobId, state);
        return;
      }
      const to = Math.min(from + per, state.pageCount) - 1;
      const pages = [];
      for (let p = from; p <= to; p++) pages.push(p);

      state.status = 'running';
      state.lockUntil = Date.now() + LOCK_MS;
      state.updatedAt = Date.now();
      state.progressText = `Đang OCR trang ${from + 1}${to !== from ? `-${to + 1}` : ''}...`;
      await queuePut(jobId, state);

      const markdown = await ocrPagesWithRetry(jobId, state, pages, (msg) => {
        state.progressText = msg;
        queuePut(jobId, { ...state, updatedAt: Date.now(), lockUntil: Date.now() + LOCK_MS })
          .catch((e) => console.error(`[job ${jobId}] progress putState lỗi:`, e.message));
      });

      state.chunks.push(markdown);
      state.nextBatch = to + 1;
      state.updatedAt = Date.now();
      state.lockUntil = Date.now() + LOCK_MS;
      if (state.nextBatch >= state.pageCount) {
        state.status = 'done';
        state.keys = []; // XOÁ KEY khi hoàn tất
        state.progressText = 'Hoàn tất.';
        console.log(`[job ${jobId}] DONE: ${state.fileName} — ${state.pageCount} trang`);
      }
      await queuePut(jobId, state);
      if (state.status === 'done') return;
    }
  } catch (err) {
    console.error(`[job ${jobId}] LỖI:`, err.message);
    try {
      const state = await getState(jobId);
      if (state && state.status !== 'done') {
        state.status = 'error';
        state.error = err.message;
        state.keys = []; // XOÁ KEY khi lỗi
        state.lockUntil = 0;
        state.updatedAt = Date.now();
        await putState(jobId, state);
      }
    } catch (e) {
      console.error(`[job ${jobId}] ghi lỗi thất bại:`, e.message);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

// ===== HTTP server =====
function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => resolve(body));
  });
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, active: activeJobs.size, uptime: Math.round(process.uptime()) });
    }
    if (req.method === 'POST' && url.pathname === '/run') {
      if (!WORKER_TOKEN || req.headers['x-worker-token'] !== WORKER_TOKEN) {
        return sendJson(res, 401, { error: 'Unauthorized — x-worker-token không đúng.' });
      }
      if (!SUPABASE_URL || !SERVICE_KEY) {
        return sendJson(res, 500, { error: 'Worker thiếu SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' });
      }
      const body = JSON.parse((await readBody(req)) || '{}');
      const jobId = typeof body.jobId === 'string' ? body.jobId : '';
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(jobId)) return sendJson(res, 400, { error: 'JobId không hợp lệ.' });

      const state = await getState(jobId);
      if (!state) return sendJson(res, 404, { error: 'Job không tồn tại.' });
      if (state.status === 'done' || state.status === 'error') {
        return sendJson(res, 200, { ok: true, noOp: true, status: state.status });
      }
      if (!state.keys || state.keys.length === 0) {
        return sendJson(res, 409, { error: 'Job đã hết key (đã kết thúc hoặc bị dọn).' });
      }
      if (state.lockUntil && state.lockUntil > Date.now()) {
        return sendJson(res, 200, { ok: true, skipped: 'locked' });
      }
      state.lockUntil = Date.now() + LOCK_MS;
      state.updatedAt = Date.now();
      await putState(jobId, state);
      // Chạy nền — trả lời ngay để Vercel không phải chờ (job có thể dài hàng chục phút).
      runJobLoop(jobId);
      return sendJson(res, 200, { ok: true, started: true, pageCount: state.pageCount });
    }
    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[http]', err.message);
    sendJson(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`[worker] OCR worker đang chạy tại :${PORT} — active: ${activeJobs.size}`);
});

// Tự ping qua proxy của Render để không bị ngủ gục: khi có job → mỗi 60s;
// khi rảnh → mỗi 10 phút (vẫn dưới ngưỡng 15 phút spin-down của Render free).
let lastPingAt = 0;
setInterval(() => {
  const base = process.env.RENDER_EXTERNAL_URL;
  if (!base) return;
  const busy = activeJobs.size > 0;
  if (!busy && Date.now() - lastPingAt < 10 * 60_000) return;
  lastPingAt = Date.now();
  fetch(`${base.replace(/\/+$/, '')}/health`).catch(() => {});
}, 60_000);
