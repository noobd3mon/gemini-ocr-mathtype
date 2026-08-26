import { describe, it, expect, vi, afterEach } from 'vitest';
import { exportWord, sanitizeFileName } from './export-service';

afterEach(() => { vi.unstubAllGlobals(); });

function docxResponse(): Response {
  return new Response(new Blob(['PK-fake-docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), {
    status: 200,
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  });
}

describe('sanitizeFileName', () => {
  it('normalizes Vietnamese and special chars', () => {
    expect(sanitizeFileName('Đề thi Vật lí 10')).toBe('De_thi_Vat_li_10');
    expect(sanitizeFileName('   ')).toBe('tai_lieu_ocr');
  });
});

describe('exportWord equation mode', () => {
  it('posts sanitized markdown to pandoc and returns processed blob', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return docxResponse();
    }));

    const result = await exportWord({
      markdown: '# Đề\n\n$x^2$\n', images: new Map(), mode: 'equation',
      baseName: 'De_thi', pandocUrl: 'https://pandoc.test/convert', mathTypeUrl: 'https://mt.test',
    });
    expect(result.filename).toBe('De_thi_equation.docx');
    expect(result.blob.type).toContain('wordprocessingml');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://pandoc.test/convert');
    expect((calls[0].body as { markdown: string }).markdown).toContain('$x^2$');
  });
});

describe('exportWord mathtype mode', () => {
  it('posts {markdown, formula_mode} to /api/convert-markdown and parses X-Stats', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response(new Blob(['PK-fake'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), {
        status: 200,
        headers: { 'X-Stats': '12,1' },
      });
    }));

    const result = await exportWord({
      markdown: '# Đề\n', images: new Map(), mode: 'mathtype',
      baseName: 'De_thi', pandocUrl: 'https://pandoc.test/convert', mathTypeUrl: 'https://mt.test/',
    });
    expect(result.filename).toBe('De_thi_mathtype.docx');
    expect(result.converted).toBe(12);
    expect(result.failed).toBe(1);
    expect(calls[0].url).toBe('https://mt.test/api/convert-markdown');
    expect(calls[0].body).toMatchObject({ formula_mode: 'mathtype' });
  });

  it('replaces image markers with data-uri images in the posted markdown', async () => {
    let posted = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      posted = JSON.parse(init.body as string).markdown;
      return docxResponse();
    }));
    const md = '[[IMAGE:1,200,120,700,650|Hình]]';
    const images = new Map([['1:200,120,700,650', 'data:image/png;base64,AAA']]);
    await exportWord({ markdown: md, images, mode: 'equation', baseName: 'x', pandocUrl: 'https://p.test', mathTypeUrl: 'https://m.test' });
    expect(posted).toBe('![Hình](data:image/png;base64,AAA)');
  });
});
