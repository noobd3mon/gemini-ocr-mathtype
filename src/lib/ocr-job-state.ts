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
  /** Nhóm trang kế tiếp cần xử lý (mỗi nhóm = SERVER_PAGES_PER_STEP trang). */
  nextBatch: number;
  /** Markdown của các nhóm đã hoàn tất. */
  chunks: string[];
  progressText?: string;
  error?: string;
  /** Lock chống bước chạy song song (epoch ms). */
  lockUntil?: number;
  createdAt: number;
  updatedAt: number;
}

/** Số trang mỗi bước server xử lý — giữ nhỏ để luôn gọn giới hạn 60s/function. */
export const SERVER_PAGES_PER_STEP = 2;

export function batchPageRange(batch: number, pageCount: number): { from: number; to: number } | null {
  const from = batch * SERVER_PAGES_PER_STEP;
  if (from >= pageCount) return null;
  return { from, to: Math.min(from + SERVER_PAGES_PER_STEP, pageCount) - 1 };
}

export function totalBatches(pageCount: number): number {
  return Math.ceil(pageCount / SERVER_PAGES_PER_STEP);
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
  return {
    status: state.status,
    fileName: state.fileName,
    pageCount: state.pageCount,
    nextBatch: state.nextBatch,
    totalBatches: totalBatches(state.pageCount),
    progressText: state.progressText,
    error: state.error,
    markdown: state.status === 'done' ? state.chunks.join('\n\n') : undefined,
    provider: state.provider,
    model: state.model,
    updatedAt: state.updatedAt,
  };
}
