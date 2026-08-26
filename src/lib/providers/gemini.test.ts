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
