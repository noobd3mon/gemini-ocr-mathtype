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
