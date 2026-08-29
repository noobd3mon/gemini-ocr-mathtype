// Trạng thái job OCR chạy trên server, lưu ở bucket `ocr-jobs/{jobId}/state.json`.
// KEY API chỉ tồn tại trong state khi job đang chạy: bị xoá ngay khi done/error/
// cancel, và cron quét dọn các job treo quá hạn.

export type OcrJobStatus = 'queued' | 'running' | 'done' | 'error';

export interface OcrJobState {
  status: OcrJobStatus;
  fileName: string;
  pageCount: number;
  provider: 'gemini' | 'openai';
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  extraPrompt?: string;
  /** Key API dùng tạm trong lúc job chạy — xoá khi done/error/cancel. */
  keys?: string[];
  /** Số trang mỗi bước server xử lý (job mới = 1; job cũ không có field = 2). */
  pagesPerStep?: number;
  /** Nhóm trang kế tiếp cần xử lý (mỗi nhóm = pagesPerStep trang). */
  nextBatch: number;
  /** Markdown của các nhóm đã hoàn tất. */
  chunks: string[];
  progressText?: string;
  error?: string;
  /** Số lần liên tiếp chờ-thử lại vì rate-limit/network chậm (reset về 0 khi một trang thành công). */
  retryWaits?: number;
  /** Lock chống bước chạy song song (epoch ms). */
  lockUntil?: number;
  createdAt: number;
  updatedAt: number;
}

/**
 * Số trang mỗi bước server xử lý cho job MỚI. 1 trang/bước để mỗi bước luôn gọn
 * giới hạn 60s/function của Vercel — 2 trang dày đặc + ảnh PNG lớn dễ vượt mốc
 * khiến bước bị kill và job treo mãi không xong. Job cũ (trước khi có field này)
 * mặc định 2 để giữ đúng ngữ nghĩa của nextBatch/chunks đã lưu.
 */
export const SERVER_PAGES_PER_STEP = 1;

/** Trần số lần chờ-thử lại liên tiếp trong một bước trước khi báo lỗi (30 × ~45s ≈ 20 phút). */
export const MAX_STEP_RETRY_WAITS = 30;

export function batchPageRange(batch: number, pageCount: number, per: number): { from: number; to: number } | null {
  const from = batch * per;
  if (from >= pageCount) return null;
  return { from, to: Math.min(from + per, pageCount) - 1 };
}

export function totalBatches(pageCount: number, per: number): number {
  return Math.ceil(pageCount / per);
}

export function isOcrJobState(raw: unknown): raw is OcrJobState {
  if (!raw || typeof raw !== 'object') return false;
  const s = raw as Partial<OcrJobState>;
  return (
    typeof s.status === 'string' &&
    typeof s.fileName === 'string' &&
    typeof s.pageCount === 'number' &&
    typeof s.nextBatch === 'number' &&
    Array.isArray(s.chunks)
  );
}

/** Trả state an toàn cho client — tuyệt đối không lộ keys. */
export function publicOcrJobView(state: OcrJobState): {
  status: OcrJobStatus; fileName: string; pageCount: number; nextBatch: number;
  totalBatches: number; progressText?: string; error?: string; markdown?: string;
  provider: string; model: string; updatedAt: number;
} {
  const per = state.pagesPerStep ?? 2; // job cũ trước khi có pagesPerStep
  return {
    status: state.status,
    fileName: state.fileName,
    pageCount: state.pageCount,
    nextBatch: state.nextBatch,
    totalBatches: totalBatches(state.pageCount, per),
    progressText: state.progressText,
    error: state.error,
    markdown: state.status === 'done' ? state.chunks.join('\n\n') : undefined,
    provider: state.provider,
    model: state.model,
    updatedAt: state.updatedAt,
  };
}
