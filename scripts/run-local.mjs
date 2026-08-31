// Chạy toàn bộ app local KHÔNG cần Supabase/Vercel/Render thật:
//   npm run local
// Nó khởi động 3 tiến trình (Ctrl+C để tắt hết):
//   [mock]   http://localhost:3961  — Supabase Storage giả (dữ liệu trong RAM)
//   [worker] http://localhost:3962   — worker OCR thật (gọi Gemini/OpenAI thật)
//   [app]    http://localhost:3943   — app Next.js thật
// Rồi mở http://localhost:3943, dán API key, thả PDF như bình thường.
// Pandoc tích hợp dùng bin/pandoc.exe (npm run predev tự tải nếu chưa có).
import { spawn } from 'node:child_process';

const COMMON = {
  ...process.env,
  SUPABASE_URL: 'http://localhost:3961',
  SUPABASE_SERVICE_ROLE_KEY: 'local-test-key',
  CRON_SECRET: 'local-cron-secret',
  OCR_WORKER_TOKEN: 'local-worker-token',
};

const procs = [];
function run(name, cmd, args, extraEnv) {
  const p = spawn(cmd, args, {
    env: { ...COMMON, ...extraEnv },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = (buf) => buf.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`).join('\n');
  p.stdout.on('data', (d) => console.log(tag(d)));
  p.stderr.on('data', (d) => console.error(tag(d)));
  p.on('exit', (code) => console.log(`[${name}] tiến trình thoát (mã ${code})`));
  procs.push(p);
}

console.log('Đang khởi động 3 tiến trình...\n');
run('mock', 'node', ['scripts/mock-supabase.mjs'], { PORT: '3961' });
run('worker', 'node', ['worker/server.mjs'], { PORT: '3962' });
run('app', 'npx', ['next', 'dev', '-p', '3943'], { OCR_WORKER_URL: 'http://localhost:3962' });

console.log(`
============================================================
  Mở http://localhost:3943 để dùng app.
  - API key Gemini/OpenAI: dùng key THẬT (app gọi provider thật).
  - Dữ liệu lưu trong RAM của mock — tắt là mất, không đụng Supabase thật.
  - Xuất Word dùng Pandoc tích hợp (bin/pandoc.exe).
  Ctrl+C để tắt tất cả.
============================================================
`);

process.on('SIGINT', () => {
  for (const p of procs) {
    try { p.kill(); } catch { /* ignore */ }
  }
  process.exit(0);
});
