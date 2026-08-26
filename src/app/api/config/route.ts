import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    pandocUrl: process.env.PANDOC_URL || 'https://pandoc-server.onrender.com/convert',
    mathTypeUrl: process.env.MATHTYPE_URL || 'https://latex2mathtypeweb.onrender.com',
    maxUploadBytes: 18 * 1024 * 1024,
  });
}
