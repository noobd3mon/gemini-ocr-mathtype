import { describe, it, expect, vi, afterEach } from 'vitest';
import { ocrPdfWithGemini, buildModelChain } from './gemini';
import { KeyPoolExhaustedError } from '@/lib/key-rotation';
import { GEMINI_MODELS } from '@/lib/settings-store';

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

describe('buildModelChain', () => {
  it('starts at the selected model and falls back through older ones', () => {
    expect(buildModelChain('gemini-3.7-flash')).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
    expect(buildModelChain('gemini-3.6-flash')).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash']);
    expect(buildModelChain('gemini-3.5-flash')).toEqual(['gemini-3.5-flash']);
  });

  it('puts unknown models first, then the full ladder', () => {
    expect(buildModelChain('gemini-x')).toEqual(['gemini-x', ...GEMINI_MODELS]);
  });
});

describe('ocrPdfWithGemini model fallback', () => {
  it('falls back to the next older model after every key is rate-limited, reusing the same keys', async () => {
    const models: string[] = [];
    const keysUsed: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      models.push(url.match(/models\/([^:]+):/)![1]);
      keysUsed.push((init.headers as Record<string, string>)['x-goog-api-key']);
      const model = models[models.length - 1];
      if (model === 'gemini-3.7-flash' || model === 'gemini-3.6-flash') {
        return jsonResponse({ error: { message: 'quota' } }, 429);
      }
      return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok-3.5' }] } }] });
    }));

    const result = await ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1', 'k2'], model: 'gemini-3.7-flash' });
    expect(result).toBe('ok-3.5');
    // 3.7: k1 rồi k2 đều 429 → hết key; 3.6: dùng lại k1, k2 → lại hết; 3.5: k1 thành công
    expect(models).toEqual([
      'gemini-3.7-flash', 'gemini-3.7-flash',
      'gemini-3.6-flash', 'gemini-3.6-flash',
      'gemini-3.5-flash',
    ]);
    expect(keysUsed).toEqual(['k1', 'k2', 'k1', 'k2', 'k1']);
  });

  it('reports each fallback step through onProgress and finally throws exhausted', async () => {
    const messages: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'quota' } }, 429)));
    await expect(
      ocrPdfWithGemini({
        pdfBase64: 'UERG', keys: ['k1'], model: 'gemini-3.7-flash',
        onProgress: (m) => messages.push(m),
      }),
    ).rejects.toThrow(KeyPoolExhaustedError);
    expect(messages.some((m) => m.includes('gemini-3.6-flash'))).toBe(true);
    expect(messages.some((m) => m.includes('gemini-3.5-flash'))).toBe(true);
    expect(messages.every((m) => !m.includes('gemini-3.1'))).toBe(true);
  });

  it('falls back when the model itself is unavailable (404)', async () => {
    const models: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      models.push(url.match(/models\/([^:]+):/)![1]);
      return jsonResponse({ error: { message: 'models/gemini-3.7-flash is not found' } }, 404);
    }));
    await expect(
      ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1'], model: 'gemini-3.7-flash' }),
    ).rejects.toThrow(/not found/);
    expect(models).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash']);
  });

  it('does not fall back on invalid-key (401) errors', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      return jsonResponse({ error: { message: 'API key not valid' } }, 401);
    }));
    await expect(
      ocrPdfWithGemini({ pdfBase64: 'UERG', keys: ['k1'], model: 'gemini-3.7-flash' }),
    ).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});
