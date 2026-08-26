import { describe, it, expect } from 'vitest';
import {
  parseImageMarkers, countFormulas, countDataUriImages, countCharacters, countPages,
  sanitizeMarkdownForPandoc,
} from './markers';

const SAMPLE = `<!-- Trang 1 -->

### Bài 1

Cho $\\alpha = 11^{\\circ}$ và $F_a = \\eta v^2$.

$$\n\\int_0^{x_0} \\frac{dx}{1-x^2}\n$$

Hình vẽ:

[[IMAGE:1,200,120,700,650|Đồ thị]]

![pic](data:image/png;base64,iVBORw0KGgo=)
`;

describe('parseImageMarkers', () => {
  it('parses marker fields and caption', () => {
    const markers = parseImageMarkers(SAMPLE);
    expect(markers).toHaveLength(1);
    const m = markers[0];
    expect(m.page).toBe(1);
    expect(m.x1).toBe(200); expect(m.y1).toBe(120);
    expect(m.x2).toBe(700); expect(m.y2).toBe(650);
    expect(m.caption).toBe('Đồ thị');
  });

  it('handles markers without caption', () => {
    const markers = parseImageMarkers('x [[IMAGE:2,10,20,30,40]] y');
    expect(markers[0].caption).toBe('');
  });

  it('ignores malformed markers', () => {
    expect(parseImageMarkers('[[IMAGE:abc]] [[image:1,2,3,4,5]]')).toHaveLength(0);
  });
});

describe('counters', () => {
  it('counts block and inline formulas', () => {
    expect(countFormulas(SAMPLE)).toBe(3);
  });

  it('counts data-uri images', () => {
    expect(countDataUriImages(SAMPLE)).toBe(1);
  });

  it('counts characters and pages', () => {
    expect(countCharacters(SAMPLE)).toBe(SAMPLE.length);
    expect(countPages('<!-- Trang 1 -->\n<!-- Trang 2 -->\n<!-- Trang 1 -->')).toBe(2);
  });
});

describe('sanitizeMarkdownForPandoc', () => {
  it('strips BOM and converts standalone --- to *** outside fences', () => {
    expect(sanitizeMarkdownForPandoc('\uFEFF# Tiêu đề\n\n---\n\nNội dung\n')).toBe('# Tiêu đề\n\n***\n\nNội dung\n');
  });

  it('leaves --- inside code fences untouched', () => {
    expect(sanitizeMarkdownForPandoc('```\n---\n```\n')).toBe('```\n---\n```\n');
  });

  it('normalizes CRLF and non-breaking spaces', () => {
    expect(sanitizeMarkdownForPandoc('a\r\nb\u00a0c')).toBe('a b c');
  });
});
