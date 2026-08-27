import { describe, it, expect } from 'vitest';
import { arrayBufferToBase64 } from '../base64';
import { computeRenderScale, clampPageCount } from './render-pages';
import { markerToPixelRect, clampRect } from './cut-image';
import type { ImageMarker } from '../markdown/markers';

describe('arrayBufferToBase64', () => {
  it('encodes bytes', () => {
    const buf = new TextEncoder().encode('hello').buffer;
    expect(arrayBufferToBase64(buf)).toBe('aGVsbG8=');
  });

  it('handles large buffers in chunks', () => {
    // 199998 is a multiple of 3 → base64 ends cleanly with 'QUFB' (no padding).
    const big = new Uint8Array(199_998).fill(65).buffer;
    const out = arrayBufferToBase64(big);
    expect(out.startsWith('QUFB')).toBe(true);
    expect(out.endsWith('QUFB')).toBe(true);
  });
});

describe('computeRenderScale / clampPageCount', () => {
  it('maps choices and clamps outliers', () => {
    expect(computeRenderScale('1.5')).toBe(1.5);
    expect(computeRenderScale('3')).toBe(3);
    expect(computeRenderScale('9')).toBe(2);
    expect(computeRenderScale('abc')).toBe(2);
  });

  it('clamps page counts', () => {
    expect(clampPageCount(50, 30)).toBe(30);
    expect(clampPageCount(3, 30)).toBe(3);
    expect(clampPageCount(10, 0)).toBe(1);
  });
});

describe('markerToPixelRect / clampRect', () => {
  const marker: ImageMarker = { page: 1, x1: 200, y1: 120, x2: 700, y2: 650, caption: '', raw: '' };

  it('converts permille to pixels', () => {
    const rect = markerToPixelRect(marker, 1000, 2000);
    expect(rect).toEqual({ x: 200, y: 240, w: 500, h: 1060 });
  });

  it('normalizes reversed coordinates', () => {
    const rev: ImageMarker = { page: 1, x1: 700, y1: 650, x2: 200, y2: 120, caption: '', raw: '' };
    expect(markerToPixelRect(rev, 1000, 2000)).toEqual({ x: 200, y: 240, w: 500, h: 1060 });
  });

  it('clamps out-of-bounds rects to page bounds', () => {
    const bad: ImageMarker = { page: 1, x1: -10, y1: -10, x2: 1200, y2: 5000, caption: '', raw: '' };
    const rect = markerToPixelRect(bad, 500, 500);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.y).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w).toBeLessThanOrEqual(500);
    expect(rect.y + rect.h).toBeLessThanOrEqual(500);
    expect(rect.w).toBeGreaterThan(0);
    expect(rect.h).toBeGreaterThan(0);
  });

  it('enforces a 1px minimum', () => {
    expect(clampRect({ x: 100, y: 100, w: -5, h: 0 }, 200, 200).w).toBe(1);
  });
});
