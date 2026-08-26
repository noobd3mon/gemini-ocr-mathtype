import { arrayBufferToBase64 } from './base64';
import { renderPdfToImages, computeRenderScale } from './pdf/render-pages';
import { ocrPdfWithGemini } from './providers/gemini';
import { ocrImagesWithOpenAI } from './providers/openai';
import { parseImageMarkers } from './markdown/markers';
import { markerToPixelRect, cutImageFromDataUrl, getImageDimensions } from './pdf/cut-image';
import type { Settings } from './settings-store';
import { markerKey } from './markdown/build-markdown';

export type OcrProgress = (msg: string) => void;

export async function runOcrGemini(file: File, settings: Settings, onProgress: OcrProgress): Promise<string> {
  onProgress('Đang đọc PDF...');
  const pdfBase64 = arrayBufferToBase64(await file.arrayBuffer());
  onProgress(`Đang OCR ${settings.geminiModel}...`);
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
  for (const m of markers) {
    const page = pageImages.find((p) => p.pageNumber === m.page);
    if (!page) continue;
    const dims = await getImageDimensions(page.dataUrl);
    const rect = markerToPixelRect(m, dims.width, dims.height);
    const url = await cutImageFromDataUrl(page.dataUrl, rect);
    images.set(markerKey(m), url);
  }
  return { images, count: images.size };
}
