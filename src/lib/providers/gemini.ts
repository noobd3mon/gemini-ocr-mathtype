import { KeyPool, KeyPoolExhaustedError, runWithRotation } from '@/lib/key-rotation';
import { GEMINI_MODELS } from '@/lib/settings-store';
import { buildCorePrompt } from './prompt';
import { batchRanges } from './batching';

export interface GeminiOcrOptions {
  pdfBase64: string;
  keys: string[];
  /** Model khởi đầu; khi mọi key bị giới hạn (hoặc model 404) sẽ tự lùi về model cũ hơn trong GEMINI_MODELS. */
  model?: string;
  extraPrompt?: string;
  onProgress?: (msg: string) => void;
  onRotated?: (info: { key: string; attempts: number }) => void;
}

export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function modelUrl(model: string): string {
  return `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
}

export function buildModelChain(start: string, ladder: string[] = GEMINI_MODELS): string[] {
  const idx = ladder.indexOf(start);
  return idx >= 0 ? ladder.slice(idx) : [start, ...ladder];
}

// Model chưa tồn tại / chưa mở cho key này → thử model kế trong ladder thay vì báo lỗi.
function isModelUnavailableError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; message?: string };
    if (e.status === 404) return true;
    return /not found|is not supported/i.test(e.message ?? '');
  }
  return false;
}

export async function ocrPdfWithGemini(opts: GeminiOcrOptions): Promise<string> {
  const chain = buildModelChain(opts.model ?? GEMINI_MODELS[0]);
  const prompt = buildCorePrompt({ extraPrompt: opts.extraPrompt });

  let lastError: unknown;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    // Pool mới cho từng model: hạn mức Gemini tính theo model, nên key vừa bị
    // giới hạn ở model cũ vẫn dùng được ngay với model kế tiếp.
    const pool = KeyPool.create(opts.keys);
    try {
      return await runWithRotation(
        pool,
        async (key) => {
          opts.onProgress?.(`Đang OCR ${model}...`);
          const res = await fetch(modelUrl(model), {
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
    } catch (err) {
      lastError = err;
      const exhausted = err instanceof KeyPoolExhaustedError;
      const unavailable = isModelUnavailableError(err);
      if (!exhausted && !unavailable) throw err;
      if (i + 1 < chain.length) {
        opts.onProgress?.(
          exhausted
            ? `Tất cả key bị giới hạn với ${model} — thử lại với ${chain[i + 1]}...`
            : `${model} không khả dụng — thử lại với ${chain[i + 1]}...`,
        );
      }
    }
  }
  throw lastError;
}

export interface GeminiImagesOcrOptions {
  pageImages: string[]; // data URL image/png;base64,...
  keys: string[];
  model: string;
  extraPrompt?: string;
  /** Số trang của ảnh đầu tiên (mặc định 1). */
  startPage?: number;
  /** Số ảnh tối đa mỗi request (mặc định 2 — dùng cho bước chạy trên server). */
  pagesPerRequest?: number;
  onProgress?: (msg: string) => void;
  onRotated?: (info: { key: string; attempts: number }) => void;
}

// OCR theo ảnh trang (dùng khi server chạy job từng nhóm — tương thích cả hai provider).
// Có fallback model giống ocrPdfWithGemini: hết key ở model này → lùi model cũ hơn,
// hoặc model 404 → thử model kế, để bước server không chết vì model chưa khả dụng.
export async function ocrPageImagesWithGemini(opts: GeminiImagesOcrOptions): Promise<string> {
  if (opts.pageImages.length === 0) throw new Error('Không có ảnh trang nào để OCR.');
  const chain = buildModelChain(opts.model);
  const per = Math.max(1, opts.pagesPerRequest ?? 2);
  const startPage = opts.startPage ?? 1;
  const ranges = batchRanges(opts.pageImages.length, per, startPage);

  let lastError: unknown;
  for (let ci = 0; ci < chain.length; ci++) {
    const model = chain[ci];
    // Pool mới cho từng model: hạn mức Gemini tính theo model.
    const pool = KeyPool.create(opts.keys);
    const parts: string[] = [];
    try {
      for (let i = 0; i < ranges.length; i++) {
        const { from, to } = ranges[i];
        const slice = opts.pageImages.slice(i * per, i * per + (to - from + 1));
        const multiChunk = ranges.length > 1 || from !== 1;
        const prompt = buildCorePrompt({
          extraPrompt: opts.extraPrompt,
          pageRange: multiChunk ? { from, to } : undefined,
        });
        const inlineParts = slice.map((dataUrl) => {
          const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
          if (!m) throw new Error('Data URL ảnh trang không hợp lệ.');
          return { inlineData: { mimeType: m[1], data: m[2] } };
        });
        const body = {
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, ...inlineParts],
            },
          ],
        };
        const out = await runWithRotation(
          pool,
          async (key) => {
            opts.onProgress?.(`Đang gửi trang ${from}-${to} tới ${model}...`);
            const res = await fetch(modelUrl(model), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
              body: JSON.stringify(body),
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
        parts.push(out);
      }
      return parts.join('\n\n');
    } catch (err) {
      lastError = err;
      const exhausted = err instanceof KeyPoolExhaustedError;
      const unavailable = isModelUnavailableError(err);
      if (!exhausted && !unavailable) throw err;
      if (ci + 1 < chain.length) {
        opts.onProgress?.(
          exhausted
            ? `Tất cả key bị giới hạn với ${model} — thử lại với ${chain[ci + 1]}...`
            : `${model} không khả dụng — thử lại với ${chain[ci + 1]}...`,
        );
      }
    }
  }
  throw lastError;
}
