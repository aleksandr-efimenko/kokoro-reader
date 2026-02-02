import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const STORAGE_KEY = 'kokoro-reader-ai-key';

interface AuthEvent {
    key: String;
}

export function useAI() {
    const [apiKey, setApiKey] = useState<string | null>(() => {
        return localStorage.getItem(STORAGE_KEY);
    });
    const [isConnecting, setIsConnecting] = useState(false);
    const [isThinking, setIsThinking] = useState(false);

    useEffect(() => {
        // Listen for auth success from the backend auth window
        const unlisten = listen<AuthEvent>('auth-success', (event) => {
            const key = event.payload.key as string;
            if (key) {
                setApiKey(key);
                localStorage.setItem(STORAGE_KEY, key);
                setIsConnecting(false);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);

    const connect = useCallback(async () => {
        setIsConnecting(true);
        try {
            await invoke('open_auth_window');
        } catch (e) {
            console.error('Failed to open auth window:', e);
            setIsConnecting(false);
        }
    }, []);

    const disconnect = useCallback(() => {
        setApiKey(null);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const clarify = useCallback(async (text: string, context: string): Promise<string> => {
        if (!apiKey) throw new Error("Not connected");

        setIsThinking(true);
        try {
            const result = await invoke<string>('explain_text', {
                apiKey,
                text,
                context
            });
            return result;
        } finally {
            setIsThinking(false);
        }
    }, [apiKey]);

    return {
        isConnected: !!apiKey,
        isConnecting,
        isThinking,
        connect,
        disconnect,
        clarify
    };
}
