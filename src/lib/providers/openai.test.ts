import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeBaseUrl, ocrImagesWithOpenAI } from './openai';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('normalizeBaseUrl', () => {
  it('trims whitespace and trailing slashes', () => {
    expect(normalizeBaseUrl('  https://api.example.com/v1/// ')).toBe('https://api.example.com/v1');
    expect(normalizeBaseUrl('')).toBe('');
  });
});

describe('ocrImagesWithOpenAI', () => {
  it('posts images to {base}/chat/completions with Bearer auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return jsonResponse({ choices: [{ message: { content: '# Kết quả\n' } }] });
    }));

    const result = await ocrImagesWithOpenAI({
      pageImages: ['data:image/png;base64,AAA', 'data:image/png;base64,BBB'],
      keys: ['sk-1'],
      baseUrl: 'https://api.example.com/v1/',
      model: 'gpt-4o',
      maxTokens: 16000,
    });
    expect(result).toBe('# Kết quả\n');
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-1');
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.max_tokens).toBe(16000);
    const content = body.messages[0].content;
    expect(content[0].type).toBe('text');
    expect(content[0].text).toContain('[[IMAGE:');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } });
    expect(content[2].image_url.url).toBe('data:image/png;base64,BBB');
  });

  it('omits max_tokens when not set', async () => {
    const inits: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, i: RequestInit) => {
      inits.push(i);
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    }));
    await ocrImagesWithOpenAI({ pageImages: ['data:image/png;base64,A'], keys: ['k'], baseUrl: 'https://x.test', model: 'm' });
    const body = JSON.parse(inits[0].body as string);
    expect('max_tokens' in body).toBe(false);
  });

  it('rotates keys on 429', async () => {
    const used: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const key = (init.headers as Record<string, string>).Authorization.replace('Bearer ', '');
      used.push(key);
      if (key === 'a') return jsonResponse({ error: { message: 'rate limit' } }, 429);
      return jsonResponse({ choices: [{ message: { content: 'ok' } }] });
    }));
    const result = await ocrImagesWithOpenAI({ pageImages: ['data:image/png;base64,A'], keys: ['a', 'b'], baseUrl: 'https://x.test', model: 'm' });
    expect(result).toBe('ok');
    expect(used).toEqual(['a', 'b']);
  });

  it('throws when baseUrl is missing', async () => {
    await expect(ocrImagesWithOpenAI({ pageImages: [], keys: ['k'], baseUrl: '  ', model: 'm' })).rejects.toThrow(/Base URL/);
  });
});
