export type RenderScaleChoice = '1.5' | '2' | '2.5' | '3';
export const RENDER_SCALE_OPTIONS: RenderScaleChoice[] = ['1.5', '2', '2.5', '3'];

export function computeRenderScale(choice: string): number {
  const n = Number(choice);
  return Number.isFinite(n) && n >= 0.5 && n <= 4 ? n : 2;
}

export function clampPageCount(totalPages: number, maxPages: number): number {
  const max = Math.max(1, Math.floor(maxPages));
  return Math.max(1, Math.min(totalPages, max));
}

export interface RenderedPage {
  pageNumber: number;
  dataUrl: string;
  width: number;
  height: number;
}

export async function renderPdfToImages(
  data: ArrayBuffer,
  opts: { scale: number; maxPages: number; onProgress?: (done: number, total: number) => void },
): Promise<RenderedPage[]> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const total = clampPageCount(doc.numPages, opts.maxPages);
  const pages: RenderedPage[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: opts.scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Không tạo được canvas render PDF.');
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push({
      pageNumber: i,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });
    opts.onProgress?.(i, total);
  }
  return pages;
}
