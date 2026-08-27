// Tải Pandoc binary cho nền hiện tại — chạy tự động qua prebuild/predev.
//  - Windows (dev):    bin/pandoc.exe
//  - Linux (Vercel):   bin/pandoc.gz (binary nén gzip ~33MB; route /api/pandoc giải nén
//                      ra /tmp lúc chạy để gói function ở dưới giới hạn 250MB của Vercel)
import { copyFileSync, createWriteStream, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
import os from 'node:os';

const PANDOC_VERSION = '3.10.2';
const BASE = `https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}`;
const binDir = path.join(process.cwd(), 'bin');
mkdirSync(binDir, { recursive: true });

function bigEnough(p, min = 10 * 1024 * 1024) {
  try { return statSync(p).size >= min; } catch { return false; }
}

async function download(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Tải ${url} thất bại: HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
}

function extract(archive, destDir) {
  // GNU tar (Git Bash trên Windows) hiểu "C:\..." là remote host → trên Windows
  // gọi thẳng bsdtar của hệ thống (C:\Windows\System32\tar.exe, đọc được cả .zip).
  const tar = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
}

function findFile(root, name) {
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries = [];
    try { entries = readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === name) return full;
    }
  }
  return null;
}

function mktemp() {
  const dir = path.join(os.tmpdir(), `pandoc-fetch-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

if (process.platform === 'win32') {
  const exe = path.join(binDir, 'pandoc.exe');
  if (bigEnough(exe)) {
    console.log('[fetch-pandoc] Đã có bin/pandoc.exe — bỏ qua.');
  } else {
    const tmp = mktemp();
    const zip = path.join(tmp, 'pandoc.zip');
    console.log(`[fetch-pandoc] Đang tải pandoc ${PANDOC_VERSION} cho Windows...`);
    await download(`${BASE}/pandoc-${PANDOC_VERSION}-windows-x86_64.zip`, zip);
    extract(zip, tmp);
    const extracted = findFile(tmp, 'pandoc.exe');
    if (!extracted) throw new Error('Không tìm thấy pandoc.exe trong bản tải về.');
    copyFileSync(extracted, exe); // temp và project có thể khác ổ đĩa → copy thay vì rename
    rmSync(tmp, { recursive: true, force: true });
    console.log('[fetch-pandoc] Xong:', exe, `(${Math.round(statSync(exe).size / 1048576)}MB)`);
  }
} else {
  const gz = path.join(binDir, 'pandoc.gz');
  if (bigEnough(gz)) {
    console.log('[fetch-pandoc] Đã có bin/pandoc.gz — bỏ qua.');
  } else {
    const tmp = mktemp();
    const tgz = path.join(tmp, 'pandoc.tar.gz');
    console.log(`[fetch-pandoc] Đang tải pandoc ${PANDOC_VERSION} cho Linux...`);
    await download(`${BASE}/pandoc-${PANDOC_VERSION}-linux-amd64.tar.gz`, tgz);
    extract(tgz, tmp);
    const extracted = findFile(tmp, 'pandoc');
    if (!extracted) throw new Error('Không tìm thấy binary pandoc trong bản tải về.');
    // Chỉ giữ bản nén gzip (~33MB) — raw binary ~180MB sẽ vượt giới hạn 250MB của Vercel.
    writeFileSync(gz, gzipSync(readFileSync(extracted)));
    rmSync(tmp, { recursive: true, force: true });
    console.log('[fetch-pandoc] Xong:', gz, `(${Math.round(statSync(gz).size / 1048576)}MB nén)`);
  }
}
