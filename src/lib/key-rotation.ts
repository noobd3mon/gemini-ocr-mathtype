export interface KeyPoolState {
  keys: string[];
  index: number;
  cooldowns: Record<string, number>;
}

export class KeyPoolExhaustedError extends Error {
  constructor(message = 'Tất cả API key đều đang bị giới hạn tốc độ. Vui lòng đợi hoặc thêm key mới.') {
    super(message);
    this.name = 'KeyPoolExhaustedError';
  }
}

const DEFAULT_COOLDOWN_MS = 60_000;

export class KeyPool {
  private keys: string[];
  private index: number;
  private cooldowns: Map<string, number>;
  private cooldownMs: number;

  constructor(state: KeyPoolState, opts?: { cooldownMs?: number }) {
    this.keys = state.keys.slice();
    this.index = state.index ?? 0;
    this.cooldowns = new Map(Object.entries(state.cooldowns ?? {}));
    this.cooldownMs = opts?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  static create(keys: string[], opts?: { cooldownMs?: number }): KeyPool {
    return new KeyPool({ keys: keys.filter((k) => k.trim().length > 0), index: 0, cooldowns: {} }, opts);
  }

  get size(): number {
    return this.keys.length;
  }

  isAvailable(key: string, now = Date.now()): boolean {
    const until = this.cooldowns.get(key);
    return !until || until <= now;
  }

  nextKey(now = Date.now()): string {
    if (this.keys.length === 0) throw new KeyPoolExhaustedError('Chưa có API key nào.');
    for (let i = 0; i < this.keys.length; i++) {
      this.index = this.index % this.keys.length;
      const key = this.keys[this.index];
      this.index += 1;
      if (this.isAvailable(key, now)) return key;
    }
    throw new KeyPoolExhaustedError();
  }

  markRateLimited(key: string, now = Date.now()): void {
    this.cooldowns.set(key, now + this.cooldownMs);
  }

  serialize(): KeyPoolState {
    return { keys: this.keys.slice(), index: this.index, cooldowns: Object.fromEntries(this.cooldowns) };
  }
}

export function isRateLimitError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { status?: number; code?: number; message?: string; name?: string };
    if (e.status === 429 || e.status === 503 || e.code === 429) return true;
    const text = `${e.message ?? ''} ${e.name ?? ''}`.toLowerCase();
    return /rate.?limit|quota|too many request|resource.?exhausted/i.test(text);
  }
  return false;
}

export async function runWithRotation<T>(
  pool: KeyPool,
  fn: (key: string) => Promise<T>,
  opts?: {
    maxAttempts?: number;
    isRateLimit?: (err: unknown) => boolean;
    onRotated?: (info: { key: string; attempts: number }) => void;
  },
): Promise<T> {
  const isRL = opts?.isRateLimit ?? isRateLimitError;
  const maxAttempts = opts?.maxAttempts ?? Math.max(4, pool.size * 2);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = pool.nextKey();
    try {
      return await fn(key);
    } catch (err) {
      lastError = err;
      if (!isRL(err)) throw err;
      pool.markRateLimited(key);
      opts?.onRotated?.({ key, attempts: attempt + 1 });
    }
  }
  throw lastError instanceof KeyPoolExhaustedError ? lastError : new KeyPoolExhaustedError();
}

/** Lỗi do fetch bị huỷ vì quá 45s (AbortSignal.timeout) — mạng chậm/hanging. */
export function isTimeoutError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as { name?: string; message?: string };
    if (e.name === 'TimeoutError' || e.name === 'AbortError') return true;
    return /timeout|timed out|aborted/i.test(e.message ?? '');
  }
  return false;
}
