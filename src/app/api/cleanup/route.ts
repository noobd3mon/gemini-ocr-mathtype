import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';

export const runtime = 'nodejs';

// Vercel invokes cron jobs via GET and automatically sends
// `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
// POST is also accepted for manual triggering with the same header.
async function handle(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const svc = new JobsService(getSupabaseAdmin());
    const removed = await svc.cleanupOld(Date.now(), 3 * 24 * 60 * 60 * 1000);
    // Quét key API khỏi các job OCR "treo" quá 2 giờ — key không bao giờ ở lại server.
    const scrubbed = await svc.scrubStaleJobKeys(Date.now(), 2 * 60 * 60 * 1000);
    return NextResponse.json({ removed, scrubbed });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
