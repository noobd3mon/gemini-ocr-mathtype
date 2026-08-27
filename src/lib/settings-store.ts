export type ProviderMode = 'gemini' | 'openai';

export interface Settings {
  provider: ProviderMode;
  geminiKeys: string[];
  openaiKeys: string[];
  openaiBaseUrl: string;
  openaiModel: string;
  openaiMaxTokens: number | null;
  geminiModel: string;
  maxPages: number;
  renderScale: '1.5' | '2' | '2.5' | '3';
  extraPrompt: string;
  baseName: string;
}

// Xếp từ mới nhất xuống cũ nhất. Khi mọi key đều bị rate-limit ở model đang
// dùng, app tự lùi xuống model kế tiếp với cùng các key (hạn mức Gemini tính
// theo model nên key vừa bị giới hạn ở model cũ vẫn dùng được model kế).
export const GEMINI_MODELS: string[] = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
];

export const DEFAULT_SETTINGS: Settings = {
  provider: 'gemini',
  geminiKeys: [],
  openaiKeys: [],
  openaiBaseUrl: '',
  openaiModel: 'gpt-4o',
  openaiMaxTokens: null,
  geminiModel: 'gemini-3.7-flash',
  maxPages: 30,
  renderScale: '2',
  extraPrompt: '',
  baseName: 'tai_lieu_ocr',
};

export const STORAGE_KEY = 'aiomt_settings_v1';

const RENDER_SCALES = ['1.5', '2', '2.5', '3'];

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function asString(raw: unknown, fallback: string): string {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : fallback;
}

function asNumber(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const o = raw as Record<string, unknown>;

  const provider: ProviderMode = o.provider === 'openai' ? 'openai' : 'gemini';
  const maxPages = asNumber(o.maxPages, DEFAULT_SETTINGS.maxPages, 1, 200);
  const renderScale = RENDER_SCALES.includes(String(o.renderScale))
    ? (String(o.renderScale) as Settings['renderScale'])
    : DEFAULT_SETTINGS.renderScale;
  const maxTokensRaw = o.openaiMaxTokens;
  const openaiMaxTokens =
    maxTokensRaw === '' || maxTokensRaw === null || maxTokensRaw === undefined
      ? null
      : asNumber(maxTokensRaw, 0, 0, 1_000_000) || null;

  return {
    provider,
    geminiKeys: asStringArray(o.geminiKeys),
    openaiKeys: asStringArray(o.openaiKeys),
    openaiBaseUrl: asString(o.openaiBaseUrl, DEFAULT_SETTINGS.openaiBaseUrl),
    openaiModel: asString(o.openaiModel, DEFAULT_SETTINGS.openaiModel),
    openaiMaxTokens,
    geminiModel: asString(o.geminiModel, DEFAULT_SETTINGS.geminiModel),
    maxPages,
    renderScale,
    extraPrompt: typeof o.extraPrompt === 'string' ? o.extraPrompt : DEFAULT_SETTINGS.extraPrompt,
    baseName: asString(o.baseName, DEFAULT_SETTINGS.baseName),
  };
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}

export function loadSettings(storage: Pick<Storage, 'getItem'>): Settings {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return parseSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: Pick<Storage, 'setItem'>, s: Settings): void {
  try {
    storage.setItem(STORAGE_KEY, serializeSettings(s));
  } catch {
    // ignore quota or serialization errors
  }
}
