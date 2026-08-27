import { KeyPool, runWithRotation } from '@/lib/key-rotation';
import { buildCorePrompt } from './prompt';

export interface OpenAIOcrOptions {
  pageImages: string[];
  keys: string[];
  baseUrl: string;
  model: string;
  extraPrompt?: string;
  maxTokens?: number;
  /** Số trang của ảnh đầu tiên trong pageImages (mặc định 1). */
  startPage?: number;
  /** Số ảnh tối đa gửi trong một request (mặc định 4) — chia nhóm để tránh body quá lớn. */
  pagesPerRequest?: number;
  onProgress?: (msg: string) => void;
  onRotated?: (info: { key: string; attempts: number }) => void;
}

export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export const DEFAULT_PAGES_PER_REQUEST = 4;

export async function ocrImagesWithOpenAI(opts: OpenAIOcrOptions): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl);
  if (!base) throw new Error('Chưa nhập Base URL cho OpenAI.');
  if (opts.pageImages.length === 0) throw new Error('Không có ảnh trang nào để OCR.');
  const pool = KeyPool.create(opts.keys);
  const per = Math.max(1, opts.pagesPerRequest ?? DEFAULT_PAGES_PER_REQUEST);
  const startPage = opts.startPage ?? 1;
  const chunks: string[][] = [];
  for (let i = 0; i < opts.pageImages.length; i += per) {
    chunks.push(opts.pageImages.slice(i, i + per));
  }

  const parts: string[] = [];
  for (let ci = 0; ci < chunks.length; ci++) {
    const from = startPage + ci * per;
    const to = from + chunks[ci].length - 1;
    const multiChunk = chunks.length > 1 || from !== 1;
    const prompt = buildCorePrompt({
      extraPrompt: opts.extraPrompt,
      pageRange: multiChunk ? { from, to } : undefined,
    });
    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: prompt },
    ];
    for (const img of chunks[ci]) content.push({ type: 'image_url', image_url: { url: img } });
    const body: Record<string, unknown> = {
      model: opts.model,
      messages: [{ role: 'user', content }],
    };
    if (opts.maxTokens && opts.maxTokens > 0) body.max_tokens = opts.maxTokens;
    const out = await runWithRotation(
      pool,
      async (key) => {
        opts.onProgress?.(`Đang gửi trang ${from}-${to} tới ${opts.model}...`);
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
    parts.push(out);
    if (chunks.length > 1) {
      opts.onProgress?.(`Đã OCR xong nhóm ${ci + 1}/${chunks.length} (trang ${from}-${to}).`);
    }
  }
  return parts.join('\n\n');
}
