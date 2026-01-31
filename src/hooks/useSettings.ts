import { useState, useEffect } from 'react';

export interface Settings {
    theme: 'dark' | 'light' | 'sepia';
    fontSize: number;
    fontFamily: string;
    setTheme: (theme: 'dark' | 'light' | 'sepia') => void;
    setFontSize: (size: number) => void;
    setFontFamily: (family: string) => void;
}

const STORAGE_KEY = 'kokoro-reader-settings';

type Theme = 'dark' | 'light' | 'sepia';

interface StoredSettings {
    theme: Theme;
    fontSize: number;
    fontFamily: string;
}

const defaultSettings: StoredSettings = {
    theme: 'dark',
    fontSize: 18,
    fontFamily: 'Georgia',
};

export function useSettings(): Settings {
    const [theme, setThemeState] = useState<'dark' | 'light' | 'sepia'>(defaultSettings.theme);
    const [fontSize, setFontSizeState] = useState(defaultSettings.fontSize);
    const [fontFamily, setFontFamilyState] = useState(defaultSettings.fontFamily);

    // Load settings from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.theme) setThemeState(parsed.theme);
                if (parsed.fontSize) setFontSizeState(parsed.fontSize);
                if (parsed.fontFamily) setFontFamilyState(parsed.fontFamily);
            }
        } catch (e) {
            console.error('Failed to load settings:', e);
        }
    }, []);

    // Save settings to localStorage
    const saveSettings = (newSettings: Partial<typeof defaultSettings>) => {
        try {
            const current = { theme, fontSize, fontFamily, ...newSettings };
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

    return {
        theme,
        fontSize,
        fontFamily,
        setTheme,
        setFontSize,
        setFontFamily,
    };
}
