import type { SupabaseClient } from '@supabase/supabase-js';
import { arrayBufferToBase64, bytesToArrayBuffer } from './base64';
import { isOcrJobState, type OcrJobState } from './ocr-job-state';

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

  async issueUploadUrls(jobId: string, blobs: Blob[], bucket: string, startIndex = 0): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < blobs.length; i++) {
      // Client upload từng ảnh một request (né giới hạn body 4.5MB) — startIndex
      // là index THẬT của ảnh trong job, nếu không mọi ảnh sẽ ghi đè lên 0.png.
      const path = `${jobId}/${startIndex + i}.png`;
      const { error } = await this.supabase.storage.from(bucket).upload(path, blobs[i], {
        contentType: blobs[i].type || 'image/png',
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

  // ===== OCR jobs chạy trên server (bucket ocr-jobs) =====

  /** Đọc ảnh trang (temp-images, client upload) thành data URL cho bước OCR server.
   *  Sniff magic bytes vì đuôi file luôn là .png dù nội dung có thể là JPEG (client
   *  render bằng canvas.toDataURL('image/jpeg')). */
  async getPageDataUrl(jobId: string, page: number): Promise<string> {
    const dl = await this.supabase.storage.from('temp-images').download(`${jobId}/${page}.png`);
    if (dl.error || !dl.data) throw new Error(`Không đọc được ảnh trang ${page + 1} (hãy thử chạy lại job).`);
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    let mime = 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) mime = 'image/jpeg';
    else if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) mime = 'image/webp';
    return `data:${mime};base64,${arrayBufferToBase64(bytesToArrayBuffer(bytes))}`;
  }

  /** Cấp batch signed URL cho client tải các trang đã upload (để cắt ảnh sau khi job xong). */
  async getPageSignedUrls(jobId: string, pageCount: number): Promise<string[]> {
    const paths = Array.from({ length: pageCount }, (_, n) => `${jobId}/${n}.png`);
    const signed = await this.supabase.storage.from('temp-images').createSignedUrls(paths, SIGNED_URL_TTL);
    if (signed.error || !signed.data) throw new Error('Không tạo được signed URL cho các trang.');
    return signed.data
      .map((s) => s.signedUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0);
  }

  async getOcrJobState(jobId: string): Promise<OcrJobState | null> {
    const dl = await this.supabase.storage.from('ocr-jobs').download(`${jobId}/state.json`);
    if (dl.error || !dl.data) return null;
    try {
      const raw = JSON.parse(new TextDecoder().decode(await dl.data.arrayBuffer()));
      return isOcrJobState(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  async putOcrJobState(jobId: string, state: OcrJobState): Promise<void> {
    const { error } = await this.supabase.storage.from('ocr-jobs').upload(`${jobId}/state.json`, JSON.stringify(state), {
      contentType: 'application/json',
      upsert: true,
    });
    if (error) {
      throw new Error(
        `Lưu trạng thái job thất bại (${jobId}): ${error.message}. ` +
        'Gợi ý: kiểm tra SUPABASE_URL trên Vercel chỉ là https://<project-ref>.supabase.co (không kèm /rest/v1 hay dấu / cuối) và đã chạy supabase/setup.sql để tạo bucket ocr-jobs.',
      );
    }
  }

  async deleteOcrJob(jobId: string): Promise<void> {
    const bucket = this.supabase.storage.from('ocr-jobs');
    const list = await bucket.list(jobId, { limit: LIST_LIMIT });
    if (list.error) throw new Error(`Không liệt kê được ocr-jobs (${jobId}).`);
    const paths = (list.data ?? []).map((f) => `${jobId}/${f.name}`);
    if (paths.length === 0) return;
    const { error } = await bucket.remove(paths);
    if (error) throw new Error(`Không xóa được job (${jobId}): ${error.message}`);
  }

  /**
   * Xoá key API khỏi các job còn ở trạng thái chạy nhưng đã quá hạn không có
   * cập nhật (tab đóng giữa chừng, chain đứt...) — key không bao giờ ở lại server.
   * Trả về số job đã quét key.
   */
  async scrubStaleJobKeys(now: number, maxAgeMs: number): Promise<number> {
    const bucket = this.supabase.storage.from('ocr-jobs');
    const folders = await bucket.list('', { limit: LIST_LIMIT });
    if (folders.error) return 0;
    let scrubbed = 0;
    for (const folder of folders.data ?? []) {
      const state = await this.getOcrJobState(folder.name);
      if (!state) continue;
      const active = state.status === 'queued' || state.status === 'running';
      if (active && state.keys && state.keys.length > 0 && now - state.updatedAt > maxAgeMs) {
        state.keys = [];
        await this.putOcrJobState(folder.name, state);
        scrubbed += 1;
      }
    }
    return scrubbed;
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
    for (const bucketName of ['temp-images', 'word-exports', 'ocr-jobs']) {
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
