import type { SupabaseClient } from '@supabase/supabase-js';
import { bytesToArrayBuffer } from './base64';

export const SIGNED_URL_TTL = 3 * 24 * 60 * 60; // 3 ngày (giây)
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Supabase list defaults to 100 entries; request the max so large jobs / many
// folders are not silently truncated.
const LIST_LIMIT = 1000;

export function splitKey(key: string): [string, string] {
  const slash = key.indexOf('/');
  return slash >= 0 ? [key.slice(0, slash), key.slice(slash + 1)] : ['', key];
}

export class JobsService {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async issueUploadUrls(jobId: string, blobs: Blob[], bucket: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < blobs.length; i++) {
      const path = `${jobId}/${i}.png`;
      const { error } = await this.supabase.storage.from(bucket).upload(path, blobs[i], {
        contentType: 'image/png',
        upsert: true,
      });
      if (error) throw new Error(`Upload ảnh thất bại (${path}): ${error.message}`);
      const signed = await this.supabase.storage.from(bucket).createSignedUrl(path, SIGNED_URL_TTL);
      if (signed.error || !signed.data?.signedUrl) throw new Error(`Không tạo được signed URL (${path}).`);
      out.push(signed.data.signedUrl);
    }
    return out;
  }

  async finalize(jobId: string, fileName: string, blob: Blob): Promise<string> {
    const path = `${jobId}/${fileName}`;
    const { error } = await this.supabase.storage.from('word-exports').upload(path, blob, {
      contentType: DOCX_MIME,
      upsert: true,
    });
    if (error) throw new Error(`Lưu Word thất bại (${path}): ${error.message}`);
    const signed = await this.supabase.storage.from('word-exports').createSignedUrl(path, SIGNED_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error('Không tạo được signed URL tải Word.');
    return signed.data.signedUrl;
  }

  /** Lưu một phần của file Word lớn (chunk) vào temp-images để ghép sau. */
  async uploadPart(jobId: string, index: number, blob: Blob): Promise<void> {
    const path = `${jobId}/parts/${index}`;
    const { error } = await this.supabase.storage.from('temp-images').upload(path, blob, {
      contentType: 'application/octet-stream',
      upsert: true,
    });
    if (error) throw new Error(`Upload phần ${index} thất bại (${path}): ${error.message}`);
  }

  /** Ghép các phần đã upload thành file Word hoàn chỉnh, lưu + xoá phần rác. */
  async finalizeFromParts(jobId: string, fileName: string, total: number): Promise<string> {
    const bucket = this.supabase.storage.from('temp-images');
    const buffers: Uint8Array[] = [];
    for (let i = 0; i < total; i++) {
      const dl = await bucket.download(`${jobId}/parts/${i}`);
      if (dl.error || !dl.data) throw new Error(`Không đọc được phần ${i} của file Word.`);
      buffers.push(new Uint8Array(await dl.data.arrayBuffer()));
    }
    const url = await this.finalize(jobId, fileName, new Blob(buffers.map(bytesToArrayBuffer), { type: DOCX_MIME }));
    await this.deleteTempImages(jobId); // xoá cả các part trong ${jobId}/parts/
    return url;
  }

  async getDownloadUrl(jobId: string, fileName: string, bucket = 'word-exports'): Promise<string> {
    const signed = await this.supabase.storage.from(bucket).createSignedUrl(`${jobId}/${fileName}`, SIGNED_URL_TTL);
    if (signed.error || !signed.data?.signedUrl) throw new Error('File Word đã hết hạn hoặc không tồn tại.');
    return signed.data.signedUrl;
  }

  async deleteTempImages(jobId: string): Promise<void> {
    const bucket = this.supabase.storage.from('temp-images');
    const list = await bucket.list(jobId, { limit: LIST_LIMIT });
    if (list.error) throw new Error(`Không liệt kê được temp-images (${jobId}).`);
    const paths = (list.data ?? []).map((f) => `${jobId}/${f.name}`);
    if (paths.length === 0) return;
    const { error } = await bucket.remove(paths);
    if (error) throw new Error(`Không xóa được temp-images (${jobId}): ${error.message}`);
  }

  async cleanupOld(now: number, maxAgeMs: number): Promise<number> {
    const cutoff = new Date(now - maxAgeMs);
    let removed = 0;
    for (const bucketName of ['temp-images', 'word-exports']) {
      const storage = this.supabase.storage.from(bucketName);
      const folders = await storage.list('', { limit: LIST_LIMIT });
      if (folders.error) continue;
      for (const folder of folders.data ?? []) {
        const updated = folder.updated_at ? new Date(folder.updated_at) : new Date(0);
        if (updated >= cutoff) continue;
        const files = await storage.list(folder.name, { limit: LIST_LIMIT });
        if (files.error) continue;
        const paths = (files.data ?? []).map((f) => `${folder.name}/${f.name}`);
        if (paths.length > 0) {
          const { error } = await storage.remove(paths);
          if (!error) removed += paths.length;
        }
      }
    }
    return removed;
  }
}
