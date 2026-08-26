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
