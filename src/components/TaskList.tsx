'use client';
import type { OcrJobView } from '@/hooks/useOcrJobs';

interface Props {
  jobs: OcrJobView[];
  uploading: string | null;
  openId: string | null;
  onOpen: (job: OcrJobView) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'Đang chờ',
  running: 'Đang chạy',
  done: 'Xong ✓',
  error: 'Lỗi',
};

export function TaskList({ jobs, uploading, openId, onOpen, onCancel, onDelete }: Props) {
  if (jobs.length === 0 && !uploading) return null;
  return (
    <div className="task-list">
      {uploading && <div className="task-row task-row--uploading"><b>⏫ {uploading}</b><span className="mut">đang render + upload...</span></div>}
      {jobs.map((job) => {
        const active = job.status === 'queued' || job.status === 'running';
        const progress = active
          ? `nhóm ${Math.min(job.nextBatch + 1, job.totalBatches)}/${job.totalBatches}`
          : '';
        return (
          <div key={job.id} className={`task-row task-row--${job.status}${openId === job.id ? ' task-row--open' : ''}`}>
            <div className="task-main">
              <b title={job.fileName}>{job.fileName}</b>
              <span className={`task-status task-status--${job.status}`}>
                {STATUS_LABEL[job.status] ?? job.status}{progress ? ` · ${progress}` : ''}
              </span>
              {job.progressText && active && <span className="mut"> — {job.progressText}</span>}
              {job.status === 'error' && job.error && <span className="task-error"> — {job.error}</span>}
            </div>
            <div className="task-actions">
              {job.status === 'done' && (
                <button type="button" className="small" onClick={() => onOpen(job)}>
                  {openId === job.id ? 'Mở lại' : 'Mở kết quả'}
                </button>
              )}
              {active && <button type="button" className="small" onClick={() => onCancel(job.id)}>Huỷ</button>}
              {!active && <button type="button" className="small" onClick={() => onDelete(job.id)}>Xoá</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
