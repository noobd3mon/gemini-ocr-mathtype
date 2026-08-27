import { describe, it, expect } from 'vitest';
import { chunkBlob, DOCX_PART_BYTES } from './server-flow';

describe('chunkBlob', () => {
  it('splits a blob into parts of at most DOCX_PART_BYTES', () => {
    const size = DOCX_PART_BYTES * 2 + 12345;
    const blob = new Blob([new Uint8Array(size)]);
    const parts = chunkBlob(blob);
    expect(parts).toHaveLength(3);
    expect(parts[0].size).toBe(DOCX_PART_BYTES);
    expect(parts[1].size).toBe(DOCX_PART_BYTES);
    expect(parts[2].size).toBe(12345);
  });

  it('returns a single part for small blobs and one for exact multiples', () => {
    expect(chunkBlob(new Blob([new Uint8Array(100)]))).toHaveLength(1);
    const exact = new Blob([new Uint8Array(DOCX_PART_BYTES * 2)]);
    expect(chunkBlob(exact)).toHaveLength(2);
  });

  it('reassembles to the original bytes', async () => {
    const data = new Uint8Array(1024);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const parts = chunkBlob(new Blob([data]), 300);
    const joined = new Uint8Array(await new Blob(parts).arrayBuffer());
    expect(Array.from(joined)).toEqual(Array.from(data));
  });
});
