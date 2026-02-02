import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './ModelSetup.css';

interface ModelSetupProps {
    onComplete: () => void;
}

interface ModelStatus {
    is_ready: boolean;
    is_downloading: boolean;
    missing_files: string[];
    download_size_bytes: number;
    model_dir: string;
}

interface DownloadProgress {
    file_name: string;
    bytes_downloaded: number;
    total_bytes: number | null;
    current_file: number;
    total_files: number;
    status: string;
}

type SetupStep = 'checking' | 'downloading' | 'ready' | 'error';

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function ModelSetup({ onComplete }: ModelSetupProps) {
    const [step, setStep] = useState<SetupStep>('checking');
    const [error, setError] = useState<string | null>(null);
    const [progress, setProgress] = useState<DownloadProgress | null>(null);
    const [totalSize, setTotalSize] = useState<number>(0);

    const checkAndDownload = useCallback(async () => {
        setStep('checking');
        setError(null);

        try {
            // Check if model is already ready
            const status = await invoke<ModelStatus>('check_model_status');
            
            if (status.is_ready) {
                setStep('ready');
                setTimeout(onComplete, 1000);
                return;
            }

            // Model needs to be downloaded - start auto-download
            setStep('downloading');
            setTotalSize(status.download_size_bytes);

            // Start the download
            await invoke('download_model');
            
        } catch (e) {
            console.error('Setup error:', e);
            setError(String(e));
            setStep('error');
        }
    }, [onComplete]);

    // Listen for download progress events
    useEffect(() => {
        const unlisten = listen<DownloadProgress>('model-download-progress', (event) => {
            const data = event.payload;
            setProgress(data);

            if (data.status === 'completed' && data.current_file === data.total_files) {
                // All downloads complete
                setStep('ready');
                setTimeout(onComplete, 1500);
            } else if (data.status === 'already_exists') {
                // Model already exists
                setStep('ready');
                setTimeout(onComplete, 1000);
            } else if (data.status === 'failed') {
                setError(`Failed to download: ${data.file_name}`);
                setStep('error');
            }
        });

        return () => {
            unlisten.then((fn) => fn());
        };
    }, [onComplete]);

    // Start check and download on mount
    useEffect(() => {
        checkAndDownload();
    }, [checkAndDownload]);

    const handleRetry = () => {
        setError(null);
        setProgress(null);
        checkAndDownload();
    };

    const getProgressPercent = (): number => {
        if (!progress || !progress.total_bytes) return 0;
        return Math.round((progress.bytes_downloaded / progress.total_bytes) * 100);
    };

    const getOverallProgress = (): string => {
        if (!progress) return '';
        if (progress.total_files === 0) return '';
        return `File ${progress.current_file} of ${progress.total_files}`;
    };

    return (
        <div className="model-setup">
            <div className="setup-content fade-in">
                <div className="setup-logo">
                    <span className="logo-emoji">📚</span>
                </div>
                <h1>Kokoro Reader</h1>
                <p className="subtitle">AI-Powered EPUB Reader with High-Quality TTS</p>

                {step === 'checking' && (
                    <div className="status-card">
                        <div className="loading-spinner" />
                        <p>Checking model status...</p>
                    </div>
                )}

                {step === 'downloading' && (
                    <div className="status-card downloading">
                        <div className="download-header">
                            <h3>Downloading Kokoro TTS Model</h3>
                            <p className="download-size">Total size: ~{formatBytes(totalSize)}</p>
                        </div>

                        {progress && (
                            <div className="download-progress">
                                <div className="progress-file">
                                    <span className="file-name">{progress.file_name}</span>
                                    <span className="file-progress">
                                        {progress.total_bytes 
                                            ? `${formatBytes(progress.bytes_downloaded)} / ${formatBytes(progress.total_bytes)}`
                                            : formatBytes(progress.bytes_downloaded)
                                        }
                                    </span>
                                </div>
                                
                                <div className="progress-bar-container">
                                    <div 
                                        className="progress-bar" 
                                        style={{ width: `${getProgressPercent()}%` }}
                                    />
                                </div>

                                <div className="progress-info">
                                    <span className="progress-percent">{getProgressPercent()}%</span>
                                    <span className="progress-files">{getOverallProgress()}</span>
                                </div>
                            </div>
                        )}

                        <p className="download-note">
                            This is a one-time download. The model will be stored locally for offline use.
                        </p>
                    </div>
                )}

                {step === 'ready' && (
                    <div className="status-card success">
                        <span className="check-icon">✅</span>
                        <h2>Ready!</h2>
                        <p>Kokoro TTS is ready to read your books</p>
                    </div>
                )}

                {step === 'error' && (
                    <div className="status-card error">
                        <span className="error-icon">⚠️</span>
                        <h3>Download Failed</h3>
                        <p className="error-text">{error}</p>
                        <div className="error-actions">
                            <button className="btn btn-primary" onClick={handleRetry}>
                                Retry Download
                            </button>
                            <button className="btn btn-secondary" onClick={onComplete}>
                                Skip (Limited Functionality)
                            </button>
                        </div>
                        <p className="error-note">
                            Note: Without the TTS model, text-to-speech will use placeholder audio.
                        </p>
                    </div>
                )}

                <div className="setup-footer">
                    <p className="footer-note">
                        Kokoro TTS uses the Kokoro-82M model for high-quality, natural-sounding speech.
                        <br />
                        All processing happens locally on your device.
                    </p>
                </div>
            </div>
        </div>
    );
}
