import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Voice } from '../types';

interface TTSState {
    isPlaying: boolean;
    isPaused: boolean;
    isLoading: boolean;
    currentChunkIndex: number;
    totalChunks: number;
    speed: number;
    voice: string;
    error: string | null;
}

export function useTTS() {
    const [state, setState] = useState<TTSState>({
        isPlaying: false,
        isPaused: false,
        isLoading: false,
        currentChunkIndex: 0,
        totalChunks: 0,
        speed: 1.0,
        voice: 'af_bella',
        error: null,
    });

    const [voices, setVoices] = useState<Voice[]>([]);
    const [chunks, setChunks] = useState<string[]>([]);

    // Load available voices
    useEffect(() => {
        invoke<Voice[]>('get_voices').then(setVoices).catch(console.error);
    }, []);

    // Poll playback status
    useEffect(() => {
        if (!state.isPlaying && !state.isPaused) return;

        const interval = setInterval(async () => {
            try {
                const playing = await invoke<boolean>('is_playing');
                const paused = await invoke<boolean>('is_paused');

                if (!playing && !paused && state.isPlaying) {
                    // Playback finished, play next chunk if available
                    if (state.currentChunkIndex < chunks.length - 1) {
                        playNextChunk();
                    } else {
                        // All chunks done
                        setState(prev => ({ ...prev, isPlaying: false, currentChunkIndex: 0 }));
                    }
                }
            } catch (e) {
                console.error('Status poll error:', e);
            }
        }, 200);

        return () => clearInterval(interval);
    }, [state.isPlaying, state.isPaused, state.currentChunkIndex, chunks]);

    const playNextChunk = useCallback(async () => {
        const nextIndex = state.currentChunkIndex + 1;
        if (nextIndex >= chunks.length) return;

        try {
            await invoke('speak', {
                text: chunks[nextIndex],
                voice: state.voice,
                speed: state.speed,
            });
            setState(prev => ({
                ...prev,
                currentChunkIndex: nextIndex,
                isPlaying: true,
            }));
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, [state.currentChunkIndex, state.voice, state.speed, chunks]);

    const speak = useCallback(async (text: string) => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            // Split text into chunks
            const textChunks = splitIntoChunks(text, 300);
            setChunks(textChunks);

            // Start playing first chunk
            if (textChunks.length > 0) {
                await invoke('speak', {
                    text: textChunks[0],
                    voice: state.voice,
                    speed: state.speed,
                });

                setState(prev => ({
                    ...prev,
                    isPlaying: true,
                    isLoading: false,
                    currentChunkIndex: 0,
                    totalChunks: textChunks.length,
                }));
            }
        } catch (e) {
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: String(e),
            }));
        }
    }, [state.voice, state.speed]);

    const stop = useCallback(async () => {
        try {
            await invoke('stop_speaking');
            setState(prev => ({
                ...prev,
                isPlaying: false,
                isPaused: false,
                currentChunkIndex: 0,
            }));
            setChunks([]);
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const pause = useCallback(async () => {
        try {
            await invoke('pause_speaking');
            setState(prev => ({ ...prev, isPaused: true }));
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const resume = useCallback(async () => {
        try {
            await invoke('resume_speaking');
            setState(prev => ({ ...prev, isPaused: false }));
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const setSpeed = useCallback(async (speed: number) => {
        try {
            await invoke('set_speed', { speed });
            setState(prev => ({ ...prev, speed }));
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const setVoice = useCallback((voice: string) => {
        setState(prev => ({ ...prev, voice }));
    }, []);

    return {
        ...state,
        voices,
        speak,
        stop,
        pause,
        resume,
        setSpeed,
        setVoice,
    };
}

// Helper to split text into sentence-based chunks
function splitIntoChunks(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = '';

    for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > maxLength && currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += (currentChunk ? ' ' : '') + sentence;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 0);
}
