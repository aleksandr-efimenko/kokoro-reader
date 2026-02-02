import { useEffect } from 'react';

interface UseKeyboardShortcutsProps {
    togglePlayback: () => void;
    stopPlayback: () => void;
    nextPage: () => void;
    prevPage: () => void;
    increaseFontSize: () => void;
    decreaseFontSize: () => void;
}

export function useKeyboardShortcuts({
    togglePlayback,
    stopPlayback,
    nextPage,
    prevPage,
    increaseFontSize,
    decreaseFontSize
}: UseKeyboardShortcutsProps) {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if focus is in an input or textarea
            if (
                document.activeElement?.tagName === 'INPUT' ||
                document.activeElement?.tagName === 'TEXTAREA' ||
                (document.activeElement as HTMLElement)?.isContentEditable
            ) {
                return;
            }

            switch (e.code) {
                case 'Space':
                    e.preventDefault(); // Prevent scrolling
                    togglePlayback();
                    break;
                case 'Escape':
                    stopPlayback();
                    break;
                case 'ArrowRight':
                    nextPage();
                    break;
                case 'ArrowLeft':
                    prevPage();
                    break;
                case 'Equal': // +
                case 'NumpadAdd':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault(); // Prevent browser zoom
                        increaseFontSize();
                    }
                    break;
                case 'Minus': // -
                case 'NumpadSubtract':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault(); // Prevent browser zoom
                        decreaseFontSize();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [togglePlayback, stopPlayback, nextPage, prevPage, increaseFontSize, decreaseFontSize]);
}
