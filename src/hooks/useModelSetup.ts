import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export interface ModelStatus {
    is_ready: boolean;
    is_downloading: boolean;
    missing_files: string[];
    download_size_bytes: number;
    model_dir: string;
}

export interface DownloadProgress {
    file_name: string;
    bytes_downloaded: number;
    total_bytes: number | null;
    current_file: number;
    total_files: number;
    status: 'starting' | 'downloading' | 'completed' | 'failed' | 'already_exists';
}

export function useModelSetup() {
    const [status, setStatus] = useState<ModelStatus | null>(null);
    const [progress, setProgress] = useState<DownloadProgress | null>(null);
    const [isDownloading, setIsDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Check model status on mount
    useEffect(() => {
        checkStatus();
    }, []);

    // Listen for download progress events
    useEffect(() => {
        let unlisten: UnlistenFn | undefined;

        listen<DownloadProgress>('model-download-progress', (event) => {
            setProgress(event.payload);

            if (event.payload.status === 'completed' &&
                event.payload.current_file === event.payload.total_files) {
                // All done, refresh status
                setTimeout(() => {
                    checkStatus();
                    setIsDownloading(false);
                }, 500);
            }
        }).then((fn) => {
            unlisten = fn;
        });

        return () => {
            if (unlisten) unlisten();
        };
    }, []);

    const checkStatus = useCallback(async () => {
        try {
            const result = await invoke<ModelStatus>('check_model_status');
            setStatus(result);
            setError(null);
        } catch (e) {
            setError(String(e));
        }
    }, []);

    const startDownload = useCallback(async () => {
        if (isDownloading) return;

        setIsDownloading(true);
        setError(null);
        setProgress(null);

        try {
            await invoke('download_model');
            await checkStatus();
        } catch (e) {
            setError(String(e));
        } finally {
            setIsDownloading(false);
        }
    }, [isDownloading, checkStatus]);

    return {
        status,
        progress,
        isDownloading,
        error,
        checkStatus,
        startDownload,
    };
}

// Format bytes to human readable
export function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
