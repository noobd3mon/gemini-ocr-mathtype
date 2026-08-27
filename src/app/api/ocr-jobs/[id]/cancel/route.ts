import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';
import { publicOcrJobView } from '@/lib/ocr-job-state';

export const runtime = 'nodejs';

// Huỷ job: dừng chain, XOÁ KEY ngay lập tức. Kết quả dở bỏ.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const svc = new JobsService(getSupabaseAdmin());
  const state = await svc.getOcrJobState(jobId);
  if (!state) return NextResponse.json({ error: 'Job không tồn tại.' }, { status: 404 });
  if (state.status === 'done' || state.status === 'error') {
    return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
  }
  state.status = 'error';
  state.error = 'Đã huỷ bởi người dùng.';
  state.keys = []; // XOÁ KEY khi huỷ
  state.lockUntil = 0;
  state.updatedAt = Date.now();
  await svc.putOcrJobState(jobId, state);
  return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
}
