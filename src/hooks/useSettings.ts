import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Settings {
    theme: 'dark' | 'light' | 'sepia';
    fontSize: number;
    fontFamily: string;
    ttsEngine: 'Echo';
    ttsWarmup: boolean;
    setTheme: (theme: 'dark' | 'light' | 'sepia') => void;
    setFontSize: (size: number) => void;
    setFontFamily: (family: string) => void;
    setTtsEngine: (engine: 'Echo') => void;
    setTtsWarmup: (enabled: boolean) => void;
}

const STORAGE_KEY = 'kokoro-reader-settings';

type Theme = 'dark' | 'light' | 'sepia';

interface StoredSettings {
    theme: Theme;
    fontSize: number;
    fontFamily: string;
    ttsEngine: 'Echo';
    ttsWarmup: boolean;
}

const defaultSettings: StoredSettings = {
    theme: 'dark',
    fontSize: 18,
    fontFamily: 'Georgia',
    ttsEngine: 'Echo',
    ttsWarmup: true,  // Pre-warm model on app load for faster TTS
};

export function useSettings(): Settings {
    const [theme, setThemeState] = useState<'dark' | 'light' | 'sepia'>(defaultSettings.theme);
    const [fontSize, setFontSizeState] = useState(defaultSettings.fontSize);
    const [fontFamily, setFontFamilyState] = useState(defaultSettings.fontFamily);
    const [ttsEngine, setTtsEngineState] = useState(defaultSettings.ttsEngine);
    const [ttsWarmup, setTtsWarmupState] = useState(defaultSettings.ttsWarmup);

    // Load settings from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.theme) setThemeState(parsed.theme);
                if (parsed.fontSize) setFontSizeState(parsed.fontSize);
                if (parsed.fontFamily) setFontFamilyState(parsed.fontFamily);
                if (parsed.ttsEngine) {
                    // Legacy engines no longer supported - always use Echo
                    const engine: 'Echo' = 'Echo';
                    setTtsEngineState(engine);
                    // Sync with backend
                    invoke('set_tts_engine', { engine }).catch(console.error);
                } else {
                    // Sync default
                    invoke('set_tts_engine', { engine: defaultSettings.ttsEngine }).catch(console.error);
                }
                if (parsed.ttsWarmup !== undefined) setTtsWarmupState(parsed.ttsWarmup);
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }, []);

    const saveSettings = (newSettings: Partial<typeof defaultSettings>) => {
        try {
            const current = { theme, fontSize, fontFamily, ttsEngine, ttsWarmup, ...newSettings };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
        } catch (e) {
            console.error('Failed to save settings:', e);
        }
    };

    const setTheme = (newTheme: 'dark' | 'light' | 'sepia') => {
        setThemeState(newTheme);
        saveSettings({ theme: newTheme });
    };

    const setFontSize = (size: number) => {
        setFontSizeState(size);
        saveSettings({ fontSize: size });
    };

    const setFontFamily = (family: string) => {
        setFontFamilyState(family);
        saveSettings({ fontFamily: family });
    };

    const setTtsEngine = (engine: 'Echo') => {
        setTtsEngineState(engine);
        saveSettings({ ttsEngine: engine });
        invoke('set_tts_engine', { engine }).catch(console.error);
    };

    const setTtsWarmup = (enabled: boolean) => {
        setTtsWarmupState(enabled);
        saveSettings({ ttsWarmup: enabled });
    };

    return {
        theme,
        fontSize,
        fontFamily,
        ttsEngine,
        ttsWarmup,
        setTheme,
        setFontSize,
        setFontFamily,
        setTtsEngine,
        setTtsWarmup,
    };
}
