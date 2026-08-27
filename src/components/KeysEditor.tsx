'use client';

interface Props {
  label: string;
  keys: string[];
  placeholder?: string;
  onChange: (keys: string[]) => void;
}

export function KeysEditor({ label, keys, placeholder, onChange }: Props) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <textarea
        className="keys-textarea"
        value={keys.join('\n')}
        placeholder={placeholder ?? 'Một key mỗi dòng'}
        rows={4}
        spellCheck={false}
        // Keep empty segments so pressing Enter at the end registers —
        // filtering here would swallow the newline mid-typing.
        onChange={(e) => onChange(e.target.value.split('\n').map((k) => k.trim()))}
      />
      <span className="field-hint">{keys.filter((k) => k.trim()).length} key</span>
    </label>
  );
}
