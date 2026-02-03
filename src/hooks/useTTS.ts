import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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

interface TtsPlaybackEvent {
    session_id: string;
    chunk_index: number;
    event: string;
    message?: string | null;
}

export function useTTS(ttsEngine?: string) {
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
    const [, setChunks] = useState<string[]>([]);
    const sessionIdRef = useRef<string | null>(null);
    const chunksRef = useRef<string[]>([]);
    const enqueuedUpToRef = useRef<number>(-1);
    const voiceRef = useRef<string>(state.voice);
    const speedRef = useRef<number>(state.speed);
    const engineRef = useRef<string>(ttsEngine ?? 'Echo');

    useEffect(() => {
        voiceRef.current = state.voice;
        speedRef.current = state.speed;
    }, [state.voice, state.speed]);

    useEffect(() => {
        engineRef.current = ttsEngine ?? 'Echo';
    }, [ttsEngine]);

    const isEcho = () => engineRef.current === 'Echo';

    const enqueueThrough = useCallback((maxIndex: number) => {
        const sessionId = sessionIdRef.current;
        if (!sessionId) return;
        const list = chunksRef.current;
        const from = enqueuedUpToRef.current + 1;
        const to = Math.min(maxIndex, list.length - 1);
        if (to < from) return;

        for (let i = from; i <= to; i++) {
            const chunk = list[i];
            // Fire-and-forget generation.
            invoke('tts_enqueue_chunk', {
                sessionId,
                chunkIndex: i,
                text: chunk,
                voice: voiceRef.current,
                speed: speedRef.current,
            }).catch((e) => {
                setState(prev => ({ ...prev, isLoading: false, error: String(e) }));
            });
        }

        enqueuedUpToRef.current = to;
    }, []);

    // Load available voices
    useEffect(() => {
        invoke<Voice[]>('get_voices').then(setVoices).catch(console.error);
    }, []);

    // Listen for playback events from Rust.
    useEffect(() => {
        let unlisten: (() => void) | null = null;

        listen<TtsPlaybackEvent>('tts-playback-event', (event) => {
            const payload = event.payload;
            const currentSession = sessionIdRef.current;
            if (!currentSession || payload.session_id !== currentSession) return;

            if (payload.event === 'chunk_started') {
                setState(prev => ({
                    ...prev,
                    isLoading: payload.chunk_index === 0 ? false : prev.isLoading,
                    isPlaying: true,
                    isPaused: false,
                    currentChunkIndex: payload.chunk_index,
                }));

                // For legacy chunked engines, prefetch ahead
                if (!isEcho()) {
                    enqueueThrough(payload.chunk_index + 7);
                }
            } else if (payload.event === 'chunk_ready' || payload.event === 'chunk_queued') {
                if (payload.chunk_index === 0) {
                    setState(prev => ({ ...prev, isLoading: false }));
                }
            } else if (payload.event === 'chunk_finished') {
                setState(prev => {
                    const isLast = isEcho()
                        ? true  // Echo streams full text as a single chunk
                        : prev.totalChunks > 0 && payload.chunk_index >= prev.totalChunks - 1;
                    return {
                        ...prev,
                        isPlaying: isLast ? false : prev.isPlaying,
                        isPaused: false,
                        currentChunkIndex: isLast ? 0 : prev.currentChunkIndex,
                    };
                });

                // For legacy engines, prefetch more chunks
                if (!isEcho()) {
                    const cs = sessionIdRef.current;
                    if (cs) {
                        enqueueThrough(payload.chunk_index + 8);
                    }
                }
            } else if (payload.event === 'generation_error' || payload.event === 'error') {
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    isPlaying: false,
                    isPaused: false,
                    error: payload.message ?? 'TTS error',
                }));
            }
        })
            .then((fn) => {
                unlisten = fn;
            })
            .catch((e) => console.error('Failed to listen for TTS events:', e));

        return () => {
            if (unlisten) unlisten();
        };
    }, [enqueueThrough]);

    const speak = useCallback(async (text: string) => {
        const normalized = normalizeTextForTts(text);
        if (!normalized) return;

        const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        sessionIdRef.current = sessionId;

        if (isEcho()) {
            // Echo streaming mode: send full text, no sentence splitting
            setState(prev => ({
                ...prev,
                isLoading: true,
                error: null,
                isPlaying: false,
                isPaused: false,
                currentChunkIndex: 0,
                totalChunks: 1, // Single streaming chunk
            }));
            setChunks([normalized]);
            chunksRef.current = [normalized];
            enqueuedUpToRef.current = -1;

            try {
                await invoke('tts_start_session', { sessionId });

                // Stream the full text -- audio starts playing as frames arrive
                await invoke('tts_stream_text', {
                    sessionId,
                    text: normalized,
                    voice: voiceRef.current,
                    speed: speedRef.current,
                });
            } catch (e) {
                setState(prev => ({ ...prev, isLoading: false, error: String(e) }));
            }
        } else {
            // Legacy chunked mode: split into sentences
            const textChunks = splitIntoSentences(normalized);
            if (textChunks.length === 0) return;

            setState(prev => ({
                ...prev,
                isLoading: true,
                error: null,
                isPlaying: false,
                isPaused: false,
                currentChunkIndex: 0,
                totalChunks: textChunks.length,
            }));
            setChunks(textChunks);
            chunksRef.current = textChunks;
            enqueuedUpToRef.current = -1;

            try {
                await invoke('tts_start_session', { sessionId });

                // Generate first 5 chunks immediately for faster start
                enqueueThrough(4);
            } catch (e) {
                setState(prev => ({ ...prev, isLoading: false, error: String(e) }));
            }
        }
    }, [enqueueThrough]);

    const stop = useCallback(async () => {
        try {
            await invoke('tts_stop');
            setState(prev => ({
                ...prev,
                isPlaying: false,
                isPaused: false,
                currentChunkIndex: 0,
                totalChunks: 0,
                isLoading: false,
            }));
            setChunks([]);
            sessionIdRef.current = null;
            chunksRef.current = [];
            enqueuedUpToRef.current = -1;
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const pause = useCallback(async () => {
        try {
            await invoke('tts_pause');
            setState(prev => ({ ...prev, isPaused: true }));
        } catch (e) {
            setState(prev => ({ ...prev, error: String(e) }));
        }
    }, []);

    const resume = useCallback(async () => {
        try {
            await invoke('tts_resume');
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

    // Get the text of the current chunk being played
    const getCurrentChunkText = useCallback((): string | null => {
        const chunks = chunksRef.current;
        const idx = state.currentChunkIndex;
        if (chunks.length > 0 && idx >= 0 && idx < chunks.length) {
            return chunks[idx];
        }
        return null;
    }, [state.currentChunkIndex]);

    return {
        ...state,
        voices,
        speak,
        stop,
        pause,
        resume,
        setSpeed,
        setVoice,
        getCurrentChunkText,
    };
}

// Helper to split text into individual sentences (used by legacy engines)
function splitIntoSentences(text: string): string[] {
    const sentences = text.split(/(?<=[.!?])\s+/);
    return sentences
        .map(s => s.trim())
        .filter(s => s.length > 0);
}

function normalizeTextForTts(text: string): string {
    return text
        .replace(/\u00A0/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}
