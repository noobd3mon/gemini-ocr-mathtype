import { describe, it, expect } from 'vitest';
import {
  batchPageRange, totalBatches, isOcrJobState, publicOcrJobView, SERVER_PAGES_PER_STEP,
} from './ocr-job-state';
import type { OcrJobState } from './ocr-job-state';

describe('batchPageRange', () => {
  it('splits one page per step', () => {
    expect(batchPageRange(0, 3, 1)).toEqual({ from: 0, to: 0 });
    expect(batchPageRange(2, 3, 1)).toEqual({ from: 2, to: 2 });
    expect(batchPageRange(3, 3, 1)).toBeNull();
  });

  it('splits two pages per step (legacy jobs)', () => {
    expect(batchPageRange(0, 5, 2)).toEqual({ from: 0, to: 1 });
    expect(batchPageRange(1, 5, 2)).toEqual({ from: 2, to: 3 });
    expect(batchPageRange(2, 5, 2)).toEqual({ from: 4, to: 4 });
    expect(batchPageRange(3, 5, 2)).toBeNull();
  });
});

describe('totalBatches', () => {
  it('rounds up', () => {
    expect(totalBatches(30, 1)).toBe(30);
    expect(totalBatches(3, 2)).toBe(2);
    expect(totalBatches(4, 2)).toBe(2);
  });
});

describe('publicOcrJobView', () => {
  const base = {
    status: 'running', fileName: 'a.pdf', pageCount: 6, provider: 'gemini', model: 'm',
    keys: ['k'], nextBatch: 2, chunks: ['a', 'b'], createdAt: 1, updatedAt: 2,
  } satisfies OcrJobState;

  it('never leaks keys', () => {
    const view = publicOcrJobView({ ...base });
    expect(JSON.stringify(view)).not.toContain('k');
    expect(view).not.toHaveProperty('keys');
  });

  it('uses pagesPerStep when present, defaults to 2 for legacy states', () => {
    expect(publicOcrJobView({ ...base, pagesPerStep: 1 }).totalBatches).toBe(6);
    expect(publicOcrJobView({ ...base }).totalBatches).toBe(3);
  });

  it('includes markdown only when done', () => {
    expect(publicOcrJobView({ ...base }).markdown).toBeUndefined();
    const done = publicOcrJobView({ ...base, status: 'done', keys: [] });
    expect(done.markdown).toBe('a\n\nb');
  });
});

describe('isOcrJobState', () => {
  it('accepts states with and without pagesPerStep', () => {
    expect(isOcrJobState({ status: 'queued', fileName: 'a', pageCount: 1, nextBatch: 0, chunks: [] })).toBe(true);
    expect(isOcrJobState({ status: 'queued', fileName: 'a', pageCount: 1, nextBatch: 0, chunks: [], pagesPerStep: 1 })).toBe(true);
    expect(isOcrJobState({ status: 'queued' })).toBe(false);
    expect(isOcrJobState(null)).toBe(false);
  });

  it('new jobs default to 1 page per step', () => {
    expect(SERVER_PAGES_PER_STEP).toBe(1);
  });
});
