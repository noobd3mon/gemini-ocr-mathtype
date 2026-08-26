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
