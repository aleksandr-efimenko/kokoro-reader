import './SettingsPanel.css';
import type { Settings } from '../hooks/useSettings';

interface SettingsPanelProps {
    settings: Settings;
    onClose: () => void;
    aiConnected: boolean;
    onConnectAI: () => void;
    onDisconnectAI: () => void;
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
    { value: 'sepia', label: '📜 Sepia', color: '#f5eed9' },
] as const;

export function SettingsPanel({
    settings,
    onClose,
    aiConnected,
    onConnectAI,
    onDisconnectAI
}: SettingsPanelProps) {
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

                    {/* Text Clarifier AI */}
                    <div className="settings-section">
                        <label className="settings-label">Text Clarifier AI</label>
                        <div className="ai-settings">
                            {aiConnected ? (
                                <div className="ai-status connected">
                                    <span className="status-indicator">●</span>
                                    <span>Connected to TextClarifier</span>
                                    <button className="btn btn-secondary btn-sm" onClick={onDisconnectAI}>
                                        Disconnect
                                    </button>
                                </div>
                            ) : (
                                <div className="ai-status disconnected">
                                    <p className="ai-description">
                                        Connect to get instant AI explanations for selected text.
                                    </p>
                                    <button className="btn btn-primary" onClick={onConnectAI}>
                                        Connect Account
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* TTS Engine Selection */}
                    <div className="settings-section">
                        <label className="settings-label">TTS Engine</label>
                        <div className="theme-options">
                            <button
                                className={`theme-btn ${settings.ttsEngine === 'Echo' ? 'active' : ''}`}
                                onClick={() => settings.setTtsEngine('Echo')}
                                style={{ '--theme-color': '#ff6b35' } as React.CSSProperties}
                            >
                                Echo-1B
                            </button>
                            <button
                                className={`theme-btn ${settings.ttsEngine === 'Chatterbox' ? 'active' : ''}`}
                                onClick={() => settings.setTtsEngine('Chatterbox')}
                                style={{ '--theme-color': '#4caf50' } as React.CSSProperties}
                            >
                                Chatterbox
                            </button>
                            <button
                                className={`theme-btn ${settings.ttsEngine === 'Qwen3TTS' ? 'active' : ''}`}
                                onClick={() => settings.setTtsEngine('Qwen3TTS')}
                                style={{ '--theme-color': '#2196f3' } as React.CSSProperties}
                            >
                                Qwen3-TTS
                            </button>
                        </div>
                        <p style={{ marginTop: '0.5rem', fontSize: '0.9em', opacity: 0.8 }}>
                            Echo-1B: Native Rust, streaming audio, GPU accelerated. No Python required.
                        </p>
                    </div>

                    {/* TTS Warmup on Startup */}
                    <div className="settings-section">
                        <label className="settings-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span>TTS Warmup on Startup</span>
                            <input
                                type="checkbox"
                                checked={settings.ttsWarmup}
                                onChange={(e) => settings.setTtsWarmup(e.target.checked)}
                                style={{ width: '20px', height: '20px', cursor: 'pointer' }}
                            />
                        </label>
                        <p style={{ marginTop: '0.25rem', fontSize: '0.85em', opacity: 0.7 }}>
                            Pre-generate audio on app launch for faster first playback. Increases startup time by ~5-10s.
                        </p>
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
