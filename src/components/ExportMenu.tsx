'use client';
import { useState } from 'react';
import { exportWord, type ExportMode } from '@/lib/export/export-service';

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
      onStatus(`Đang xuất Word (${mode})...`);
      const { blob, filename, converted, failed } = await exportWord({
        markdown, images, mode, baseName, pandocUrl, mathTypeUrl, onProgress: onStatus,
      });

      let saved = false;
      try {
        onStatus('Đang lưu lên server (3 ngày)...');
        const form = new FormData();
        form.append('file', blob, filename);
        form.append('fileName', filename);
        const createJob = await fetch('/api/jobs', { method: 'POST' });
        if (createJob.ok) {
          const { jobId } = await createJob.json();
          const finalizeRes = await fetch(`/api/jobs/${jobId}/finalize`, { method: 'POST', body: form });
          if (finalizeRes.ok) {
            const { url } = await finalizeRes.json();
            onStatus(`Đã lưu. Tải trong 3 ngày: ${url}`);
            const a = document.createElement('a');
            a.href = url; a.download = filename; a.click();
            saved = true;
          }
        }
      } catch (err) {
        onStatus(`Lưu server thất bại — tải trực tiếp. (${(err as Error).message})`);
      }

      if (!saved) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
        onStatus(`Đã tải ${filename}${mode === 'mathtype' ? ` (${converted} thành công, ${failed} lỗi)` : ''}.`);
      }
    } catch (err) {
      onStatus(`Xuất thất bại: ${(err as Error).message}`);
    } finally {
      setBusy(false);
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
