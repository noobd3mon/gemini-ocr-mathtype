import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId, sanitizeServerFileName } from '@/lib/server-guards';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
  }
  try {
    const file = form.get('file');
    const rawName = typeof form.get('fileName') === 'string' ? (form.get('fileName') as string) : '';
    const fileName = sanitizeServerFileName(rawName);
    if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
    const blob = new Blob([await file.arrayBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const svc = new JobsService(getSupabaseAdmin());
    const url = await svc.finalize(jobId, fileName, blob);
    let warning: string | undefined;
    try {
      await svc.deleteTempImages(jobId);
    } catch {
      warning = 'Không xóa được ảnh tạm — cron sẽ dọn sau 3 ngày.';
    }
    return NextResponse.json({ url, fileName, ...(warning ? { warning } : {}) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
