import { describe, it, expect } from 'vitest';
import { buildCorePrompt } from './prompt';

describe('buildCorePrompt', () => {
  const prompt = buildCorePrompt();

  it('demands plain markdown without code fences', () => {
    expect(prompt).toContain('Markdown thuần');
    expect(prompt).toContain('KHÔNG dùng code fence');
  });

  it('demands page markers', () => {
    expect(prompt).toContain('<!-- Trang N -->');
  });

  it('demands LaTeX inline/block and pipe tables', () => {
    expect(prompt).toContain('$...$');
    expect(prompt).toContain('$$...$$');
    expect(prompt).toContain('|---|');
  });

  it('demands figure markers with permille coordinates and example', () => {
    expect(prompt).toContain('[[IMAGE:trang,x1,y1,x2,y2|chú thích]]');
    expect(prompt).toContain('[[IMAGE:1,200,120,700,650|Đồ thị]]');
    expect(prompt).toContain('PHẦN NGHÌN');
  });

  it('keeps Vietnamese and appends extra prompt', () => {
    expect(prompt).toContain('tiếng Việt giữ nguyên');
    const withExtra = buildCorePrompt({ extraPrompt: '  Giữ số thứ tự câu hỏi.  ' });
    expect(withExtra).toContain('Giữ số thứ tự câu hỏi.');
    expect(withExtra).toContain('YÊU CẦU BỔ SUNG');
  });
});
