import './SettingsPanel.css';
import type { Settings } from '../hooks/useSettings';

interface SettingsPanelProps {
    settings: Settings;
    onClose: () => void;
}

const FONT_OPTIONS = [
    { value: 'Georgia', label: 'Georgia (Serif)' },
    { value: "'Times New Roman'", label: 'Times New Roman' },
    { value: "'Palatino Linotype'", label: 'Palatino' },
    { value: 'Inter', label: 'Inter (Sans)' },
    { value: "'Helvetica Neue'", label: 'Helvetica' },
    { value: 'system-ui', label: 'System Default' },
    { value: "'OpenDyslexic'", label: 'OpenDyslexic' },
];

const THEME_OPTIONS = [
    { value: 'dark', label: '🌙 Dark', color: '#0f0f0f' },
    { value: 'light', label: '☀️ Light', color: '#fafafa' },
    { value: 'sepia', label: '📜 Sepia', color: '#f4ecd8' },
] as const;

export function SettingsPanel({ settings, onClose }: SettingsPanelProps) {
    return (
        <div className="settings-overlay" onClick={onClose}>
            <div className="settings-panel glass-panel" onClick={(e) => e.stopPropagation()}>
                <div className="settings-header">
                    <h2>Settings</h2>
                    <button className="btn btn-icon btn-secondary" onClick={onClose}>
                        ✕
                    </button>
                </div>

                <div className="settings-content">
                    {/* Theme Selection */}
                    <div className="settings-section">
                        <label className="settings-label">Theme</label>
                        <div className="theme-options">
                            {THEME_OPTIONS.map((theme) => (
                                <button
                                    key={theme.value}
                                    className={`theme-btn ${settings.theme === theme.value ? 'active' : ''}`}
                                    onClick={() => settings.setTheme(theme.value)}
                                    style={{ '--theme-color': theme.color } as React.CSSProperties}
                                >
                                    {theme.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Family */}
                    <div className="settings-section">
                        <label className="settings-label">Font Family</label>
                        <select
                            value={settings.fontFamily}
                            onChange={(e) => settings.setFontFamily(e.target.value)}
                            className="settings-select"
                        >
                            {FONT_OPTIONS.map((font) => (
                                <option key={font.value} value={font.value}>
                                    {font.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Font Size */}
                    <div className="settings-section">
                        <label className="settings-label">
                            Font Size: {settings.fontSize}px
                        </label>
                        <div className="font-size-control">
                            <button
                                className="btn btn-secondary"
                                onClick={() => settings.setFontSize(Math.max(12, settings.fontSize - 2))}
                            >
                                A-
                            </button>
                            <input
                                type="range"
                                min="12"
                                max="32"
                                value={settings.fontSize}
                                onChange={(e) => settings.setFontSize(Number(e.target.value))}
                            />
                            <button
                                className="btn btn-secondary"
                                onClick={() => settings.setFontSize(Math.min(32, settings.fontSize + 2))}
                            >
                                A+
                            </button>
                        </div>
                    </div>

                    {/* Preview */}
                    <div className="settings-section">
                        <label className="settings-label">Preview</label>
                        <div
                            className="font-preview"
                            style={{
                                fontFamily: settings.fontFamily,
                                fontSize: `${settings.fontSize}px`
                            }}
                        >
                            The quick brown fox jumps over the lazy dog.
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
