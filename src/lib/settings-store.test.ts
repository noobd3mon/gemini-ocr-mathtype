import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SETTINGS, parseSettings, serializeSettings, loadSettings, saveSettings, type Settings,
} from './settings-store';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, String(v)); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

describe('parseSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('x')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid fields and filters empty keys', () => {
    const s = parseSettings({
      provider: 'openai', geminiKeys: ['a', '', ' ', 'b'], openaiKeys: 'not-array',
      openaiBaseUrl: 'https://x.test/v1', openaiModel: 'custom', geminiModel: 'gemini-3.6-flash',
      maxPages: 10, renderScale: '3', extraPrompt: 'giữ nguyên', baseName: 'De_2026',
    });
    expect(s.provider).toBe('openai');
    expect(s.geminiKeys).toEqual(['a', 'b']);
    expect(s.openaiKeys).toEqual([]);
    expect(s.openaiBaseUrl).toBe('https://x.test/v1');
    expect(s.geminiModel).toBe('gemini-3.6-flash');
    expect(s.maxPages).toBe(10);
    expect(s.renderScale).toBe('3');
    expect(s.baseName).toBe('De_2026');
  });

  it('clamps numbers and falls back invalid enums', () => {
    const s = parseSettings({ provider: 'xyz', maxPages: -5, renderScale: '9', openaiMaxTokens: 'abc' });
    expect(s.provider).toBe('gemini');
    expect(s.maxPages).toBe(1);
    expect(s.renderScale).toBe('2');
    expect(s.openaiMaxTokens).toBeNull();
  });
});

describe('load/save roundtrip', () => {
  it('saves and loads settings', () => {
    const storage = memoryStorage();
    const s: Settings = { ...DEFAULT_SETTINGS, provider: 'openai', openaiKeys: ['sk-x'], baseName: 'Bai_1' };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toMatchObject({ provider: 'openai', openaiKeys: ['sk-x'], baseName: 'Bai_1' });
  });

  it('loads defaults when storage is empty or corrupt', () => {
    const storage = memoryStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    storage.setItem('aiomt_settings_v1', '{broken');
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it('serializeSettings is JSON', () => {
    expect(JSON.parse(serializeSettings(DEFAULT_SETTINGS))).toEqual(DEFAULT_SETTINGS);
  });
});
