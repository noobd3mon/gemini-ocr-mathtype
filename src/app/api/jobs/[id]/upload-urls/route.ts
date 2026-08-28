import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Không có ảnh để upload.' }, { status: 400 });
  }
  try {
    const files = form.getAll('images[]');
    const blobs = files.filter((f): f is File => f instanceof File);
    if (blobs.length === 0) return NextResponse.json({ error: 'Không có ảnh để upload.' }, { status: 400 });
    // Index thật của ảnh trong job (client upload từng ảnh một request)
    const rawIndex = Number(form.get('index'));
    const startIndex = Number.isInteger(rawIndex) && rawIndex >= 0 ? rawIndex : 0;
    const svc = new JobsService(getSupabaseAdmin());
    const urls = await svc.issueUploadUrls(jobId, blobs, 'temp-images', startIndex);
    return NextResponse.json({ urls });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
