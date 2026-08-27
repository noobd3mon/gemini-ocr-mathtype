import { describe, it, expect } from 'vitest';
import { renderMarkdownPreview } from './md-html';

describe('renderMarkdownPreview', () => {
  it('renders headings, bold, italic and paragraphs', () => {
    const { html } = renderMarkdownPreview('# Tiêu đề\n\nĐoạn **đậm** và *nghiêng*.');
    expect(html).toContain('<h1>Tiêu đề</h1>');
    expect(html).toContain('<strong>đậm</strong>');
    expect(html).toContain('<em>nghiêng</em>');
  });

  it('renders inline and block math with katex classes', () => {
    const { html } = renderMarkdownPreview('Inline $x^2$ và\n\n$$\\frac{1}{2}$$\n');
    expect(html).toContain('katex');
    expect(html.match(/katex/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('renders pipe tables as <table>', () => {
    const { html } = renderMarkdownPreview('| a | b |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<table');
    expect(html).toContain('<th>a</th>');
    expect(html).toContain('<td>2</td>');
  });

  it('renders data-uri images and page markers', () => {
    const { html } = renderMarkdownPreview('<!-- Trang 1 -->\n\n![pic](data:image/png;base64,AAA)\n');
    expect(html).toContain('Trang 1');
    expect(html).toContain('src="data:image/png;base64,AAA"');
  });

  it('substitutes cut images and shows unresolved markers as badges', () => {
    const md = '[[IMAGE:1,200,120,700,650|Hình]]';
    const images = new Map([['1:200,120,700,650', 'data:image/png;base64,BBB']]);
    expect(renderMarkdownPreview(md, { images }).html).toContain('data:image/png;base64,BBB');
    expect(renderMarkdownPreview(md).html).toContain('[[IMAGE:1,200,120,700,650|Hình]]');
  });

  it('escapes raw HTML and truncates large content', () => {
    const { html } = renderMarkdownPreview('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    const long = 'a'.repeat(5000);
    const result = renderMarkdownPreview(long, { maxChars: 1000 });
    expect(result.truncated).toBe(true);
  });

  it('escapes quotes in data-uri src to block attribute injection', () => {
    const { html } = renderMarkdownPreview('![x](data:image/png;base64,AAA" onerror="alert(1))');
    expect(html).not.toContain('onerror="');
    expect(html).toContain('onerror=&quot;');
  });

  it('matches staged image keys when the model emits decimal coords', () => {
    const images = new Map([['1:200,120,700,650', 'data:image/png;base64,ZZZ']]);
    const { html } = renderMarkdownPreview('[[IMAGE:1,200.0,120.0,700.0,650.0|Đồ thị]]', { images });
    expect(html).toContain('src="data:image/png;base64,ZZZ"');
  });

  it('preserves sub-question labels a) b) and A. B.', () => {
    const { html } = renderMarkdownPreview('a) Ý đầu\nb) Ý hai\n');
    expect(html).toContain('a)');
    expect(html).toContain('b)');
  });
});
