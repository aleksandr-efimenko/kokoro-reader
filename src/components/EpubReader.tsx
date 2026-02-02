import { useState, useRef, useCallback, useEffect } from 'react';
import { ReactReader, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition, NavItem } from 'epubjs';
import './EpubReader.css';

export interface ReaderActions {
    navigateTo: (href: string) => void;
    nextPage: () => void;
    prevPage: () => void;
}

interface EpubReaderProps {
    url: string | ArrayBuffer;
    title?: string;
    initialLocation?: string;
    onTocLoaded?: (toc: NavItem[]) => void;
    onLocationChange?: (location: string) => void;
    onTextSelected?: (text: string, context: string, rect?: DOMRect) => void;
    onGetPageTextReady?: (getter: () => string | null) => void;
    onGetParagraphTextReady?: (getter: () => string | null) => void;
    onGetAllRemainingTextReady?: (getter: () => string | null) => void;
    onActionsReady?: (actions: ReaderActions) => void;
    onReadFromParagraph?: () => void;  // Called when user clicks "Read from here" button
    fontSize: number;
    fontFamily: string;
    theme: 'dark' | 'light' | 'sepia';
    isPlaying?: boolean;
    currentChunkIndex?: number;
    currentChunkText?: string | null;  // Text of current chunk for highlighting
}

// CSS styles to inject into EPUB content for TTS indicators
const getTtsIndicatorStyles = (theme: 'dark' | 'light' | 'sepia') => {
    const colors = {
        dark: { marker: '#4ade80', highlight: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.4)', bg: 'rgba(74, 222, 128, 0.2)' },
        light: { marker: '#16a34a', highlight: 'rgba(22, 163, 74, 0.1)', border: 'rgba(22, 163, 74, 0.3)', bg: 'rgba(22, 163, 74, 0.15)' },
        sepia: { marker: '#854d0e', highlight: 'rgba(133, 77, 14, 0.1)', border: 'rgba(133, 77, 14, 0.3)', bg: 'rgba(133, 77, 14, 0.15)' },
    };
    const c = colors[theme];

    return `
        /* TTS Start Point Marker - visible inline badge */
        .kokoro-tts-start {
            position: relative !important;
            border-left: 4px solid ${c.marker} !important;
            padding-left: 16px !important;
            margin-left: -20px !important;
            background: ${c.bg} !important;
            border-radius: 0 8px 8px 0 !important;
        }
        
        /* Badge indicator for read start point */
        .kokoro-tts-badge {
            display: inline-block !important;
            font-size: 12px !important;
            color: ${c.marker} !important;
            font-weight: 600 !important;
            background: ${c.bg} !important;
            padding: 2px 8px !important;
            border-radius: 4px !important;
            margin-bottom: 8px !important;
        }
        
        /* Currently Reading Highlight */
        .kokoro-tts-reading {
            background: ${c.highlight} !important;
            border-left: 4px solid ${c.border} !important;
            padding-left: 16px !important;
            margin-left: -20px !important;
            border-radius: 0 8px 8px 0 !important;
            transition: background 0.3s ease !important;
        }
        
        /* Pulse animation for currently reading */
        @keyframes kokoro-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        .kokoro-tts-reading {
            animation: kokoro-pulse 2s ease-in-out infinite !important;
        }
    `;
};

// Theme-specific styles for the epub content
const getReaderStyles = (theme: 'dark' | 'light' | 'sepia'): IReactReaderStyle => {
    const themes = {
        dark: {
            background: '#0f0f0f',
            text: '#f0f0f0',
        },
        light: {
            background: '#fafafa',
            text: '#1a1a1a',
        },
        sepia: {
            background: '#f5eed9',
            text: '#352f24',
        },
    };

    const colors = themes[theme];

    return {
        container: {
            overflow: 'auto',
            height: '100%',
        },
        readerArea: {
            position: 'relative',
            zIndex: 1,
            height: '100%',
            width: '100%',
            backgroundColor: colors.background,
            transition: 'all 0.3s ease',
        },
        containerExpanded: {
            transform: 'translateX(0)',
        },
        titleArea: {
            position: 'absolute',
            top: '20px',
            left: '50px',
            right: '50px',
            textAlign: 'center',
            color: colors.text,
            opacity: 0.6,
        },
        reader: {
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
        },
        swipeWrapper: {
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 200,
        },
        prev: {
            left: 5,
        },
        next: {
            right: 5,
        },
        arrow: {
            outline: 'none',
            border: 'none',
            background: 'rgba(0, 0, 0, 0.3)',
            borderRadius: '50%',
            width: '50px',
            height: '50px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'absolute',
            top: '50%',
            margin: '-25px 0 0 0',
            padding: '0',
            fontSize: '24px',
            color: '#ffffff',
            opacity: 0.7,
            cursor: 'pointer',
            transition: 'opacity 0.2s, background 0.2s',
            zIndex: 100,
        },
        arrowHover: {
            opacity: 1,
        },
        tocBackground: {
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            right: 0,
            background: 'rgba(0, 0, 0, 0.6)',
            zIndex: 10,
        },
        tocArea: {
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: -1,
            width: '0px',
            display: 'none',
            overflowY: 'auto',
            backgroundColor: colors.background,
            padding: '0',
        },
        tocAreaButton: {
            userSelect: 'none',
            appearance: 'none',
            background: 'none',
            border: 'none',
            display: 'block',
            fontSize: '14px',
            textAlign: 'left',
            padding: '10px 0',
            color: colors.text,
            cursor: 'pointer',
            width: '100%',
        },
        tocButton: {
            background: 'none',
            border: 'none',
            width: '40px',
            height: '40px',
            position: 'absolute',
            top: '10px',
            left: '10px',
            zIndex: 20,
            cursor: 'pointer',
            opacity: 0.6,
            fontSize: '24px',
            color: colors.text,
        },
        tocButtonExpanded: {
            background: 'transparent',
        },
        loadingView: {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: colors.text,
        },
        // Additional required properties
        toc: {
            display: 'none', // We use our own TOC in sidebar
        },
        tocButtonBar: {
            display: 'none',
        },
        tocButtonBarTop: {
            display: 'none',
        },
        tocButtonBottom: {
            display: 'none',
        },
        errorView: {
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            color: colors.text,
            textAlign: 'center',
        },
    };
};

export function EpubReader({
    url,
    title,
    initialLocation,
    onTocLoaded,
    onLocationChange,
    onTextSelected,
    onGetPageTextReady,
    onGetParagraphTextReady,
    onGetAllRemainingTextReady,
    onActionsReady,
    onReadFromParagraph,
    fontSize,
    fontFamily,
    theme,
    isPlaying = false,
    currentChunkIndex = 0,
    currentChunkText,
}: EpubReaderProps) {
    const [location, setLocation] = useState<string | number>(initialLocation || 0);
    const [readButtonPos, setReadButtonPos] = useState<{ x: number; y: number } | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const tocRef = useRef<NavItem[]>([]);
    const lastBlockIndexRef = useRef<number | null>(null);
    const lastBlockDocRef = useRef<Document | null>(null);
    const instrumentedDocsRef = useRef<WeakSet<Document>>(new WeakSet());
    const lastVisibleDocRef = useRef<Document | null>(null);

    // Create getter function for current page text
    const getCurrentPageText = useCallback((): string | null => {
        if (!renditionRef.current) return null;

        try {
            // getContents() returns an array-like object; types are incomplete
            const contents = renditionRef.current.getContents() as unknown as Array<{ document: Document }>;
            if (contents && contents.length > 0) {
                // In continuous scrolled mode, contents[0] is often the earliest loaded iframe
                // (i.e., the start of the book). Prefer the last visible doc we saw rendered,
                // falling back to the latest content.
                const preferredDoc = lastVisibleDocRef.current;
                const content = preferredDoc ? { document: preferredDoc } : contents[contents.length - 1];
                const contentDoc = content.document;
                if (contentDoc && contentDoc.body) {
                    const raw = contentDoc.body.innerText || contentDoc.body.textContent || null;
                    return raw ? raw.replace(/\s{2,}/g, ' ').trim() : null;
                }
            }
        } catch (e) {
            console.error('Error getting page text:', e);
        }
        return null;
    }, []);

    const getTextFromLastParagraph = useCallback((): string | null => {
        const doc = lastBlockDocRef.current;
        const idx = lastBlockIndexRef.current;
        if (!doc || idx === null) return null;

        const blocks = Array.from(
            doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
        ) as HTMLElement[];
        if (blocks.length === 0) {
            const t = doc.body?.innerText || doc.body?.textContent || null;
            return t ? t.replace(/\s{2,}/g, ' ').trim() : null;
        }

        const start = Math.min(Math.max(idx, 0), blocks.length - 1);
        const combined = blocks
            .slice(start)
            .map((el) => (el.innerText || el.textContent || '').replace(/\s{2,}/g, ' ').trim())
            .filter(Boolean)
            .join('\n\n');

        return combined.trim() || null;
    }, []);

    // Get ALL remaining text from clicked position through entire book
    const getAllRemainingText = useCallback((): string | null => {
        if (!renditionRef.current) return null;

        try {
            // Get all loaded content documents
            const contents = renditionRef.current.getContents() as unknown as Array<{ document: Document }>;
            if (!contents || contents.length === 0) return null;

            // Start with text from the clicked paragraph forward
            const startDoc = lastBlockDocRef.current;
            const startIdx = lastBlockIndexRef.current;

            const allText: string[] = [];

            for (const content of contents) {
                const doc = content.document;
                if (!doc || !doc.body) continue;

                const blocks = Array.from(
                    doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
                ) as HTMLElement[];

                // Determine starting index for this document
                let fromIdx = 0;
                if (doc === startDoc && startIdx !== null) {
                    fromIdx = startIdx;
                } else if (startDoc && doc !== startDoc) {
                    // Check if this doc comes before or after the start doc
                    // by comparing document order in the array
                    const startDocIndex = contents.findIndex(c => c.document === startDoc);
                    const thisDocIndex = contents.findIndex(c => c.document === doc);
                    if (thisDocIndex < startDocIndex) {
                        // This document is before our start point, skip entirely
                        continue;
                    }
                }

                if (blocks.length === 0) {
                    // No block elements, get all text
                    const t = doc.body.innerText || doc.body.textContent || '';
                    if (t.trim()) allText.push(t.trim());
                } else {
                    // Get text from blocks starting at fromIdx
                    const text = blocks
                        .slice(fromIdx)
                        .map((el) => (el.innerText || el.textContent || '').replace(/\s{2,}/g, ' ').trim())
                        .filter(Boolean)
                        .join('\n\n');
                    if (text) allText.push(text);
                }
            }

            return allText.join('\n\n').trim() || null;
        } catch (e) {
            console.error('Error getting all remaining text:', e);
            return null;
        }
    }, []);

    // Expose the getter when ready
    useEffect(() => {
        onGetPageTextReady?.(getCurrentPageText);
    }, [onGetPageTextReady, getCurrentPageText]);

    useEffect(() => {
        onGetParagraphTextReady?.(getTextFromLastParagraph);
    }, [onGetParagraphTextReady, getTextFromLastParagraph]);

    useEffect(() => {
        onGetAllRemainingTextReady?.(getAllRemainingText);
    }, [onGetAllRemainingTextReady, getAllRemainingText]);

    // Find the DOM element corresponding to the current chunk index
    const findElementForChunk = useCallback((targetIndex: number): HTMLElement | null => {
        if (!renditionRef.current) return null;

        try {
            const contents = renditionRef.current.getContents() as unknown as Array<{ document: Document }>;
            if (!contents || contents.length === 0) return null;

            const startDoc = lastBlockDocRef.current;
            const startIdx = lastBlockIndexRef.current;

            // If we don't have a start point, we can't calculate offset
            if (!startDoc || startIdx === null) return null;

            let currentIndex = 0;

            for (const content of contents) {
                const doc = content.document;
                if (!doc || !doc.body) continue;

                // Determine starting index for this document
                let fromIdx = 0;
                if (doc === startDoc) {
                    fromIdx = startIdx;
                } else if (doc !== startDoc) {
                    // Check if this doc comes before startDoc
                    const startDocIndex = contents.findIndex(c => c.document === startDoc);
                    const thisDocIndex = contents.findIndex(c => c.document === doc);
                    if (thisDocIndex < startDocIndex) continue;
                }

                const blocks = Array.from(
                    doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
                ) as HTMLElement[];

                if (blocks.length === 0) {
                    // Fallback to body content if valid
                    const t = doc.body.innerText || doc.body.textContent || '';
                    if (t.trim()) {
                        if (currentIndex === targetIndex) return doc.body;
                        currentIndex++;
                    }
                } else {
                    // Iterate blocks starting from fromIdx
                    for (let i = fromIdx; i < blocks.length; i++) {
                        const el = blocks[i];
                        const t = (el.innerText || el.textContent || '').replace(/\s{2,}/g, ' ').trim();
                        if (t) {
                            if (currentIndex === targetIndex) return el;
                            currentIndex++;
                        }
                    }
                }
            }
        } catch (e) {
            console.error('Error finding element for chunk:', e);
        }
        return null;
    }, []);

    // Update reading highlight when playback state changes or chunk text updates
    useEffect(() => {
        // Clear existing highlights in currently loaded documents
        if (renditionRef.current) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const contents = (renditionRef.current as any).getContents() as unknown as Array<{ document: Document }>;
                contents?.forEach(content => {
                    try {
                        content.document?.querySelectorAll('.kokoro-tts-reading').forEach(el => {
                            el.classList.remove('kokoro-tts-reading');
                        });
                    } catch {
                        // ignore
                    }
                });
            } catch {
                // ignore
            }
        }

        if (!isPlaying) return;

        // Try text-based matching first (more accurate)
        if (currentChunkText && renditionRef.current) {
            try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const contents = (renditionRef.current as any).getContents() as unknown as Array<{ document: Document }>;

                // Normalize the chunk text for comparison
                const normalizedChunk = currentChunkText.replace(/\s+/g, ' ').trim().toLowerCase();
                // Take first 50 chars for matching (chunks can be long)
                const searchText = normalizedChunk.substring(0, 50);

                for (const content of contents || []) {
                    const doc = content.document;
                    if (!doc) continue;

                    const blocks = Array.from(
                        doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
                    ) as HTMLElement[];

                    for (const block of blocks) {
                        const blockText = (block.innerText || block.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();

                        // Check if this block contains the start of the chunk
                        if (blockText.includes(searchText)) {
                            block.classList.add('kokoro-tts-reading');
                            block.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                                inline: 'nearest'
                            });
                            return; // Found it, stop searching
                        }
                    }
                }
            } catch (e) {
                console.error('Error with text-based highlighting:', e);
            }
        }

        // Fallback: use index-based matching
        const targetEl = findElementForChunk(currentChunkIndex);

        if (targetEl) {
            targetEl.classList.add('kokoro-tts-reading');
            targetEl.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
                inline: 'nearest'
            });
        } else {
            // Last fallback: highlight the start block if we're at index 0
            if (currentChunkIndex === 0 && lastBlockDocRef.current) {
                const startBlock = lastBlockDocRef.current.querySelector('.kokoro-tts-start');
                if (startBlock) {
                    startBlock.classList.add('kokoro-tts-reading');
                    startBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }
        }
    }, [isPlaying, currentChunkIndex, currentChunkText, findElementForChunk]);

    // Navigation actions
    const navigateTo = useCallback((href: string) => {
        if (renditionRef.current) {
            renditionRef.current.display(href);
        }
    }, []);

    const nextPage = useCallback(() => {
        if (renditionRef.current) {
            renditionRef.current.next();
        }
    }, []);

    const prevPage = useCallback(() => {
        if (renditionRef.current) {
            renditionRef.current.prev();
        }
    }, []);

    // Expose actions when ready
    useEffect(() => {
        if (onActionsReady) {
            onActionsReady({
                navigateTo,
                nextPage,
                prevPage
            });
        }
    }, [onActionsReady, navigateTo, nextPage, prevPage]);

    const locationChanged = useCallback((epubcfi: string) => {
        setLocation(epubcfi);
        onLocationChange?.(epubcfi);
    }, [onLocationChange]);

    const handleRendition = useCallback((rendition: Rendition) => {
        renditionRef.current = rendition;

        // Strip any scripts from EPUB content to reduce sandbox warnings.
        // (Many EPUBs embed scripts; WKWebView logs blocked execution when iframe is sandboxed.)
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (rendition as any).hooks?.content?.register?.((contents: Contents) => {
                try {
                    const doc = contents.document;
                    doc?.querySelectorAll?.('script')?.forEach((s) => s.remove());
                } catch {
                    // ignore
                }
            });
        } catch {
            // ignore
        }

        // Apply font settings
        rendition.themes.fontSize(`${fontSize}px`);
        rendition.themes.font(fontFamily);

        // Apply theme colors with comprehensive CSS - use aggressive selectors
        const themeStyles = {
            dark: {
                '*': {
                    color: '#ffffff !important',
                },
                body: {
                    background: '#1a1a1a !important',
                    color: '#ffffff !important',
                    'padding': '20px 40px !important',
                    'line-height': '1.6 !important',
                },
                'p, div, span, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, code': {
                    color: '#ffffff !important',
                    'background-color': 'transparent !important',
                },
                'a': {
                    color: '#7c9dff !important',
                },
                'img': {
                    'max-width': '100% !important',
                },
            },
            light: {
                '*': {
                    color: '#1a1a1a !important',
                },
                body: {
                    background: '#ffffff !important',
                    color: '#1a1a1a !important',
                    'padding': '20px 40px !important',
                    'line-height': '1.6 !important',
                },
                'p, div, span, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, code': {
                    color: '#1a1a1a !important',
                    'background-color': 'transparent !important',
                },
                'a': {
                    color: '#0066cc !important',
                },
                'img': {
                    'max-width': '100% !important',
                },
            },
            sepia: {
                '*': {
                    color: '#352f24 !important',
                },
                body: {
                    background: '#f5eed9 !important',
                    color: '#352f24 !important',
                    'padding': '20px 40px !important',
                    'line-height': '1.6 !important',
                },
                'p, div, span, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, pre, code': {
                    color: '#352f24 !important',
                    'background-color': 'transparent !important',
                },
                'a': {
                    color: '#7c3aed !important',
                },
                'img': {
                    'max-width': '100% !important',
                },
            },
        };

        rendition.themes.register('current', themeStyles[theme]);
        rendition.themes.select('current');

        // Force re-render to apply styles - also set default values
        const colors = themeStyles[theme];
        rendition.themes.override('color', colors.body.color.replace(' !important', ''));
        rendition.themes.override('background', colors.body.background.replace(' !important', ''));

        // Handle text selection for TTS and Clarify
        rendition.on('selected', (cfiRange: string, contents: Contents) => {
            try {
                // epubjs provides a helper to resolve the range from the CFI.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const range: Range | null = (rendition as any).getRange?.(cfiRange) ?? null;
                const text = range ? range.toString() : '';

                if (text && range) {
                    // Extract context (paragraph text)
                    let contextNode = range.commonAncestorContainer;
                    if (contextNode.nodeType === Node.TEXT_NODE && contextNode.parentElement) {
                        contextNode = contextNode.parentElement;
                    }
                    const context = contextNode.textContent || '';

                    const rect = range.getBoundingClientRect();
                    const iframe = contents.document.defaultView?.frameElement as HTMLIFrameElement;
                    const iframeRect = iframe?.getBoundingClientRect();

                    if (iframeRect) {
                        // adjustment for iframe offset
                        const adjustedRect = new DOMRect(
                            rect.left + iframeRect.left,
                            rect.top + iframeRect.top,
                            rect.width,
                            rect.height
                        );
                        onTextSelected?.(text, context, adjustedRect);
                        return;
                    }
                    onTextSelected?.(text, context);
                    return;
                }

                onTextSelected?.('', '');
            } catch {
                onTextSelected?.('', '');
            }
        });

        // Track the last clicked paragraph so we can read from there forward.
        rendition.on('rendered', (_section: unknown, contents: Contents) => {
            const doc = contents.document;
            if (!doc || instrumentedDocsRef.current.has(doc)) return;
            instrumentedDocsRef.current.add(doc);

            // Track the most recently rendered document as our "current page".
            lastVisibleDocRef.current = doc;

            // Inject TTS indicator styles into the EPUB content
            const existingStyle = doc.getElementById('kokoro-tts-styles');
            if (!existingStyle) {
                const styleEl = doc.createElement('style');
                styleEl.id = 'kokoro-tts-styles';
                styleEl.textContent = getTtsIndicatorStyles(theme);
                doc.head?.appendChild(styleEl);
            }

            const indexParagraphs = () => {
                const blocks = Array.from(
                    doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6')
                ) as HTMLElement[];
                blocks.forEach((el, idx) => {
                    el.dataset.kokoroBlockIndex = String(idx);
                });
            };

            indexParagraphs();

            // Update selection on mouseup - only when text is selected.
            // Don't clear selection on every mouseup, as that causes the selection
            // to be lost when clicking play button or anywhere outside iframe.
            doc.addEventListener(
                'mouseup',
                () => {
                    const selection = contents.window.getSelection();
                    const text = selection?.toString() ?? '';

                    if (text && selection && selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);

                        // Extract context
                        let contextNode = range.commonAncestorContainer;
                        if (contextNode.nodeType === Node.TEXT_NODE && contextNode.parentElement) {
                            contextNode = contextNode.parentElement;
                        }
                        const context = contextNode.textContent || '';

                        const rect = range.getBoundingClientRect();
                        const iframe = contents.document.defaultView?.frameElement as HTMLIFrameElement;
                        const iframeRect = iframe?.getBoundingClientRect();

                        if (iframeRect) {
                            const adjustedRect = new DOMRect(
                                rect.left + iframeRect.left,
                                rect.top + iframeRect.top,
                                rect.width,
                                rect.height
                            );
                            onTextSelected?.(text, context, adjustedRect);
                            return;
                        }
                        onTextSelected?.(text, context);
                    }
                    // Note: We intentionally don't clear selection when no text is selected,
                    // as that would cause the selected text to be lost when clicking elsewhere.
                },
                true,
            );

            doc.addEventListener(
                'click',
                (e) => {
                    const target = e.target as HTMLElement | null;
                    const block = target?.closest?.('p, li, h1, h2, h3, h4, h5, h6') as HTMLElement | null;
                    if (!block) {
                        // Clicked outside a paragraph, hide the button
                        setReadButtonPos(null);
                        return;
                    }

                    // Store reference for later use regardless of indexing
                    lastBlockDocRef.current = doc;
                    lastVisibleDocRef.current = doc;

                    const idxStr = block.dataset.kokoroBlockIndex;
                    const idx = idxStr ? parseInt(idxStr, 10) : NaN;
                    if (Number.isFinite(idx)) {
                        lastBlockIndexRef.current = idx;
                    }

                    // Remove previous start marker from this document
                    doc.querySelectorAll('.kokoro-tts-start').forEach(el => {
                        el.classList.remove('kokoro-tts-start');
                    });

                    // Add start marker to clicked block
                    block.classList.add('kokoro-tts-start');

                    // Calculate position for floating "Read from here" button
                    // Show for ANY paragraph, not just indexed ones
                    const blockRect = block.getBoundingClientRect();
                    const iframe = contents.document.defaultView?.frameElement as HTMLIFrameElement;
                    const iframeRect = iframe?.getBoundingClientRect();

                    if (iframeRect) {
                        // Position button above the paragraph, to the right
                        // Using absolute position relative to the window
                        const x = Math.max(10, iframeRect.left + blockRect.left);
                        const y = iframeRect.top + blockRect.top - 35; // Above the paragraph

                        // Debug log
                        console.log('[EpubReader] Read button position:', { x, y, blockRect, iframeRect });

                        setReadButtonPos({ x, y });
                    }
                },
                true,
            );

            // Auto-advance to next chapter when scrolling near bottom (infinite scroll effect)
            let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
            const scrollContainer = doc.scrollingElement || doc.documentElement || doc.body;

            const handleScroll = () => {
                if (scrollTimeout) return; // Debounce

                scrollTimeout = setTimeout(() => {
                    scrollTimeout = null;

                    const scrollTop = scrollContainer.scrollTop;
                    const scrollHeight = scrollContainer.scrollHeight;
                    const clientHeight = scrollContainer.clientHeight;

                    // Check if near bottom (within 100px threshold)
                    if (scrollHeight - scrollTop - clientHeight < 100) {
                        // Trigger next page navigation
                        renditionRef.current?.next();
                    }
                }, 150);
            };

            // Listen on the window of the iframe for scroll events
            contents.window.addEventListener('scroll', handleScroll, { passive: true });
        });
    }, [fontSize, fontFamily, theme, onTextSelected]);

    // Update font size when settings change
    if (renditionRef.current) {
        renditionRef.current.themes.fontSize(`${fontSize}px`);
        renditionRef.current.themes.font(fontFamily);
    }

    const handleTocLoaded = useCallback((toc: NavItem[]) => {
        tocRef.current = toc;
        onTocLoaded?.(toc);
    }, [onTocLoaded]);

    const handleReadFromHere = useCallback(() => {
        setReadButtonPos(null);
        onReadFromParagraph?.();
    }, [onReadFromParagraph]);

    // Hide button when playback starts
    useEffect(() => {
        if (isPlaying) {
            setReadButtonPos(null);
        }
    }, [isPlaying]);

    return (
        <div className="epub-reader-container">
            <ReactReader
                url={url}
                title={title}
                location={location}
                locationChanged={locationChanged}
                getRendition={handleRendition}
                tocChanged={handleTocLoaded}
                readerStyles={getReaderStyles(theme)}
                showToc={false}
                swipeable={false}
                epubOptions={{
                    flow: 'scrolled-doc',
                    width: '100%',
                }}
            />
            {/* Floating "Read from here" button */}
            {readButtonPos && !isPlaying && (
                <button
                    className="epub-read-from-here-btn"
                    style={{
                        position: 'fixed',
                        left: readButtonPos.x,
                        top: readButtonPos.y,
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 500,
                        boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
                        transition: 'transform 0.15s ease, opacity 0.15s ease',
                        background: theme === 'dark' ? '#4ade80' : theme === 'sepia' ? '#854d0e' : '#16a34a',
                        color: theme === 'dark' ? '#000' : '#fff',
                    }}
                    onClick={handleReadFromHere}
                    title="Read from this paragraph"
                >
                    <span>▶</span>
                    <span>Read</span>
                </button>
            )}
        </div>
    );
}
