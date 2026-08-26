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
  const svc = new JobsService(getSupabaseAdmin());
  const removed = await svc.cleanupOld(Date.now(), 3 * 24 * 60 * 60 * 1000);
  return NextResponse.json({ removed });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
