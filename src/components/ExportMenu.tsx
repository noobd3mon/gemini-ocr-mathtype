'use client';
import { useState } from 'react';
import { exportWord, sanitizeFileName, type ExportMode } from '@/lib/export/export-service';
import { buildExportMarkdown } from '@/lib/markdown/build-markdown';
import {
  ensureJobId, uploadImagesToJob, saveWordToServer, triggerDownload,
} from '@/lib/export/server-flow';

interface Props {
  markdown: string;
  images: Map<string, string>;
  baseName: string;
  pandocUrl: string;
  mathTypeUrl: string;
  onStatus: (msg: string) => void;
}

export function ExportMenu({ markdown, images, baseName, pandocUrl, mathTypeUrl, onStatus }: Props) {
  const [busy, setBusy] = useState(false);

  async function doExport(mode: ExportMode) {
    setBusy(true);
    try {
      if (mode === 'equation') {
        await exportEquation();
      } else {
        await exportMathType();
      }
    } catch (err) {
      onStatus(`Xuất thất bại: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  // Equation: ưu tiên máy chủ Pandoc tích hợp trong app (/api/pandoc — không giới hạn
  // 1 triệu ký tự, ảnh truyền dạng signed URL). Fallback: server Pandoc ngoài + ảnh
  // base64 (server ngoài không tải được ảnh từ URL — đã kiểm chứng).
  async function exportEquation() {
    const safeName = sanitizeFileName(baseName);
    const fileName = `${safeName}_equation.docx`;
    onStatus('Đang chuẩn bị ảnh...');

    const jobId = await ensureJobId();
    const urlImages = jobId ? await uploadImagesToJob(jobId, images) : null;

    if (jobId && urlImages) {
      try {
        onStatus('Đang chuyển Markdown → Word trên máy chủ tích hợp...');
        const res = await fetch('/api/pandoc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            markdown: buildExportMarkdown(markdown, urlImages),
            jobId,
            fileName,
          }),
        });
        if (res.ok) {
          const { url } = await res.json();
          onStatus(`Đã lưu. Tải trong 3 ngày: ${url}`);
          triggerDownload(url, fileName);
          return;
        }
        const { error } = await res.json().catch(() => ({ error: '' }));
        onStatus(`Máy chủ tích hợp lỗi (${error || res.status}) — chuyển sang server dự phòng...`);
      } catch {
        onStatus('Máy chủ tích hợp không phản hồi — chuyển sang server dự phòng...');
      }
    }

    onStatus('Đang xuất Word (Equation / OMML) qua server dự phòng...');
    const { blob, filename } = await exportWord({
      markdown, images, mode: 'equation', baseName, pandocUrl, mathTypeUrl, onProgress: onStatus,
    });
    triggerDownload(blob, filename);
    if (jobId) {
      onStatus('Đang lưu lên server (3 ngày)...');
      const url = await saveWordToServer(jobId, blob, filename);
      if (url) onStatus(`Đã lưu. Tải trong 3 ngày: ${url}`);
      else onStatus(`Đã tải ${filename} (không lưu được lên server).`);
    } else {
      onStatus(`Đã tải ${filename}.`);
    }
  }

  // MathType: server MathType không tải ảnh từ URL (kiểm chứng) — giữ ảnh base64.
  async function exportMathType() {
    onStatus('Đang xuất Word (MathType OLE)...');
    const { blob, filename, converted, failed } = await exportWord({
      markdown, images, mode: 'mathtype', baseName, pandocUrl, mathTypeUrl, onProgress: onStatus,
    });
    triggerDownload(blob, filename);

    const jobId = await ensureJobId();
    if (jobId) {
      onStatus('Đang lưu lên server (3 ngày)...');
      const url = await saveWordToServer(jobId, blob, filename);
      if (url) onStatus(`Đã lưu. Tải trong 3 ngày: ${url} (${converted} thành công, ${failed} lỗi).`);
      else onStatus(`Đã tải ${filename} (${converted} thành công, ${failed} lỗi) — không lưu được lên server.`);
    } else {
      onStatus(`Đã tải ${filename} (${converted} thành công, ${failed} lỗi).`);
    }
  }

  return (
    <div className="export-menu">
      <button type="button" disabled={busy || !markdown.trim()} onClick={() => doExport('equation')}>
        Xuất Word (Equation / OMML)
      </button>
      <button type="button" disabled={busy || !markdown.trim()} onClick={() => doExport('mathtype')}>
        Xuất Word (MathType OLE)
      </button>
    </div>
  );
}
