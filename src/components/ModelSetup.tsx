import './ModelSetup.css';
import { useModelSetup, formatBytes } from '../hooks/useModelSetup';

interface ModelSetupProps {
    onComplete: () => void;
}

export function ModelSetup({ onComplete }: ModelSetupProps) {
    const { status, progress, isDownloading, error, startDownload } = useModelSetup();

    // Auto-proceed if model is ready
    if (status?.is_ready) {
        setTimeout(onComplete, 500);
        return (
            <div className="model-setup">
                <div className="setup-content fade-in">
                    <span className="check-icon">✅</span>
                    <h2>Model Ready</h2>
                    <p>Kokoro TTS is ready to use!</p>
                </div>
            </div>
        );
    }

    const progressPercent = progress?.total_bytes
        ? Math.round((progress.bytes_downloaded / progress.total_bytes) * 100)
        : 0;

    return (
        <div className="model-setup">
            <div className="setup-content fade-in">
                <h1>🎙️ Kokoro Reader</h1>
                <p className="subtitle">AI-Powered Ebook Reader</p>

                {!isDownloading && !progress && (
                    <>
                        <div className="info-card">
                            <h3>First Time Setup</h3>
                            <p>
                                Kokoro Reader uses the Kokoro-82M AI model for natural text-to-speech.
                                The model needs to be downloaded once (~90 MB).
                            </p>

                            {status && status.missing_files.length > 0 && (
                                <div className="file-list">
                                    <span className="label">Files to download:</span>
                                    <ul>
                                        {status.missing_files.slice(0, 3).map((file, i) => (
                                            <li key={i}>{file}</li>
                                        ))}
                                        {status.missing_files.length > 3 && (
                                            <li>...and {status.missing_files.length - 3} more</li>
                                        )}
                                    </ul>
                                    <span className="size">
                                        Total: {formatBytes(status.download_size_bytes)}
                                    </span>
                                </div>
                            )}
                        </div>

                        <button className="btn btn-primary large" onClick={startDownload}>
                            Download Model
                        </button>
                    </>
                )}

                {(isDownloading || progress) && (
                    <div className="download-progress">
                        <div className="progress-header">
                            <span className="file-name">
                                {progress?.file_name || 'Preparing...'}
                            </span>
                            <span className="progress-percent">
                                {progress?.current_file || 0} / {progress?.total_files || 0}
                            </span>
                        </div>

                        <div className="progress-bar-container">
                            <div
                                className="progress-bar-fill"
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>

                        <div className="progress-details">
                            {progress?.total_bytes && (
                                <span>
                                    {formatBytes(progress.bytes_downloaded)} / {formatBytes(progress.total_bytes)}
                                </span>
                            )}
                            <span className="status">{progress?.status || 'starting'}</span>
                        </div>
                    </div>
                )}

                {error && (
                    <div className="error-message">
                        <span>❌ {error}</span>
                        <button className="btn btn-secondary" onClick={startDownload}>
                            Retry
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
