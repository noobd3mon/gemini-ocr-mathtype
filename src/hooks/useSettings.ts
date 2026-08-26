'use client';
import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings-store';

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    setSettingsState(loadSettings(localStorage));
  }, []);

  const setSettings = useCallback((s: Settings) => {
    setSettingsState(s);
    saveSettings(localStorage, s);
  }, []);

  const update = useCallback((partial: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...partial };
      saveSettings(localStorage, next);
      return next;
    });
  }, []);

  return { settings, setSettings, update };
}
