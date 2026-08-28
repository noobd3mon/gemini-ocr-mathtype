// Logic thuần của OCR worker — KHÔNG I/O, tự chứa (bản mirror của src/lib để
// worker deploy độc lập trên Render không cần build TypeScript).
// Nếu sửa prompt/logic OCR ở src/lib, nhớ đồng bộ tại đây.

export const GEMINI_API_BASE = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODEL_LADDER = ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'];

/** Chia trang thành các nhóm `per` trang, đánh số bắt đầu từ startPage (1-based). */
export function batchRanges(total, per, startPage = 1) {
  const ranges = [];
  for (let offset = 0; offset < total; offset += per) {
    const from = startPage + offset;
    ranges.push({ from, to: from + Math.min(per, total - offset) - 1 });
  }
  return ranges;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRateLimitError(err) {
  if (err && typeof err === 'object') {
    if (err.status === 429 || err.status === 503 || err.rateLimited === true) return true;
    return /rate.?limit|quota|too many request|resource.?exhausted/i.test(err.message ?? '');
  }
  return false;
}

export function isModelUnavailableError(err) {
  if (err && typeof err === 'object') {
    if (err.status === 404) return true;
    return /not found|is not supported/i.test(err.message ?? '');
  }
  return false;
}

/** Vòng xoay key đơn giản: đến lượt từng key, key 429 nghỉ 60s. */
export function makeKeyPool(keys) {
  let index = 0;
  const cooldowns = new Map();
  return {
    nextKey(now = Date.now()) {
      for (let i = 0; i < keys.length; i++) {
        index = index % keys.length;
        const key = keys[index];
        index += 1;
        const until = cooldowns.get(key) ?? 0;
        if (until <= now) return key;
      }
      return null; // mọi key đang cooldown
    },
    markRateLimited(key, now = Date.now()) {
      cooldowns.set(key, now + 60_000);
    },
    reset() {
      cooldowns.clear();
    },
  };
}

/** Xếp từ model khởi đầu xuống các model cũ hơn trong ladder. */
export function buildModelChain(start, ladder = GEMINI_MODEL_LADDER) {
  const idx = ladder.indexOf(start);
  return idx >= 0 ? ladder.slice(idx) : [start, ...ladder];
}

export function sniffImageMime(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
  return 'image/png';
}

const CORE_RULES = [
  'Bạn là công cụ OCR chuyên nghiệp. Hãy chuyển nội dung tài liệu thành Markdown thuần (plain Markdown), KHÔNG dùng code fence (không bọc toàn bộ kết quả trong ```).',
  '',
  'QUY TẮC BẮT BUỘC:',
  '1. Giữ nguyên ngôn ngữ của tài liệu (tiếng Việt giữ nguyên, không dịch).',
  '2. Giữ nguyên thứ tự và toàn bộ nội dung; không tóm tắt, không thêm ý kiến.',
  '3. Đầu mỗi trang ghi đúng một dòng: <!-- Trang N -->. Các ảnh được gửi theo thứ tự từ trang {FROM} đến trang {TO}: ảnh đầu tiên là trang {FROM}. Dùng SỐ TRANG THẬT trong <!-- Trang N --> và [[IMAGE:trang,...]].',
  '4. Công thức toán: công thức nội tuyến dùng $...$; công thức riêng một dòng dùng $$...$$. Viết LaTeX chuẩn (dùng \\frac, \\sqrt, \\int, \\sum, \\alpha, \\circ, \\text{...} khi cần).',
  '5. Bảng biểu: dùng bảng Markdown (pipe table) với dòng phân cách |---|. Ô chứa công thức dùng $...$.',
  '6. Chữ in đậm **...**, in nghiêng *...*; tiêu đề dùng # / ## / ### theo cấp độ.',
  '7. HÌNH ẢNH/BIỂU ĐỒ/ĐỒ THỊ: KHÔNG mô tả nội dung hình. Đặt đúng vị trí hình một marker:',
  '   [[IMAGE:trang,x1,y1,x2,y2|chú thích]]',
  '   trong đó trang là số trang; x1,y1 là góc trên-trái và x2,y2 là góc dưới-phải của hình,',
  '   tính theo PHẦN NGHÌN (permille) chiều rộng/chiều cao trang (giá trị từ 0 đến 1000).',
  '   Ví dụ hình nằm từ 20% đến 70% chiều rộng và từ 12% đến 65% chiều cao trang 1: [[IMAGE:1,200,120,700,650|Đồ thị]]',
  '8. Câu hỏi trắc nghiệm giữ nguyên nhãn (A., B., C., D. hoặc a), b), c), d)).',
];

/** Mirror của buildCorePrompt ở src/lib/providers/prompt.ts. */
export function buildCorePrompt({ extraPrompt, pageRange } = {}) {
  const lines = CORE_RULES.map((line) =>
    line
      .replaceAll('{FROM}', String(pageRange?.from ?? 1))
      .replaceAll('{TO}', String(pageRange?.to ?? 1)),
  );
  // Khi KHÔNG có pageRange (một trang đầu tiên), quy tắc 3 dùng dạng gốc "bắt đầu từ 1".
  if (!pageRange) {
    lines[5] = '3. Đầu mỗi trang ghi đúng một dòng: <!-- Trang N --> (N là số trang, bắt đầu từ 1).';
  }
  if (extraPrompt?.trim()) {
    lines.push('', 'YÊU CẦU BỔ SUNG TỪ NGƯỜI DÙNG:', extraPrompt.trim());
  }
  return lines.join('\n');
}
