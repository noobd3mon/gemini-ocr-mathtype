'use client';
import { GEMINI_MODELS, type Settings } from '@/lib/settings-store';
import { KeysEditor } from './KeysEditor';

interface Props {
  settings: Settings;
  update: (partial: Partial<Settings>) => void;
}

export function SetupPanel({ settings, update }: Props) {
  return (
    <section className="panel setup-panel">
      <h2>Cấu hình</h2>
      <div className="provider-toggle">
        <button
          type="button"
          className={settings.provider === 'gemini' ? 'active' : ''}
          onClick={() => update({ provider: 'gemini' })}
        >Gemini API</button>
        <button
          type="button"
          className={settings.provider === 'openai' ? 'active' : ''}
          onClick={() => update({ provider: 'openai' })}
        >OpenAI Completions</button>
      </div>

      {settings.provider === 'gemini' ? (
        <>
          <KeysEditor
            label="Gemini API Keys"
            keys={settings.geminiKeys}
            placeholder="AIza... mỗi dòng một key"
            onChange={(geminiKeys) => update({ geminiKeys })}
          />
          <label className="field">
            <span className="field-label">Model</span>
            <select value={settings.geminiModel} onChange={(e) => update({ geminiModel: e.target.value })}>
              {GEMINI_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </>
      ) : (
        <>
          <KeysEditor
            label="OpenAI API Keys"
            keys={settings.openaiKeys}
            placeholder="sk-... mỗi dòng một key"
            onChange={(openaiKeys) => update({ openaiKeys })}
          />
          <label className="field">
            <span className="field-label">Base URL</span>
            <input
              type="url"
              value={settings.openaiBaseUrl}
              placeholder="https://api.example.com/v1"
              onChange={(e) => update({ openaiBaseUrl: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Model</span>
            <input
              type="text"
              value={settings.openaiModel}
              placeholder="gpt-4o"
              onChange={(e) => update({ openaiModel: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="field-label">Max tokens (tùy chọn)</span>
            <input
              type="number"
              min={0}
              value={settings.openaiMaxTokens ?? ''}
              placeholder="để trống = mặc định"
              onChange={(e) => update({ openaiMaxTokens: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
        </>
      )}

      <label className="field">
        <span className="field-label">Số trang tối đa</span>
        <input
          type="number"
          min={1}
          max={200}
          value={settings.maxPages}
          onChange={(e) => update({ maxPages: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span className="field-label">Độ phân giải render</span>
        <select value={settings.renderScale} onChange={(e) => update({ renderScale: e.target.value as Settings['renderScale'] })}>
          <option value="1.5">1.5x</option>
          <option value="2">2x</option>
          <option value="2.5">2.5x</option>
          <option value="3">3x</option>
        </select>
      </label>
      <label className="field">
        <span className="field-label">Hướng dẫn thêm (tùy chọn)</span>
        <textarea
          rows={3}
          value={settings.extraPrompt}
          placeholder="Bổ sung yêu cầu cho mô hình..."
          onChange={(e) => update({ extraPrompt: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">Tên file xuất</span>
        <input
          type="text"
          value={settings.baseName}
          onChange={(e) => update({ baseName: e.target.value })}
        />
      </label>
    </section>
  );
}
