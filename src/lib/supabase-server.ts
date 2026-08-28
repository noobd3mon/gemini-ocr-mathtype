import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

/**
 * Chuẩn hoá Project URL: người dùng rất hay dán nhầm URL có sẵn đường dẫn dịch vụ
 * (vd `https://xxx.supabase.co/rest/v1` từ trang API docs) — supabase-js sẽ ghép
 * thành `/rest/v1/storage/v1/...` và server trả lỗi
 * "Invalid path specified in request URL". Chỉ giữ lại gốc project.
 */
export function normalizeSupabaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  const KNOWN_SUFFIXES = ['/rest/v1', '/auth/v1', '/storage/v1', '/realtime/v1', '/pg', '/pgmeta', '/api', '/admin'];
  let changed = true;
  while (changed) {
    changed = false;
    const lower = url.toLowerCase();
    for (const suffix of KNOWN_SUFFIXES) {
      if (lower.endsWith(suffix)) {
        url = url.slice(0, -suffix.length).replace(/\/+$/, '');
        changed = true;
        break;
      }
    }
  }
  return url;
}

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = normalizeSupabaseUrl(process.env.SUPABASE_URL ?? '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY ở biến môi trường server.');
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
