'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { SetupPanel } from '@/components/SetupPanel';
import { Dropzone } from '@/components/Dropzone';
import { StatsBar } from '@/components/StatsBar';
import { EditorPane } from '@/components/EditorPane';
import { PreviewPane } from '@/components/PreviewPane';
import { ExportMenu } from '@/components/ExportMenu';
import { runOcrGemini, runOcrOpenAI, stageImages } from '@/lib/orchestrate';
import { countCharacters, countPages, countFormulas, countDataUriImages, parseImageMarkers } from '@/lib/markdown/markers';
import { renderPdfToImages, computeRenderScale } from '@/lib/pdf/render-pages';

export default function Home() {
  const { settings, update } = useSettings();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [markdown, setMarkdown] = useState('');
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pandocUrl, setPandocUrl] = useState('https://pandoc-server.onrender.com/convert');
  const [mathTypeUrl, setMathTypeUrl] = useState('https://latex2mathtypeweb.onrender.com');

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

  async function runOcr() {
    if (!pdfFile) return;
    if (settings.provider === 'gemini' && settings.geminiKeys.filter((k) => k.trim()).length === 0) { setStatus('Nhập ít nhất một Gemini API key.'); return; }
    if (settings.provider === 'openai' && settings.openaiKeys.filter((k) => k.trim()).length === 0) { setStatus('Nhập ít nhất một OpenAI API key.'); return; }
    setBusy(true); setStatus('');
    try {
      let md: string;
      let pageImages: { pageNumber: number; dataUrl: string }[] = [];
      if (settings.provider === 'gemini') {
        md = await runOcrGemini(pdfFile, settings, setStatus);
      } else {
        const r = await runOcrOpenAI(pdfFile, settings, setStatus);
        md = r.markdown; pageImages = r.pageImages;
      }
      setMarkdown(md);
      const ms = parseImageMarkers(md);
      if (ms.length > 0) {
        if (pageImages.length === 0 && settings.provider === 'gemini') {
          const pages = await renderPdfToImages(await pdfFile.arrayBuffer(), {
            scale: computeRenderScale(settings.renderScale),
            maxPages: settings.maxPages,
          });
          pageImages = pages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }));
        }
        setStatus(`Đang cắt ${ms.length} ảnh từ ${pageImages.length} trang...`);
        const { images: staged } = await stageImages(md, pageImages);
        setImages(staged);
      }
      setStatus('OCR hoàn tất.');
    } catch (err) {
      setStatus(`Lỗi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header className="app-header">
        <h1>OCR PDF → Word</h1>
        <p className="subtitle">Gemini / OpenAI · Pandoc · MathType · Supabase</p>
      </header>
      <div className="layout">
        <SetupPanel settings={settings} update={update} />
        <section className="panel work-panel">
          <h2>Tài liệu</h2>
          <Dropzone onFile={setPdfFile} disabled={busy} />
          {pdfFile && <p className="file-name">{pdfFile.name} ({(pdfFile.size / 1024).toFixed(0)} KB)</p>}
          <div className="actions">
            <button type="button" disabled={busy || !pdfFile} onClick={runOcr}>{busy ? 'Đang xử lý...' : 'Chạy OCR'}</button>
          </div>
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
