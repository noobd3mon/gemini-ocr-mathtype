import { dataUrlToBlob } from '../base64';

// Vercel giới hạn body request của function ở ~4.5MB — giữ mỗi phần 3MB cho chắc.
export const DOCX_PART_BYTES = 3 * 1024 * 1024;

/** Tạo job mới; trả null nếu server chưa cấu hình Supabase / lỗi mạng. */
export async function ensureJobId(): Promise<string | null> {
  try {
    const res = await fetch('/api/jobs', { method: 'POST' });
    if (!res.ok) return null;
    const { jobId } = await res.json();
    return typeof jobId === 'string' && jobId ? jobId : null;
  } catch {
    return null;
  }
}

/**
 * Upload từng ảnh cắt được (data URL) lên temp-images, trả về map key → signed URL.
 * Mỗi ảnh một request để không vướng giới hạn body. Trả null nếu bất kỳ ảnh lỗi —
 * caller sẽ fallback về ảnh base64 nhúng trực tiếp.
 */
export async function uploadImagesToJob(jobId: string, images: Map<string, string>): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  for (const [key, dataUrl] of images) {
    try {
      const blob = dataUrlToBlob(dataUrl);
      const form = new FormData();
      form.append('images[]', blob, 'image.png');
      const res = await fetch(`/api/jobs/${jobId}/upload-urls`, { method: 'POST', body: form });
      if (!res.ok) return null;
      const { urls } = await res.json();
      if (!Array.isArray(urls) || typeof urls[0] !== 'string' || !urls[0]) return null;
      out.set(key, urls[0]);
    } catch {
      return null;
    }
  }
  return out;
}

export function chunkBlob(blob: Blob, maxBytes = DOCX_PART_BYTES): Blob[] {
  const parts: Blob[] = [];
  for (let offset = 0; offset < blob.size; offset += maxBytes) {
    parts.push(blob.slice(offset, Math.min(offset + maxBytes, blob.size)));
  }
  return parts;
}

/**
 * Lưu file Word lên server 3 ngày. File nhỏ: 1 request; file lớn: upload từng
 * phần qua /finalize-part rồi bảo server ghép lại qua /finalize (JSON).
 */
export async function saveWordToServer(jobId: string, blob: Blob, fileName: string): Promise<string | null> {
  try {
    const parts = chunkBlob(blob);
    if (parts.length === 1) {
      const form = new FormData();
      form.append('file', parts[0], fileName);
      form.append('fileName', fileName);
      const res = await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST', body: form });
      if (!res.ok) return null;
      const { url } = await res.json();
      return typeof url === 'string' ? url : null;
    }
    for (let i = 0; i < parts.length; i++) {
      const form = new FormData();
      form.append('file', parts[i], `part${i}`);
      form.append('index', String(i));
      const res = await fetch(`/api/jobs/${jobId}/finalize-part`, { method: 'POST', body: form });
      if (!res.ok) return null;
    }
    const res = await fetch(`/api/jobs/${jobId}/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, total: parts.length }),
    });
    if (!res.ok) return null;
    const { url } = await res.json();
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/** Tải file về máy từ URL (signed Supabase) hoặc từ Blob trong bộ nhớ. */
export function triggerDownload(source: string | Blob, fileName: string): void {
  const a = document.createElement('a');
  if (typeof source === 'string') {
    a.href = source;
  } else {
    const objUrl = URL.createObjectURL(source);
    a.href = objUrl;
    // Revoke muộn: revoke ngay sau click có thể hủy download ở một số trình duyệt.
    setTimeout(() => URL.revokeObjectURL(objUrl), 30_000);
  }
  a.download = fileName;
  a.click();
}
