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
