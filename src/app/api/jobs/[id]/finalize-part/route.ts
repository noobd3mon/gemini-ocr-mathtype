import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';

export const runtime = 'nodejs';

// Client upload file Word lớn theo từng phần (~3MB) — vượt qua giới hạn 4.5MB
// body của Vercel. Các phần nằm ở temp-images ${jobId}/parts/; /finalize (JSON)
// sẽ ghép chúng lại. Không có auth — an toàn vì chỉ ghi vào bucket private.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Thiếu phần file.' }, { status: 400 });
  }
  try {
    const file = form.get('file');
    const index = Number(form.get('index'));
    if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu phần file.' }, { status: 400 });
    if (!Number.isInteger(index) || index < 0 || index > 199) {
      return NextResponse.json({ error: 'Index phần không hợp lệ.' }, { status: 400 });
    }
    const svc = new JobsService(getSupabaseAdmin());
    await svc.uploadPart(jobId, index, file);
    return NextResponse.json({ ok: true, index });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
