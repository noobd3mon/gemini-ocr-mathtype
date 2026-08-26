import { describe, it, expect } from 'vitest';
import { JobsService, splitKey } from './jobs';

type UploadFn = (path: string, file: Blob, opts?: Record<string, unknown>) => Promise<{ path: string }>;
type SignedFn = (path: string, expires: number) => Promise<{ data: { signedUrl: string }; error: null }>;
type ListFn = (path: string, opts?: Record<string, unknown>) => Promise<{ data: unknown[]; error: null }>;
type RemoveFn = (paths: string[]) => Promise<{ data: unknown; error: null }>;

function fakeStorage(opts: { upload: UploadFn; createSignedUrl: SignedFn; list: ListFn; remove: RemoveFn }) {
  return {
    storage: {
      from: () => ({
        upload: opts.upload,
        createSignedUrl: opts.createSignedUrl,
        list: opts.list,
        remove: opts.remove,
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
});
