import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import type { OcrJobState } from '@/lib/ocr-job-state';

export const runtime = 'nodejs';

const MAX_KEYS = 50;

// Tạo job OCR chạy trên server. Key API được đưa vào state.json (bucket private)
// CHỈ để job chạy; bị xoá ngay khi done/error/cancel và cron quét dọn job treo.
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body phải là JSON.' }, { status: 400 });
  }

  const fileName = typeof body.fileName === 'string' && body.fileName.trim() ? body.fileName.trim().slice(0, 160) : '';
  const pageCount = Number(body.pageCount);
  const provider =
    body.provider === 'openai' ? ('openai' as const) : body.provider === 'gemini' ? ('gemini' as const) : '';
  const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : '';
  const baseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const maxTokens = Number.isFinite(Number(body.maxTokens)) && Number(body.maxTokens) > 0 ? Number(body.maxTokens) : undefined;
  const extraPrompt = typeof body.extraPrompt === 'string' ? body.extraPrompt.slice(0, 4000) : '';
  const keys = Array.isArray(body.keys)
    ? body.keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.trim().slice(0, 500))
    : [];

  if (!fileName) return NextResponse.json({ error: 'Thiếu tên file.' }, { status: 400 });
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 200) {
    return NextResponse.json({ error: 'Số trang không hợp lệ.' }, { status: 400 });
  }
  if (provider !== 'gemini' && provider !== 'openai') {
    return NextResponse.json({ error: 'Provider không hợp lệ.' }, { status: 400 });
  }
  if (!model) return NextResponse.json({ error: 'Thiếu model.' }, { status: 400 });
  if (keys.length === 0) return NextResponse.json({ error: 'Thiếu API key.' }, { status: 400 });
  if (keys.length > MAX_KEYS) return NextResponse.json({ error: 'Quá nhiều key.' }, { status: 400 });
  if (provider === 'openai' && !baseUrl) return NextResponse.json({ error: 'Thiếu Base URL cho OpenAI.' }, { status: 400 });

  const now = Date.now();
  const jobId = `j-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const state: OcrJobState = {
    status: 'queued', // đợi client upload xong các trang rồi gọi /start
    fileName, pageCount,
    provider, model,
    ...(provider === 'openai' ? { baseUrl } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(extraPrompt ? { extraPrompt } : {}),
    keys,
    nextBatch: 0,
    chunks: [],
    createdAt: now,
    updatedAt: now,
  };
  try {
    await new JobsService(getSupabaseAdmin()).putOcrJobState(jobId, state);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
  return NextResponse.json({ jobId });
}
