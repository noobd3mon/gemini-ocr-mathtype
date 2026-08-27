import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId, sanitizeServerFileName } from '@/lib/server-guards';

export const runtime = 'nodejs';

// Hai chế độ:
//  1. multipart (file + fileName): file Word nhỏ (≤ ~3.5MB sau chunk của client).
//  2. JSON {fileName, total}: file lớn đã được client upload từng phần qua
//     /finalize-part → ghép lại ở server rồi lưu vào word-exports.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const isJson = (req.headers.get('content-type') ?? '').includes('application/json');

  let form: FormData | null = null;
  let jsonBody: { fileName?: unknown; total?: unknown } | null = null;
  try {
    if (isJson) {
      jsonBody = await req.json();
    } else {
      form = await req.formData();
    }
  } catch {
    return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
  }

  try {
    const svc = new JobsService(getSupabaseAdmin());
    if (jsonBody) {
      const fileName = sanitizeServerFileName(typeof jsonBody.fileName === 'string' ? jsonBody.fileName : '');
      const total = Number(jsonBody.total);
      if (!Number.isInteger(total) || total < 1 || total > 200) {
        return NextResponse.json({ error: 'Tham số total không hợp lệ.' }, { status: 400 });
      }
      const url = await svc.finalizeFromParts(jobId, fileName, total);
      return NextResponse.json({ url, fileName });
    }

    const file = form!.get('file');
    const rawName = typeof form!.get('fileName') === 'string' ? (form!.get('fileName') as string) : '';
    const fileName = sanitizeServerFileName(rawName);
    if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
    const blob = new Blob([await file.arrayBuffer()], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
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
