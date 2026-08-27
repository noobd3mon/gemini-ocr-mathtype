import type { ImageMarker } from '@/lib/markdown/markers';

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clampRect(rect: PixelRect, maxW: number, maxH: number): PixelRect {
  const x = Math.max(0, Math.min(rect.x, maxW - 1));
  const y = Math.max(0, Math.min(rect.y, maxH - 1));
  const w = Math.max(1, Math.min(rect.w, maxW - x));
  const h = Math.max(1, Math.min(rect.h, maxH - y));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

export function markerToPixelRect(m: ImageMarker, pageWidth: number, pageHeight: number): PixelRect {
  const left = Math.min(m.x1, m.x2);
  const right = Math.max(m.x1, m.x2);
  const top = Math.min(m.y1, m.y2);
  const bottom = Math.max(m.y1, m.y2);
  const x = (left / 1000) * pageWidth;
  const y = (top / 1000) * pageHeight;
  const w = ((right - left) / 1000) * pageWidth;
  const h = ((bottom - top) / 1000) * pageHeight;
  return clampRect({ x, y, w, h }, pageWidth, pageHeight);
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không tải được ảnh trang để cắt.'));
    img.src = src;
  });
}

export async function cutImageFromDataUrl(dataUrl: string, rect: PixelRect, image?: HTMLImageElement): Promise<string> {
  const img = image ?? (await loadImage(dataUrl));
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Không tạo được canvas cắt ảnh.');
  // White background so transparent regions never turn black inside Word.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  return canvas.toDataURL('image/png');
}

export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Không đọc được kích thước ảnh.'));
    img.src = dataUrl;
  });
}
