import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { JobsService } from '@/lib/jobs';
import { isValidJobId, sanitizeServerFileName } from '@/lib/server-guards';
import { sanitizeMarkdownForPandoc } from '@/lib/markdown/markers';
import { postprocessPandocDocx } from '@/lib/export/postprocess';
import { bytesToArrayBuffer } from '@/lib/base64';

export const runtime = 'nodejs';
export const maxDuration = 60;

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_MARKDOWN_CHARS = 25_000_000; // chặn cứng; Vercel chặn body ở ~4.5MB từ trước

// Windows (dev) chạy bin/pandoc.exe; Linux (Vercel) giải nén bin/pandoc.gz ra /tmp
// đúng một lần rồi cache — giữ gói function ~40MB thay vì 222MB raw.
function resolvePandocBin(): string {
  if (process.platform === 'win32') {
    const exe = path.join(process.cwd(), 'bin', 'pandoc.exe');
    if (!existsSync(exe)) throw new Error('Chưa có bin/pandoc.exe — chạy "npm run prebuild" rồi thử lại.');
    return exe;
  }
  const tmpBin = '/tmp/pandoc';
  if (!existsSync(tmpBin)) {
    const gz = path.join(process.cwd(), 'bin', 'pandoc.gz');
    if (!existsSync(gz)) throw new Error('Chưa có bin/pandoc.gz — prebuild chưa chạy.');
    writeFileSync(tmpBin, gunzipSync(readFileSync(gz)));
    chmodSync(tmpBin, 0o755);
  }
  return tmpBin;
}

function runPandoc(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(resolvePandocBin(), ['-f', 'markdown', '-t', 'docx', '-o', '-']);
    const chunks: Buffer[] = [];
    const errs: Buffer[] = [];
    proc.stdout.on('data', (d: Buffer) => chunks.push(d));
    proc.stderr.on('data', (d: Buffer) => errs.push(d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Pandoc thoát mã ${code}: ${Buffer.concat(errs).toString().slice(0, 500)}`));
        return;
      }
      const out = Buffer.concat(chunks);
      if (out.subarray(0, 2).toString() !== 'PK') {
        reject(new Error('Pandoc không trả về file docx hợp lệ.'));
        return;
      }
      resolve(out);
    });
    proc.stdin.on('error', reject);
    proc.stdin.write(markdown);
    proc.stdin.end();
  });
}

export async function POST(req: NextRequest) {
  let body: { markdown?: unknown; jobId?: unknown; fileName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body phải là JSON.' }, { status: 400 });
  }
  const markdown = typeof body.markdown === 'string' ? body.markdown : '';
  if (!markdown.trim()) return NextResponse.json({ error: 'Thiếu markdown.' }, { status: 400 });
  if (markdown.length > MAX_MARKDOWN_CHARS) {
    return NextResponse.json({ error: 'Markdown quá lớn.' }, { status: 413 });
  }
  const jobId = typeof body.jobId === 'string' ? body.jobId : '';
  if (jobId && !isValidJobId(jobId)) return NextResponse.json({ error: 'JobId không hợp lệ.' }, { status: 400 });
  const fileName = sanitizeServerFileName(typeof body.fileName === 'string' ? body.fileName : '');

  try {
    const rawDocx = await runPandoc(sanitizeMarkdownForPandoc(markdown));
    // Chuẩn hoá font + nhãn câu hỏi ngay trên server (JSZip chạy được cả Node).
    const processed = await postprocessPandocDocx(new Blob([bytesToArrayBuffer(rawDocx)]));
    const buffer = Buffer.from(await processed.arrayBuffer());

    const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (hasSupabase) {
      if (!jobId) return NextResponse.json({ error: 'Thiếu jobId.' }, { status: 400 });
      const svc = new JobsService(getSupabaseAdmin());
      const url = await svc.finalize(jobId, fileName, new Blob([buffer], { type: DOCX_MIME }));
      try {
        await svc.deleteTempImages(jobId);
      } catch {
        // cron sẽ dọn ảnh tạm sau 3 ngày — không làm fail request đã thành công
      }
      return NextResponse.json({ url, fileName, saved: true });
    }
    // Chạy local không có Supabase: trả thẳng docx để tải về.
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': DOCX_MIME, 'Content-Disposition': `attachment; filename="${fileName}"` },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
