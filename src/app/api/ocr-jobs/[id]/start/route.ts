import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';
import { publicOcrJobView } from '@/lib/ocr-job-state';

export const runtime = 'nodejs';

// Client gọi sau khi đã upload xong tất cả các trang — kích hoạt bước OCR đầu tiên.
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
  const origin = req.nextUrl.origin;
  after(async () => {
    try {
      await fetch(`${origin}/api/ocr-jobs/${jobId}/step`, { method: 'POST' });
    } catch { /* poll sẽ kick lại */ }
  });
  return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
}
