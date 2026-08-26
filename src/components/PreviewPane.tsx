'use client';
import { useMemo } from 'react';
import { renderMarkdownPreview } from '@/lib/preview/md-html';

interface Props {
  markdown: string;
  images: Map<string, string>;
}

export function PreviewPane({ markdown, images }: Props) {
  const { html, truncated } = useMemo(
    () => renderMarkdownPreview(markdown, { images }),
    [markdown, images],
  );
  return (
    <div className="preview-pane">
      {truncated && <div className="truncation-note">Nội dung dài — đang xem trước 300K kí tự đầu.</div>}
      <div className="preview-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
