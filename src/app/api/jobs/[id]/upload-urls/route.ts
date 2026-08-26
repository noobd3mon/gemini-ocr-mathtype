import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  try {
    const form = await req.formData();
    const files = form.getAll('images[]');
    const blobs = files.filter((f): f is File => f instanceof File);
    if (blobs.length === 0) return NextResponse.json({ error: 'Không có ảnh để upload.' }, { status: 400 });
    const svc = new JobsService(getSupabaseAdmin());
    const urls = await svc.issueUploadUrls(jobId, blobs, 'temp-images');
    return NextResponse.json({ urls });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
