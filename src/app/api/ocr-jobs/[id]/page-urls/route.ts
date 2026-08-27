import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';

export const runtime = 'nodejs';

// Cấp signed URL cho các trang đã upload — client dùng để tải trang về và cắt
// ảnh hình sau khi job OCR hoàn tất.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const pageCount = Number(_req.nextUrl.searchParams.get('pageCount'));
  if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 200) {
    return NextResponse.json({ error: 'Thiếu hoặc sai pageCount.' }, { status: 400 });
  }
  try {
    const svc = new JobsService(getSupabaseAdmin());
    const urls = await svc.getPageSignedUrls(jobId, pageCount);
    return NextResponse.json({ urls });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
