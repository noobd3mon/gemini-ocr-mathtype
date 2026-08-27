'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { renderPdfToImages, computeRenderScale } from '@/lib/pdf/render-pages';
import { stageImages } from '@/lib/orchestrate';
import { dataUrlToBlob, blobToDataUrl } from '@/lib/base64';
import type { Settings } from '@/lib/settings-store';
import type { OcrJobStatus } from '@/lib/ocr-job-state';

export interface OcrJobView {
  id: string;
  status: OcrJobStatus;
  fileName: string;
  pageCount: number;
  nextBatch: number;
  totalBatches: number;
  progressText?: string;
  error?: string;
  markdown?: string;
  provider: string;
  model: string;
  updatedAt: number;
}

const JOB_INDEX_KEY = 'aiomt_ocr_jobs_v1';
const POLL_MS = 4000;

interface IndexEntry { id: string; createdAt: number }

function readIndex(): IndexEntry[] {
  try {
    const raw = localStorage.getItem(JOB_INDEX_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((e) => e && typeof e.id === 'string') : [];
  } catch {
    return [];
  }
}

function writeIndex(entries: IndexEntry[]): void {
  try { localStorage.setItem(JOB_INDEX_KEY, JSON.stringify(entries.slice(-100))); } catch { /* ignore */ }
}

function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, ctx.currentTime);
    osc.start();
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => { ctx.close().catch(() => {}); }, 500);
  } catch { /* ignore */ }
}

async function pollJob(id: string): Promise<OcrJobView | null> {
  try {
    const res = await fetch(`/api/ocr-jobs/${id}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as OcrJobView;
  } catch {
    return null;
  }
}

function requestNotifyPermission(): void {
  try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') void Notification.requestPermission(); } catch { /* ignore */ }
}

function notifyDone(title: string, body: string): void {
  try {
    if (document.hidden) beep();
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch { /* ignore */ }
}

export function useOcrJobs() {
  const [jobs, setJobs] = useState<OcrJobView[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  const jobsRef = useRef<OcrJobView[]>([]);
  const hydratedRef = useRef(false);

  jobsRef.current = jobs;

  const merge = useCallback((view: OcrJobView) => {
    setJobs((prev) => {
      const i = prev.findIndex((j) => j.id === view.id);
      if (i === -1) return [...prev, view];
      const next = prev.slice();
      next[i] = view;
      return next;
    });
  }, []);

  // Hydrate danh sách job từ localStorage khi mở trang (kể cả job đã chạy từ phiên trước).
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    const idx = readIndex();
    if (idx.length === 0) return;
    (async () => {
      const views = await Promise.all(idx.map((e) => pollJob(e.id)));
      const alive = views.filter((v): v is OcrJobView => v !== null);
      const deadIds = idx.filter((e, i) => views[i] === null).map((e) => e.id);
      if (deadIds.length) writeIndex(idx.filter((e) => !deadIds.includes(e.id)));
      setJobs(alive);
    })();
  }, []);

  // Poll định kỳ các job đang chạy — server tự nối bước, tab có thể đóng.
  useEffect(() => {
    const timer = setInterval(async () => {
      const active = jobsRef.current.filter((j) => j.status === 'queued' || j.status === 'running');
      if (active.length === 0) return;
      const views = await Promise.all(active.map((j) => pollJob(j.id)));
      for (const view of views) {
        if (!view) continue;
        const before = jobsRef.current.find((j) => j.id === view.id);
        if (before && before.status !== 'done' && view.status === 'done') {
          notifyDone('OCR hoàn tất ✓', `${view.fileName} — ${view.pageCount} trang. Quay lại app để mở kết quả.`);
        }
        if (before && before.status !== 'error' && view.status === 'error') {
          notifyDone('OCR gặp lỗi ✗', `${view.fileName}: ${view.error ?? 'không rõ'}`);
        }
        merge(view);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [merge]);

  // Tiêu đề tab hiển thị tiến độ khi đang ở tab khác.
  useEffect(() => {
    const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
    document.title = active > 0 || uploading
      ? `(${active || 0} đang chạy) OCR PDF → Word`
      : 'OCR PDF → Word';
  }, [jobs, uploading]);

  const enqueueFiles = useCallback(async (files: File[], settings: Settings) => {
    requestNotifyPermission();
    const keys = (settings.provider === 'gemini' ? settings.geminiKeys : settings.openaiKeys).filter((k) => k.trim());
    if (keys.length === 0) { setStatus(`Nhập ít nhất một ${settings.provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key trước khi thêm task.`); return; }
    if (settings.provider === 'openai' && !settings.openaiBaseUrl.trim()) { setStatus('Nhập Base URL cho OpenAI trước khi thêm task.'); return; }

    for (const file of files) {
      try {
        setUploading(file.name);
        setStatus(`Đang render ${file.name} thành ảnh...`);
        const pages = await renderPdfToImages(await file.arrayBuffer(), {
          scale: computeRenderScale(settings.renderScale),
          maxPages: settings.maxPages,
          onProgress: (done, total) => setStatus(`Render ${file.name}: ${done}/${total} trang...`),
        });

        setStatus(`Đang tạo task cho ${file.name}...`);
        const createRes = await fetch('/api/ocr-jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: file.name,
            pageCount: pages.length,
            provider: settings.provider,
            model: settings.provider === 'gemini' ? settings.geminiModel : settings.openaiModel,
            baseUrl: settings.provider === 'openai' ? settings.openaiBaseUrl : undefined,
            maxTokens: settings.provider === 'openai' ? settings.openaiMaxTokens ?? undefined : undefined,
            extraPrompt: settings.extraPrompt || undefined,
            keys,
          }),
        });
        if (!createRes.ok) {
          const { error } = await createRes.json().catch(() => ({ error: 'lỗi không rõ' }));
          setStatus(`Không tạo được task cho ${file.name}: ${error}`);
          continue;
        }
        const { jobId } = (await createRes.json()) as { jobId: string };

        let uploadFailed = false;
        for (let i = 0; i < pages.length; i++) {
          const form = new FormData();
          form.append('images[]', dataUrlToBlob(pages[i].dataUrl), `${i}.png`);
          const res = await fetch(`/api/jobs/${jobId}/upload-urls`, { method: 'POST', body: form });
          if (!res.ok) {
            uploadFailed = true;
            break;
          }
          setStatus(`Upload ${file.name}: ${i + 1}/${pages.length} trang...`);
        }
        if (uploadFailed) {
          await fetch(`/api/ocr-jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
          setStatus(`Upload ảnh thất bại — đã huỷ task ${file.name}. Kiểm tra kết nối/Supabase rồi thử lại.`);
          continue;
        }

        await fetch(`/api/ocr-jobs/${jobId}/start`, { method: 'POST' });
        writeIndex([...readIndex(), { id: jobId, createdAt: Date.now() }]);
        const view = await pollJob(jobId);
        if (view) merge(view);
        setStatus(`Đã thêm task ${file.name} — server đang chạy. Bạn có thể rời tab làm việc khác.`);
      } catch (err) {
        setStatus(`Lỗi khi thêm ${file.name}: ${(err as Error).message}`);
      } finally {
        setUploading(null);
      }
    }
  }, []);

  /** Tải kết quả + các trang về, cắt ảnh hình → nạp vào editor/preview. */
  const openResult = useCallback(async (job: OcrJobView): Promise<{ markdown: string; images: Map<string, string> } | null> => {
    if (!job.markdown) return null;
    const res = await fetch(`/api/ocr-jobs/${job.id}/page-urls?pageCount=${job.pageCount}`);
    if (!res.ok) throw new Error('Không lấy được danh sách trang.');
    const { urls } = (await res.json()) as { urls: string[] };
    const pageImages: { pageNumber: number; dataUrl: string }[] = [];
    for (let i = 0; i < Math.min(urls.length, job.pageCount); i++) {
      const imgRes = await fetch(urls[i]);
      if (!imgRes.ok) continue;
      pageImages.push({ pageNumber: i + 1, dataUrl: await blobToDataUrl(await imgRes.blob()) });
    }
    const { images } = await stageImages(job.markdown, pageImages);
    return { markdown: job.markdown, images };
  }, []);

  const cancelJob = useCallback(async (id: string) => {
    await fetch(`/api/ocr-jobs/${id}/cancel`, { method: 'POST' }).catch(() => {});
    const view = await pollJob(id);
    if (view) merge(view);
  }, [merge]);

  const deleteJob = useCallback(async (id: string) => {
    await fetch(`/api/ocr-jobs/${id}`, { method: 'DELETE' }).catch(() => {});
    writeIndex(readIndex().filter((e) => e.id !== id));
    setJobs((prev) => prev.filter((j) => j.id !== id));
  }, []);

  return { jobs, uploading, status, setStatus, enqueueFiles, openResult, cancelJob, deleteJob };
}
