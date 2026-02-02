import './AudioControls.css';
import type { Voice } from '../types';

interface AudioControlsProps {
    isPlaying: boolean;
    isPaused: boolean;
    isLoading: boolean;
    error?: string | null;
    speed: number;
    voice: string;
    voices: Voice[];
    currentChunk: number;
    totalChunks: number;
    onPlay: () => void;
    onPause: () => void;
    onResume: () => void;
    onStop: () => void;
    onSpeedChange: (speed: number) => void;
    onVoiceChange: (voice: string) => void;
}

export function AudioControls({
    isPlaying,
    isPaused,
    isLoading,
    error,
    speed,
    voice,
    voices,
    currentChunk,
    totalChunks,
    onPlay,
    onPause,
    onResume,
    onStop,
    onSpeedChange,
    onVoiceChange,
}: AudioControlsProps) {
    const progress = totalChunks > 0 ? ((currentChunk + 1) / totalChunks) * 100 : 0;
    const showProgress = totalChunks > 0 && (isLoading || isPlaying || isPaused);

    return (
        <div className="audio-controls glass-panel">
            {/* Progress (replaces old bar) */}
            {showProgress && (
                <div className="tts-progress-row">
                    <div className="tts-progress-label">
                        {isLoading ? 'Preparing…' : isPaused ? 'Paused' : 'Reading'}
                        <span className="tts-progress-meta">
                            {currentChunk + 1} / {totalChunks}
                        </span>
                    </div>
                    <progress className="tts-progress" max={100} value={progress} />
                </div>
            )}

            <div className="controls-content">
                {/* Main playback controls */}
                <div className="playback-controls">
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={onStop}
                        disabled={!isPlaying && !isPaused && !isLoading}
                        title="Stop"
                    >
                        ⏹️
                    </button>

                    <button
                        onClick={isPaused ? onResume : isPlaying ? onPause : onPlay}
                        disabled={isLoading}
                        title={isPaused ? 'Resume' : isPlaying ? 'Pause' : 'Play'}
                    >
                        {isLoading ? (
                            <div className="spinner" />
                        ) : isPaused ? (
                            '▶️'
                        ) : isPlaying ? (
                            '⏸️'
                        ) : (
                            '▶️'
                        )}
                    </button>

                    <div className="control-spacer" />
                </div>

                {/* Speed control */}
                <div className="speed-control">
                    <label>Speed</label>
                    <input
                        type="range"
                        min="0.5"
                        max="2"
                        step="0.1"
                        value={speed}
                        onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
                    />
                    <span className="speed-value">{speed.toFixed(1)}x</span>
                </div>

                {/* Voice selector */}
                <div className="voice-control">
                    <label>Voice</label>
                    <select value={voice} onChange={(e) => onVoiceChange(e.target.value)}>
                        <optgroup label="American Female">
                            {voices
                                .filter((v) => v.accent === 'american' && v.gender === 'female')
                                .map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name}
                                    </option>
                                ))}
                        </optgroup>
                        <optgroup label="American Male">
                            {voices
                                .filter((v) => v.accent === 'american' && v.gender === 'male')
                                .map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name}
                                    </option>
                                ))}
                        </optgroup>
                        <optgroup label="British Female">
                            {voices
                                .filter((v) => v.accent === 'british' && v.gender === 'female')
                                .map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name}
                                    </option>
                                ))}
                        </optgroup>
                        <optgroup label="British Male">
                            {voices
                                .filter((v) => v.accent === 'british' && v.gender === 'male')
                                .map((v) => (
                                    <option key={v.id} value={v.id}>
                                        {v.name}
                                    </option>
                                ))}
                        </optgroup>
                    </select>
                </div>

                {/* Chunk progress */}
                {totalChunks > 0 && (
                    <div className="chunk-progress">
                        <span>
                            {currentChunk + 1} / {totalChunks}
                        </span>
                    </div>
                )}
            </div>

            {error && (
                <div className="tts-error" role="alert">
                    {error}
                </div>
            )}
        </div>
    );
}
