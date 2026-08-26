import { buildExportMarkdown } from '@/lib/markdown/build-markdown';
import { convertMarkdownToDocx } from './pandoc';
import { convertMarkdownToMathTypeDocx } from './mathtype';
import { postprocessPandocDocx } from './postprocess';

export type ExportMode = 'equation' | 'mathtype';

export interface ExportWordOptions {
  markdown: string;
  images: Map<string, string>;
  mode: ExportMode;
  baseName: string;
  pandocUrl: string;
  mathTypeUrl: string;
  onProgress?: (msg: string) => void;
}

export interface ExportWordResult {
  blob: Blob;
  filename: string;
  converted: number;
  failed: number;
}

export function sanitizeFileName(name: string): string {
  const cleaned = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 80);
  return cleaned || 'tai_lieu_ocr';
}

export async function exportWord(opts: ExportWordOptions): Promise<ExportWordResult> {
  const finalMarkdown = buildExportMarkdown(opts.markdown, opts.images);
  const safeName = sanitizeFileName(opts.baseName);
  if (opts.mode === 'equation') {
    opts.onProgress?.('Đang gọi Pandoc chuyển Markdown → Word (OMML)...');
    const blob = await convertMarkdownToDocx(finalMarkdown, opts.pandocUrl);
    opts.onProgress?.('Đang chuẩn hóa font cho Word...');
    const processed = await postprocessPandocDocx(blob);
    return { blob: processed, filename: `${safeName}_equation.docx`, converted: 0, failed: 0 };
  }
  opts.onProgress?.('Đang gọi MathType chuyển công thức → OLE...');
  const result = await convertMarkdownToMathTypeDocx(finalMarkdown, opts.mathTypeUrl);
  return { blob: result.blob, filename: `${safeName}_mathtype.docx`, converted: result.converted, failed: result.failed };
}
