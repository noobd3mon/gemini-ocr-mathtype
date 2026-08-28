import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { internalFetchHeaders, isValidJobId } from '@/lib/server-guards';
import { batchPageRange, publicOcrJobView } from '@/lib/ocr-job-state';
import { ocrPageImagesWithGemini } from '@/lib/providers/gemini';
import { ocrImagesWithOpenAI } from '@/lib/providers/openai';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LOCK_MS = 150_000; // chống bước chạy song song trên cùng job

/**
 * Một bước của job OCR server: xử lý ĐÚNG MỘT nhóm trang rồi tự kích hoạt bước
 * kế tiếp (sau khi trả response, qua `after`). Mỗi bước là một function invocation
 * riêng — luôn gọn giới hạn 60s của Vercel, tab client có thể đóng hoàn toàn.
 * Key API đọc từ state.json trong lúc chạy và bị XOÁ ngay khi done/error.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const svc = new JobsService(getSupabaseAdmin());
  const state = await svc.getOcrJobState(jobId);
  if (!state) return NextResponse.json({ error: 'Job không tồn tại.' }, { status: 404 });
  if (state.status === 'done' || state.status === 'error') {
    return NextResponse.json({ ok: true, noOp: true, status: state.status });
  }
  if (!state.keys || state.keys.length === 0) {
    return NextResponse.json({ error: 'Job đã hết key (bị dọn vì treo hoặc đã kết thúc).' }, { status: 409 });
  }
  const now = Date.now();
  if (state.lockUntil && state.lockUntil > now) {
    return NextResponse.json({ ok: true, skipped: 'locked' });
  }

  const range = batchPageRange(state.nextBatch, state.pageCount, state.pagesPerStep ?? 2);
  if (!range) {
    // Hết trang — chốt job, XOÁ KEY.
    state.status = 'done';
    state.keys = [];
    state.lockUntil = 0;
    state.updatedAt = now;
    state.progressText = 'Hoàn tất.';
    await svc.putOcrJobState(jobId, state);
    return NextResponse.json({ ok: true, ...publicOcrJobView(state) });
  }

  // Claim lock + cập nhật tiến độ trước khi chạy.
  state.status = 'running';
  state.lockUntil = now + LOCK_MS;
  state.updatedAt = now;
  state.progressText = `Đang OCR trang ${range.from + 1}-${range.to + 1} (nhóm ${state.nextBatch + 1})...`;
  await svc.putOcrJobState(jobId, state);

  try {
    const pageImages: string[] = [];
    for (let page = range.from; page <= range.to; page++) {
      pageImages.push(await svc.getPageDataUrl(jobId, page));
    }
    const pagesPerRequest = range.to - range.from + 1;
    const onRotated = ({ attempts }: { attempts: number }) => {
      state.progressText = `Rate-limited — chuyển key (lần ${attempts})...`;
    };
    const markdown =
      state.provider === 'gemini'
        ? await ocrPageImagesWithGemini({
            pageImages, keys: state.keys, model: state.model,
            extraPrompt: state.extraPrompt, startPage: range.from + 1, pagesPerRequest,
            onRotated,
          })
        : await ocrImagesWithOpenAI({
            pageImages, keys: state.keys, model: state.model, baseUrl: state.baseUrl ?? '',
            extraPrompt: state.extraPrompt, startPage: range.from + 1, pagesPerRequest,
            maxTokens: state.maxTokens, onRotated,
          });

    state.chunks.push(markdown);
    state.nextBatch = range.to + 1;
    state.lockUntil = 0;
    state.updatedAt = Date.now();
    const more = state.nextBatch < state.pageCount;
    if (!more) {
      state.status = 'done';
      state.keys = []; // XOÁ KEY khi hoàn tất
      state.progressText = 'Hoàn tất.';
    }
    await svc.putOcrJobState(jobId, state);
    if (more) {
      const origin = req.nextUrl.origin;
      after(async () => {
        try {
          await fetch(`${origin}/api/ocr-jobs/${jobId}/step`, { method: 'POST', headers: internalFetchHeaders() });
        } catch { /* poll của client sẽ kick lại */ }
      });
    }
    return NextResponse.json({ ok: true, status: state.status, nextBatch: state.nextBatch });
  } catch (err) {
    state.status = 'error';
    state.error = (err as Error).message;
    state.keys = []; // XOÁ KEY khi lỗi
    state.lockUntil = 0;
    state.updatedAt = Date.now();
    await svc.putOcrJobState(jobId, state).catch(() => {});
    return NextResponse.json({ error: state.error }, { status: 500 });
  }
}
