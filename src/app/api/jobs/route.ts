import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST() {
  const jobId = `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return NextResponse.json({ jobId });
}
