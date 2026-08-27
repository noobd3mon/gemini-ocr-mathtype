'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { useOcrJobs, type OcrJobView } from '@/hooks/useOcrJobs';
import { SetupPanel } from '@/components/SetupPanel';
import { Dropzone } from '@/components/Dropzone';
import { StatsBar } from '@/components/StatsBar';
import { TaskList } from '@/components/TaskList';
import { EditorPane } from '@/components/EditorPane';
import { PreviewPane } from '@/components/PreviewPane';
import { ExportMenu } from '@/components/ExportMenu';
import { countCharacters, countPages, countFormulas, countDataUriImages, parseImageMarkers } from '@/lib/markdown/markers';

export default function Home() {
  const { settings, update } = useSettings();
  const { jobs, uploading, status, setStatus, enqueueFiles, openResult, cancelJob, deleteJob } = useOcrJobs();
  const [openId, setOpenId] = useState<string | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [pandocUrl, setPandocUrl] = useState('https://pandoc-server.onrender.com/convert');
  const [mathTypeUrl, setMathTypeUrl] = useState('https://latex2mathtypeweb.onrender.com');
  const [busy, setBusy] = useState(false);

  // Fetch runtime config once on mount
  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        if (c.pandocUrl) setPandocUrl(c.pandocUrl);
        if (c.mathTypeUrl) setMathTypeUrl(c.mathTypeUrl);
      })
      .catch(() => {});
  }, []);

  const markers = useMemo(() => parseImageMarkers(markdown), [markdown]);
  const stats = useMemo(
    () => ({
      characters: countCharacters(markdown),
      pages: countPages(markdown),
      formulas: countFormulas(markdown),
      images: countDataUriImages(markdown) + markers.length,
    }),
    [markdown, markers],
  );

  async function handleFiles(files: File[]) {
    setBusy(true);
    await enqueueFiles(files, settings);
    setBusy(false);
  }

  async function handleOpen(job: OcrJobView) {
    setBusy(true);
    setStatus(`Đang tải kết quả ${job.fileName}...`);
    try {
      const result = await openResult(job);
      if (result) {
        setMarkdown(result.markdown);
        setImages(result.images);
        setOpenId(job.id);
        setStatus('Đã mở kết quả — có thể sửa Markdown rồi xuất Word.');
      } else {
        setStatus('Kết quả trống.');
      }
    } catch (err) {
      setStatus(`Không mở được kết quả: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>OCR PDF → Word</h1>
        <p className="subtitle">Gemini / OpenAI · chạy nền trên server · Pandoc · MathType · Supabase</p>
      </header>
      <div className="layout">
        <SetupPanel settings={settings} update={update} />
        <section className="panel work-panel">
          <h2>Tài liệu</h2>
          <Dropzone onFiles={handleFiles} disabled={busy} />
          <p className="hint">Task chạy trên server — sau khi upload xong (mỗi file hiện dòng “upload…/trang”) bạn có thể đóng tab hoặc rời đi; quay lại là thấy tiến độ. Tab đang mở sẽ có âm thanh + thông báo khi xong.</p>
          <TaskList
            jobs={jobs}
            uploading={uploading}
            openId={openId}
            onOpen={handleOpen}
            onCancel={(id) => { void cancelJob(id); }}
            onDelete={(id) => { void deleteJob(id); if (openId === id) { setOpenId(null); setMarkdown(''); setImages(new Map()); } }}
          />
          <StatsBar {...stats} />
          <p className="status">{status}</p>
          {markdown && (
            <>
              <ExportMenu markdown={markdown} images={images} baseName={settings.baseName} pandocUrl={pandocUrl} mathTypeUrl={mathTypeUrl} onStatus={setStatus} />
              <div className="panes">
                <EditorPane value={markdown} onChange={setMarkdown} />
                <PreviewPane markdown={markdown} images={images} />
              </div>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
