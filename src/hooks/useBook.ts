import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { Book, Chapter } from '../types';

interface BookState {
    book: Book | null;
    currentChapterIndex: number;
    isLoading: boolean;
    error: string | null;
}

export function useBook() {
    const [state, setState] = useState<BookState>({
        book: null,
        currentChapterIndex: 0,
        isLoading: false,
        error: null,
    });

    const openFile = useCallback(async () => {
        try {
            const selected = await open({
                multiple: false,
                filters: [
                    {
                        name: 'Ebook',
                        extensions: ['epub', 'txt', 'text'],
                    },
                ],
            });

            if (selected && typeof selected === 'string') {
                setState(prev => ({ ...prev, isLoading: true, error: null }));
                console.log('Opening book:', selected);

                const book = await invoke<Book>('open_book', { path: selected });
                console.log('Book loaded:', book);
                console.log('Chapters:', book?.chapters?.length, book?.chapters?.[0]?.content?.substring(0, 200));

                setState({
                    book,
                    currentChapterIndex: 0,
                    isLoading: false,
                    error: null,
                });

                return book;
            }
        } catch (e) {
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: String(e),
            }));
        }
        return null;
    }, []);

    const setChapter = useCallback((index: number) => {
        if (state.book && index >= 0 && index < state.book.chapters.length) {
            setState(prev => ({ ...prev, currentChapterIndex: index }));
        }
    }, [state.book]);

    const nextChapter = useCallback(() => {
        if (state.book && state.currentChapterIndex < state.book.chapters.length - 1) {
            setState(prev => ({ ...prev, currentChapterIndex: prev.currentChapterIndex + 1 }));
        }
    }, [state.book, state.currentChapterIndex]);

    const prevChapter = useCallback(() => {
        if (state.currentChapterIndex > 0) {
            setState(prev => ({ ...prev, currentChapterIndex: prev.currentChapterIndex - 1 }));
        }
    }, [state.currentChapterIndex]);

    const currentChapter: Chapter | null = state.book?.chapters[state.currentChapterIndex] ?? null;

    return {
        ...state,
        currentChapter,
        openFile,
        setChapter,
        nextChapter,
        prevChapter,
    };
}
