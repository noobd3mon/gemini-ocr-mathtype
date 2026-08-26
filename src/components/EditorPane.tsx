'use client';

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function EditorPane({ value, onChange }: Props) {
  return (
    <div className="editor-pane">
      <textarea
        className="editor-textarea"
        value={value}
        spellCheck={false}
        placeholder="Markdown OCR sẽ xuất hiện ở đây. Bạn có thể sửa trước khi xuất."
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
