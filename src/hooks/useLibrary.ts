import { useState, useEffect, useCallback } from 'react';

export interface BookEntry {
    id: string;
    filePath: string;
    title: string;
    author?: string;
    addedAt: number;
    lastOpenedAt: number;
    location?: string;
    progress?: number;
}

interface LibraryData {
    books: BookEntry[];
    lastOpenedBookId?: string;
}

const STORAGE_KEY = 'kokoro-reader-library';

// Generate a simple hash ID from file path
function generateBookId(filePath: string): string {
    let hash = 0;
    for (let i = 0; i < filePath.length; i++) {
        const char = filePath.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
}

function loadLibrary(): LibraryData {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load library:', e);
    }
    return { books: [] };
}

function saveLibrary(data: LibraryData): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
        console.error('Failed to save library:', e);
    }
}

export function useLibrary() {
    const [library, setLibrary] = useState<LibraryData>(() => loadLibrary());

    // Save to localStorage whenever library changes
    useEffect(() => {
        saveLibrary(library);
    }, [library]);

    // Add or update a book in the library
    const addBook = useCallback((filePath: string, title: string, author?: string): BookEntry => {
        const id = generateBookId(filePath);
        const now = Date.now();

        setLibrary(prev => {
            const existing = prev.books.find(b => b.id === id);

            if (existing) {
                // Update existing book
                return {
                    ...prev,
                    lastOpenedBookId: id,
                    books: prev.books.map(b =>
                        b.id === id
                            ? { ...b, lastOpenedAt: now, title, author }
                            : b
                    ),
                };
            } else {
                // Add new book
                const newBook: BookEntry = {
                    id,
                    filePath,
                    title,
                    author,
                    addedAt: now,
                    lastOpenedAt: now,
                };
                return {
                    ...prev,
                    lastOpenedBookId: id,
                    books: [newBook, ...prev.books],
                };
            }
        });

        return {
            id,
            filePath,
            title,
            author,
            addedAt: now,
            lastOpenedAt: now,
        };
    }, []);

    // Remove a book from the library
    const removeBook = useCallback((bookId: string) => {
        setLibrary(prev => ({
            ...prev,
            books: prev.books.filter(b => b.id !== bookId),
            lastOpenedBookId: prev.lastOpenedBookId === bookId ? undefined : prev.lastOpenedBookId,
        }));
    }, []);

    // Update reading progress for a book
    const updateProgress = useCallback((bookId: string, location: string, progress?: number) => {
        setLibrary(prev => ({
            ...prev,
            books: prev.books.map(b =>
                b.id === bookId
                    ? { ...b, location, progress, lastOpenedAt: Date.now() }
                    : b
            ),
        }));
    }, []);

    // Get the last opened book
    const getLastOpenedBook = useCallback((): BookEntry | undefined => {
        if (!library.lastOpenedBookId) return undefined;
        return library.books.find(b => b.id === library.lastOpenedBookId);
    }, [library]);

    // Get a book by its ID
    const getBook = useCallback((bookId: string): BookEntry | undefined => {
        return library.books.find(b => b.id === bookId);
    }, [library]);

    // Get a book by file path
    const getBookByPath = useCallback((filePath: string): BookEntry | undefined => {
        const id = generateBookId(filePath);
        return library.books.find(b => b.id === id);
    }, [library]);

    // Get recent books (sorted by lastOpenedAt)
    const getRecentBooks = useCallback((limit = 10): BookEntry[] => {
        return [...library.books]
            .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
            .slice(0, limit);
    }, [library]);

    return {
        books: library.books,
        lastOpenedBookId: library.lastOpenedBookId,
        addBook,
        removeBook,
        updateProgress,
        getLastOpenedBook,
        getBook,
        getBookByPath,
        getRecentBooks,
    };
}
