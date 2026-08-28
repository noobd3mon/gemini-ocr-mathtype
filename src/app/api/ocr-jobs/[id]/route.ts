import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { internalFetchHeaders, isValidJobId } from '@/lib/server-guards';
import { publicOcrJobView } from '@/lib/ocr-job-state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STALE_MS = 90_000; // không có cập nhật quá 90s → coi là chain đứt, tự "kick" lại

// Trạng thái job (đã stripped keys). Nếu job đang chạy mà "đứt" (tab đóng khi
// chain chưa kịp gọi bước tiếp), request poll này tự kích hoạt lại — chỉ cần
// mở lại trang là job sống lại. Ưu tiên worker Render khi có env.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const svc = new JobsService(getSupabaseAdmin());
  const state = await svc.getOcrJobState(jobId);
  if (!state) return NextResponse.json({ error: 'Job không tồn tại hoặc đã bị dọn.' }, { status: 404 });

  const active = state.status === 'queued' || state.status === 'running';
  const stale = Date.now() - state.updatedAt > STALE_MS;
  const unlocked = !state.lockUntil || state.lockUntil < Date.now();
  if (active && stale && unlocked && (state.keys ?? []).length > 0) {
    const workerUrl = process.env.OCR_WORKER_URL?.trim();
    after(async () => {
      try {
        if (workerUrl) {
          await fetch(`${workerUrl.replace(/\/+$/, '')}/run`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-worker-token': process.env.OCR_WORKER_TOKEN ?? '' },
            body: JSON.stringify({ jobId }),
          });
        } else {
          await fetch(`${req.nextUrl.origin}/api/ocr-jobs/${jobId}/step`, { method: 'POST', headers: internalFetchHeaders() });
        }
      } catch { /* lần poll sau sẽ kick lại */ }
    });
  }
  return NextResponse.json({ id: jobId, ...publicOcrJobView(state) });
}

// Xoá job (trạng thái ocr-jobs + các trang trong temp-images).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  try {
    const svc = new JobsService(getSupabaseAdmin());
    // Xoá state trước → key biến mất ngay cả khi xoá trang lỗi.
    await svc.deleteOcrJob(jobId);
    try { await svc.deleteTempImages(jobId); } catch { /* cron sẽ dọn */ }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
