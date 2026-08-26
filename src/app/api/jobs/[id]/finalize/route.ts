import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const form = await req.formData();
  const file = form.get('file');
  const fileName = (form.get('fileName') as string) || 'export.docx';
  if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu file Word.' }, { status: 400 });
  const blob = new Blob([await file.arrayBuffer()], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const svc = new JobsService(getSupabaseAdmin());
  try {
    const url = await svc.finalize(jobId, fileName, blob);
    await svc.deleteTempImages(jobId);
    return NextResponse.json({ url, fileName });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
