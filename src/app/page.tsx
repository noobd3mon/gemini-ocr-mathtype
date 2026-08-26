'use client';
import { useState } from 'react';
import { useSettings } from '@/hooks/useSettings';
import { SetupPanel } from '@/components/SetupPanel';
import { Dropzone } from '@/components/Dropzone';
import { StatsBar } from '@/components/StatsBar';

export default function Home() {
  const { settings, update } = useSettings();
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);

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
          <StatsBar characters={0} pages={0} formulas={0} images={0} />
          <p className="status">{status}</p>
          {/* Flows wired in Task 16: OCR run, cut+stage, export */}
        </section>
      </div>
    </main>
  );
}
