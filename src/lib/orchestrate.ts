import { arrayBufferToBase64 } from './base64';
import { renderPdfToImages, computeRenderScale } from './pdf/render-pages';
import { ocrPdfWithGemini } from './providers/gemini';
import { ocrImagesWithOpenAI } from './providers/openai';
import { parseImageMarkers } from './markdown/markers';
import { markerToPixelRect, cutImageFromDataUrl, loadImage } from './pdf/cut-image';
import type { Settings } from './settings-store';
import { markerKey } from './markdown/build-markdown';

export type OcrProgress = (msg: string) => void;

// Gemini inline requests cap total size around 20MB; 14MB PDF ≈ 18.7MB base64,
// leaving headroom for the prompt and JSON overhead.
const MAX_GEMINI_PDF_BYTES = 14 * 1024 * 1024;

export async function runOcrGemini(file: File, settings: Settings, onProgress: OcrProgress): Promise<string> {
  onProgress('Đang đọc PDF...');
  if (file.size > MAX_GEMINI_PDF_BYTES) {
    throw new Error(
      `PDF quá lớn để gửi trực tiếp tới Gemini (${(file.size / 1048576).toFixed(1)}MB > 14MB). ` +
      'Hãy tách file nhỏ hơn hoặc dùng chế độ OpenAI Completions.',
    );
  }
  const pdfBase64 = arrayBufferToBase64(await file.arrayBuffer());
  return ocrPdfWithGemini({
    pdfBase64,
    keys: settings.geminiKeys,
    model: settings.geminiModel,
    extraPrompt: settings.extraPrompt,
    onProgress,
    onRotated: ({ attempts }) => onProgress(`Rate-limited — chuyển key (lần ${attempts})...`),
  });
}

export async function runOcrOpenAI(
  file: File,
  settings: Settings,
  onProgress: OcrProgress,
): Promise<{ markdown: string; pageImages: { pageNumber: number; dataUrl: string }[] }> {
  onProgress('Đang render PDF thành ảnh...');
  const scale = computeRenderScale(settings.renderScale);
  const pages = await renderPdfToImages(await file.arrayBuffer(), {
    scale,
    maxPages: settings.maxPages,
    onProgress: (done, total) => onProgress(`Render trang ${done}/${total}...`),
  });
  const pageImages = pages.map((p) => ({ pageNumber: p.pageNumber, dataUrl: p.dataUrl }));
  onProgress(`Đang OCR ${pageImages.length} trang với ${settings.openaiModel}...`);
  const markdown = await ocrImagesWithOpenAI({
    pageImages: pageImages.map((p) => p.dataUrl),
    keys: settings.openaiKeys,
    baseUrl: settings.openaiBaseUrl,
    model: settings.openaiModel,
    maxTokens: settings.openaiMaxTokens ?? undefined,
    extraPrompt: settings.extraPrompt,
    onProgress,
    onRotated: ({ attempts }) => onProgress(`Rate-limited — chuyển key (lần ${attempts})...`),
  });
  return { markdown, pageImages };
}

export async function stageImages(
  markdown: string,
  pageImages: { pageNumber: number; dataUrl: string }[],
): Promise<{ images: Map<string, string>; count: number }> {
  const markers = parseImageMarkers(markdown);
  const images = new Map<string, string>();
  // Decode each page image once and reuse it for every marker on that page.
  const pageCache = new Map<number, { img: HTMLImageElement; width: number; height: number }>();
  for (const m of markers) {
    const page = pageImages.find((p) => p.pageNumber === m.page);
    if (!page) continue;
    let entry = pageCache.get(m.page);
    if (!entry) {
      const img = await loadImage(page.dataUrl);
      entry = { img, width: img.naturalWidth, height: img.naturalHeight };
      pageCache.set(m.page, entry);
    }
    const rect = markerToPixelRect(m, entry.width, entry.height);
    const url = await cutImageFromDataUrl(page.dataUrl, rect, entry.img);
    images.set(markerKey(m), url);
  }
  return { images, count: images.size };
}
