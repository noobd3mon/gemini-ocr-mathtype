import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';
import { publicOcrJobView } from '@/lib/ocr-job-state';

export const runtime = 'nodejs';

/** Kích hoạt job: ưu tiên worker Render (không giới hạn 60s) khi có env;
 *  không có worker thì fallback sang chuỗi function 1 trang/bước. */
function kick(req: NextRequest, jobId: string) {
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
        await fetch(`${req.nextUrl.origin}/api/ocr-jobs/${jobId}/step`, { method: 'POST' });
      }
    } catch { /* poll của client sẽ kick lại */ }
  });
}

// Client gọi sau khi đã upload xong tất cả các trang — kích hoạt OCR.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const svc = new JobsService(getSupabaseAdmin());
  const state = await svc.getOcrJobState(jobId);
  if (!state) return NextResponse.json({ error: 'Job không tồn tại.' }, { status: 404 });
  if (state.status === 'done' || state.status === 'error') {
    return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
  }
  state.updatedAt = Date.now();
  await svc.putOcrJobState(jobId, state);
  kick(req, jobId);
  return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
}
