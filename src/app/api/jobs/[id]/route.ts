import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId } from '@/lib/server-guards';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  if (!isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const fileName = req.nextUrl.searchParams.get('fileName');
  if (!fileName) return NextResponse.json({ error: 'Thiếu fileName.' }, { status: 400 });
  try {
    const svc = new JobsService(getSupabaseAdmin());
    const url = await svc.getDownloadUrl(jobId, fileName);
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
