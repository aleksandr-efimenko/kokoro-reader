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
    const [, setChunks] = useState<string[]>([]);
    const sessionIdRef = useRef<string | null>(null);
    const chunksRef = useRef<string[]>([]);
    const voiceRef = useRef<string>(state.voice);
    const speedRef = useRef<number>(state.speed);

    useEffect(() => {
        voiceRef.current = state.voice;
        speedRef.current = state.speed;
    }, [state.voice, state.speed]);

    // Load available voices
    useEffect(() => {
        invoke<Voice[]>('get_voices').then(setVoices).catch(console.error);
    }, []);

    // Listen for playback events from Rust.
    // Track current chunk index in a ref so the event listener can access it
    const currentChunkIndexRef = useRef<number>(0);

    useEffect(() => {
        currentChunkIndexRef.current = state.currentChunkIndex;
    }, [state.currentChunkIndex]);

    // Listen for playback events from Rust.
    useEffect(() => {
        let unlisten: (() => void) | null = null;

        listen<TtsPlaybackEvent>('tts-playback-event', async (event) => {
            const payload = event.payload;
            const currentSession = sessionIdRef.current;
            if (!currentSession || payload.session_id !== currentSession) return;

            if (payload.event === 'chunk_started') {
                setState(prev => ({
                    ...prev,
                    isLoading: false,
                    isPlaying: true,
                    isPaused: false,
                    currentChunkIndex: payload.chunk_index,
                }));
            } else if (payload.event === 'chunk_ready' || payload.event === 'chunk_queued') {
                if (payload.chunk_index === 0) {
                    setState(prev => ({ ...prev, isLoading: false }));
                }
            } else if (payload.event === 'chunk_finished') {
                const chunks = chunksRef.current;
                const currentIdx = currentChunkIndexRef.current;
                const nextIdx = currentIdx + 1;

                if (nextIdx < chunks.length) {
                    // More chunks to play - stream the next one
                    console.log(`[TTS] Chunk ${currentIdx} finished, streaming chunk ${nextIdx}/${chunks.length}`);
                    setState(prev => ({
                        ...prev,
                        currentChunkIndex: nextIdx,
                        isLoading: true,
                    }));
                    currentChunkIndexRef.current = nextIdx;

                    try {
                        await invoke('tts_stream_text', {
                            sessionId: currentSession,
                            text: chunks[nextIdx],
                            voice: voiceRef.current,
                            speed: speedRef.current,
                        });
                    } catch (e) {
                        console.error('[TTS] Error streaming next chunk:', e);
                        setState(prev => ({
                            ...prev,
                            isLoading: false,
                            isPlaying: false,
                            error: String(e),
                        }));
                    }
                } else {
                    // All chunks finished
                    console.log(`[TTS] All ${chunks.length} chunks finished`);
                    setState(prev => ({
                        ...prev,
                        isPlaying: false,
                        isPaused: false,
                        currentChunkIndex: 0,
                    }));
                    currentChunkIndexRef.current = 0;
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
    }, []);

    const speak = useCallback(async (text: string) => {
        const normalized = normalizeTextForTts(text);
        if (!normalized) return;

        // Split text into chunks that fit within Echo's context window
        const textChunks = splitTextIntoChunks(normalized);
        if (textChunks.length === 0) return;

        console.log(`[TTS] Split text into ${textChunks.length} chunks`);

        const sessionId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
        sessionIdRef.current = sessionId;

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

        try {
            await invoke('tts_start_session', { sessionId });

            // Stream the first chunk -- subsequent chunks triggered by chunk_finished event
            const firstChunk = textChunks[0];
            console.log(`[TTS] Streaming chunk 0/${textChunks.length}: "${firstChunk.substring(0, 50)}..."`);

            await invoke('tts_stream_text', {
                sessionId,
                text: firstChunk,
                voice: voiceRef.current,
                speed: speedRef.current,
            });
        } catch (e) {
            setState(prev => ({ ...prev, isLoading: false, error: String(e) }));
        }
    }, []);

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

function normalizeTextForTts(text: string): string {
    return text
        .replace(/\u00A0/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

/**
 * Split text into smaller chunks that fit within Echo's context window.
 * Target ~800 chars per chunk (roughly 200-300 tokens) to stay well under 2048 token limit.
 * Splits at paragraph boundaries first, then sentence boundaries, then word boundaries.
 */
function splitTextIntoChunks(text: string, maxChunkLength = 800): string[] {
    if (!text || text.length <= maxChunkLength) {
        return text ? [text] : [];
    }

    const chunks: string[] = [];

    // First split by paragraphs (double newlines or multiple spaces that look like paragraphs)
    const paragraphs = text.split(/\n\n+|\r\n\r\n+/).filter(p => p.trim());

    for (const paragraph of paragraphs) {
        if (paragraph.length <= maxChunkLength) {
            chunks.push(paragraph.trim());
        } else {
            // Split long paragraphs by sentences
            const sentences = paragraph.match(/[^.!?]+[.!?]+\s*/g) || [paragraph];
            let currentChunk = '';

            for (const sentence of sentences) {
                const trimmedSentence = sentence.trim();
                if (!trimmedSentence) continue;

                if (currentChunk.length + trimmedSentence.length + 1 <= maxChunkLength) {
                    currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
                } else {
                    if (currentChunk) {
                        chunks.push(currentChunk);
                    }

                    // If single sentence is too long, split at word boundaries
                    if (trimmedSentence.length > maxChunkLength) {
                        const words = trimmedSentence.split(/\s+/);
                        currentChunk = '';
                        for (const word of words) {
                            if (currentChunk.length + word.length + 1 <= maxChunkLength) {
                                currentChunk += (currentChunk ? ' ' : '') + word;
                            } else {
                                if (currentChunk) chunks.push(currentChunk);
                                currentChunk = word;
                            }
                        }
                    } else {
                        currentChunk = trimmedSentence;
                    }
                }
            }

            if (currentChunk) {
                chunks.push(currentChunk);
            }
        }
    }

    return chunks.filter(c => c.trim());
}

