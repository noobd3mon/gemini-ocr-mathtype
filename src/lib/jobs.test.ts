import { describe, it, expect } from 'vitest';
import { JobsService, splitKey } from './jobs';

type UploadFn = (path: string, file: Blob, opts?: Record<string, unknown>) => Promise<{ path: string }>;
type SignedFn = (path: string, expires: number) => Promise<{ data: { signedUrl: string }; error: null }>;
type ListFn = (path: string, opts?: Record<string, unknown>) => Promise<{ data: unknown[]; error: null }>;
type RemoveFn = (paths: string[]) => Promise<{ data: unknown; error: null }>;
type DownloadFn = (path: string) => Promise<{ data: { arrayBuffer(): Promise<ArrayBuffer> }; error: null | { message: string } }>;

function fakeStorage(opts: {
  upload: UploadFn; createSignedUrl: SignedFn; list: ListFn; remove: RemoveFn; download?: DownloadFn;
}) {
  return {
    storage: {
      from: () => ({
        upload: opts.upload,
        createSignedUrl: opts.createSignedUrl,
        list: opts.list,
        remove: opts.remove,
        download: opts.download,
      }),
    },
  };
}

describe('splitKey', () => {
  it('returns ["temp-images", key] for temp image keys', () => {
    expect(splitKey('temp-images/j-abc/p1.png')).toEqual(['temp-images', 'j-abc/p1.png']);
  });
  it('returns ["word-exports", key] for word export keys', () => {
    expect(splitKey('word-exports/j-abc/file.docx')).toEqual(['word-exports', 'j-abc/file.docx']);
  });
});

describe('JobsService', () => {
  const now = new Date('2026-08-26T00:00:00Z').getTime();
  const fixedClock = () => now;

  it('issueUploadUrls uploads blobs and returns signed URLs', async () => {
    const uploaded: string[] = [];
    const storage = fakeStorage({
      upload: async (path) => { uploaded.push(path); return { path }; },
      createSignedUrl: async (path, _expires) => ({ data: { signedUrl: `https://signed.test/${path}` }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: null, error: null }),
    });
    const svc = new JobsService(storage as never, fixedClock);
    const blobs = [new Blob(['a'], { type: 'image/png' }), new Blob(['b'], { type: 'image/png' })];
    const urls = await svc.issueUploadUrls('j-1', blobs, 'temp-images');
    expect(uploaded).toEqual(['j-1/0.png', 'j-1/1.png']);
    expect(urls).toEqual(['https://signed.test/j-1/0.png', 'https://signed.test/j-1/1.png']);
  });

  it('finalize uploads to word-exports and returns a signed download URL', async () => {
    let uploadedPath = '';
    const storage = fakeStorage({
      upload: async (path) => { uploadedPath = path; return { path }; },
      createSignedUrl: async (path, expires) => ({ data: { signedUrl: `https://d.test/${path}?ex=${expires}` }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: null, error: null }),
    });
    const svc = new JobsService(storage as never, fixedClock);
    const url = await svc.finalize('j-2', 'file.docx', new Blob(['PK'], { type: 'application/octet-stream' }));
    expect(uploadedPath).toBe('j-2/file.docx');
    expect(url).toContain('https://d.test/j-2/file.docx');
  });

  it('deleteTempImages lists and removes all files under the job folder', async () => {
    const removed: string[] = [];
    const storage = fakeStorage({
      upload: async () => ({ path: '' }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async () => ({ data: [{ name: 'p0.png' }, { name: 'p1.png' }], error: null }),
      remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
    });
    const svc = new JobsService(storage as never, fixedClock);
    await svc.deleteTempImages('j-3');
    expect(removed).toEqual(['j-3/p0.png', 'j-3/p1.png']);
  });

  it('cleanupOld removes job folders older than maxAge', async () => {
    const oldTs = new Date(now - 4 * 24 * 60 * 60 * 1000).toISOString();
    const youngTs = new Date(now - 1 * 60 * 60 * 1000).toISOString();
    const removed: string[] = [];
    const storage = fakeStorage({
      upload: async () => ({ path: '' }),
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async (path) => ({
        data: path === ''
          ? [{ name: 'j-old', updated_at: oldTs }, { name: 'j-young', updated_at: youngTs }]
          : [{ name: 'file.docx', updated_at: oldTs }],
        error: null,
      }),
      remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
    });
    const svc = new JobsService(storage as never, fixedClock);
    const count = await svc.cleanupOld(now, 3 * 24 * 60 * 60 * 1000);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(removed.some((p) => p.startsWith('j-old'))).toBe(true);
    expect(removed.some((p) => p.startsWith('j-young'))).toBe(false);
  });

  it('uploadPart uploads a chunk into the job parts folder', async () => {
    const uploaded: string[] = [];
    const storage = fakeStorage({
      upload: async (path) => { uploaded.push(path); return { path }; },
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async () => ({ data: [], error: null }),
      remove: async () => ({ data: null, error: null }),
    });
    const svc = new JobsService(storage as never, fixedClock);
    await svc.uploadPart('j-9', 2, new Blob(['chunk']));
    expect(uploaded).toEqual(['j-9/parts/2']);
  });

  it('finalizeFromParts assembles chunks in order, saves the docx and cleans up parts', async () => {
    const uploaded: string[] = [];
    const removed: string[] = [];
    const downloads: string[] = [];
    const parts = ['AAA', 'BBB', 'CCC'];
    const storage = fakeStorage({
      upload: async (path) => { uploaded.push(path); return { path }; },
      createSignedUrl: async (path) => ({ data: { signedUrl: `https://d.test/${path}` }, error: null }),
      list: async (path) => ({
        data: [{ name: 'parts' }, { name: 'p0.png' }].map((x) => ({ ...x, updated_at: new Date(now).toISOString() })),
        error: null,
      }),
      remove: async (paths) => { removed.push(...paths); return { data: null, error: null }; },
      download: async (path) => {
        downloads.push(path);
        const idx = Number(path.split('/').pop());
        const bytes = new TextEncoder().encode(parts[idx]);
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      },
    });
    const svc = new JobsService(storage as never, fixedClock);
    const url = await svc.finalizeFromParts('j-10', 'final.docx', 3);
    expect(downloads).toEqual(['j-10/parts/0', 'j-10/parts/1', 'j-10/parts/2']);
    expect(uploaded).toEqual(['j-10/final.docx']);
    expect(url).toContain('https://d.test/j-10/final.docx');
    // deleteTempImages liệt kê ${jobId}/ → xoá cả thư mục parts
    expect(removed).toEqual(['j-10/parts', 'j-10/p0.png']);
  });
});

describe('JobsService OCR job state', () => {
  const now = new Date('2026-08-27T00:00:00Z').getTime();
  const fixedClock = () => now;

  function stateStorage(opts: {
    state?: unknown;
    onPut?: (path: string, body: string) => void;
    onRemove?: (paths: string[]) => void;
    folders?: { name: string; updated_at: string }[];
  }) {
    return fakeStorage({
      upload: async (path, _file, _o) => {
        opts.onPut?.(path, typeof _file === 'string' ? _file : '');
        return { path };
      },
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async () => ({ data: opts.folders ?? [], error: null }),
      remove: async (paths) => { opts.onRemove?.(paths); return { data: null, error: null }; },
      download: async () => {
        if (opts.state === undefined) return { data: null as never, error: { message: 'The resource was not found' } };
        const bytes = new TextEncoder().encode(JSON.stringify(opts.state));
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      },
    });
  }

  const sampleState = {
    status: 'running', fileName: 'a.pdf', pageCount: 4, provider: 'openai', model: 'gpt-4o',
    keys: ['sk-1', 'sk-2'], nextBatch: 1, chunks: ['md0'], createdAt: now, updatedAt: now,
  };

  it('getOcrJobState parses valid state and returns null when missing/corrupt', async () => {
    const ok = new JobsService(stateStorage({ state: sampleState }) as never, fixedClock);
    expect(await ok.getOcrJobState('j-1')).toMatchObject({ status: 'running', keys: ['sk-1', 'sk-2'] });

    const missing = new JobsService(stateStorage({}) as never, fixedClock);
    expect(await missing.getOcrJobState('j-1')).toBeNull();

    const corrupt = new JobsService(stateStorage({ state: { status: '???' } }) as never, fixedClock);
    expect(await corrupt.getOcrJobState('j-1')).toBeNull();
  });

  it('putOcrJobState uploads JSON to {id}/state.json', async () => {
    const puts: { path: string; body: string }[] = [];
    const svc = new JobsService(stateStorage({ onPut: (path, body) => puts.push({ path, body }) }) as never, fixedClock);
    await svc.putOcrJobState('j-2', sampleState as never);
    expect(puts[0].path).toBe('j-2/state.json');
    expect(JSON.parse(puts[0].body).keys).toEqual(['sk-1', 'sk-2']);
  });

  it('deleteOcrJob removes all files under the job folder', async () => {
    const removed: string[] = [];
    const svc = new JobsService(stateStorage({ onRemove: (p) => removed.push(...p), folders: [{ name: 'state.json', updated_at: '' }] }) as never, fixedClock);
    await svc.deleteOcrJob('j-3');
    expect(removed).toEqual(['j-3/state.json']);
  });

  it('scrubStaleJobKeys wipes keys of stale active jobs only', async () => {
    const now2 = now;
    const states: Record<string, any> = {
      'j-stale': { ...sampleState, updatedAt: now2 - 3 * 60 * 60 * 1000 },
      'j-fresh': { ...sampleState, fileName: 'b.pdf', updatedAt: now2 - 60 * 1000 },
      'j-done': { ...sampleState, status: 'done', keys: ['sk-keep'], fileName: 'c.pdf', updatedAt: now2 - 9 * 60 * 60 * 1000 },
    };
    const perPath = fakeStorage({
      upload: async (path, file) => {
        const id = path.split('/')[0];
        if (typeof file === 'string') states[id] = JSON.parse(file);
        return { path };
      },
      createSignedUrl: async () => ({ data: { signedUrl: '' }, error: null }),
      list: async () => ({ data: [{ name: 'j-stale' }, { name: 'j-fresh' }, { name: 'j-done' }], error: null }),
      remove: async () => ({ data: null, error: null }),
      download: (async (path: string) => {
        const id = path.split('/')[0];
        const bytes = new TextEncoder().encode(JSON.stringify(states[id]));
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null };
      }) as never,
    });
    const svc = new JobsService(perPath as never, fixedClock);
    const scrubbed = await svc.scrubStaleJobKeys(now, 2 * 60 * 60 * 1000);
    expect(scrubbed).toBe(1);
    expect(states['j-stale'].keys).toEqual([]);
    expect(states['j-fresh'].keys).toEqual(['sk-1', 'sk-2']);
    expect(states['j-done'].keys).toEqual(['sk-keep']);
  });
});
