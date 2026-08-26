import { describe, it, expect } from 'vitest';
import { KeyPool, KeyPoolExhaustedError, isRateLimitError, runWithRotation } from './key-rotation';

describe('KeyPool', () => {
  it('rotates round-robin', () => {
    const pool = KeyPool.create(['a', 'b', 'c']);
    expect([pool.nextKey(), pool.nextKey(), pool.nextKey(), pool.nextKey()]).toEqual(['a', 'b', 'c', 'a']);
  });

  it('skips cooled-down keys', () => {
    const pool = KeyPool.create(['a', 'b']);
    pool.markRateLimited('a', 0);
    expect(pool.nextKey(1)).toBe('b');
    expect(pool.nextKey(1)).toBe('b');
  });

  it('throws when all keys are cooled down or none exist', () => {
    const pool = KeyPool.create(['a']);
    pool.markRateLimited('a', 0);
    expect(() => pool.nextKey(1)).toThrow(KeyPoolExhaustedError);
    expect(() => KeyPool.create([]).nextKey()).toThrow(KeyPoolExhaustedError);
  });

  it('serializes state including cooldowns', () => {
    const pool = KeyPool.create(['a', 'b']);
    pool.nextKey();
    pool.markRateLimited('b', 0);
    const state = pool.serialize();
    expect(state.keys).toEqual(['a', 'b']);
    const restored = new KeyPool(state);
    expect(restored.nextKey(1)).toBe('a');
  });
});

describe('isRateLimitError', () => {
  it('detects 429/503 and rate-limit messages', () => {
    expect(isRateLimitError({ status: 429 })).toBe(true);
    expect(isRateLimitError({ status: 503 })).toBe(true);
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true);
    expect(isRateLimitError(new Error('quota exhausted'))).toBe(true);
    expect(isRateLimitError({ status: 500 })).toBe(false);
    expect(isRateLimitError(new Error('invalid key'))).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
  });
});

describe('runWithRotation', () => {
  it('returns result on first success', async () => {
    const pool = KeyPool.create(['a', 'b']);
    const result = await runWithRotation(pool, async (key) => key);
    expect(result).toBe('a');
  });

  it('rotates to next key on rate limit', async () => {
    const pool = KeyPool.create(['a', 'b']);
    const seen: string[] = [];
    const result = await runWithRotation(pool, async (key) => {
      seen.push(key);
      if (key === 'a') throw Object.assign(new Error('429'), { status: 429 });
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(seen).toEqual(['a', 'b']);
  });

  it('throws immediately on non-rate-limit errors', async () => {
    const pool = KeyPool.create(['a', 'b']);
    let calls = 0;
    await expect(
      runWithRotation(pool, async () => { calls++; throw new Error('bad api key'); }),
    ).rejects.toThrow('bad api key');
    expect(calls).toBe(1);
  });

  it('throws KeyPoolExhaustedError when every key is rate-limited', async () => {
    const pool = KeyPool.create(['a']);
    await expect(
      runWithRotation(pool, async () => { throw Object.assign(new Error('429'), { status: 429 }); }, { maxAttempts: 2 }),
    ).rejects.toThrow(KeyPoolExhaustedError);
  });
});
