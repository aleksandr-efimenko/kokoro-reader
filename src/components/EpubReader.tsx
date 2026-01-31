import { useState, useRef, useCallback } from 'react';
import { ReactReader, type IReactReaderStyle } from 'react-reader';
import type { Contents, Rendition, NavItem } from 'epubjs';
import './EpubReader.css';

interface EpubReaderProps {
    url: string;
    title?: string;
    onTocLoaded?: (toc: NavItem[]) => void;
    onLocationChange?: (location: string) => void;
    onTextSelected?: (text: string) => void;
    fontSize: number;
    fontFamily: string;
    theme: 'dark' | 'light' | 'sepia';
}

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
            background: '#f4ecd8',
            text: '#3d3929',
        },
    };

    const colors = themes[theme];

    return {
        container: {
            overflow: 'hidden',
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
            left: 1,
        },
        next: {
            right: 1,
        },
        arrow: {
            outline: 'none',
            border: 'none',
            background: 'none',
            position: 'absolute',
            top: '50%',
            margin: '-32px 0 0 0',
            padding: '0 20px',
            fontSize: '40px',
            color: colors.text,
            opacity: 0.5,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
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
            zIndex: 11,
            width: '280px',
            overflowY: 'auto',
            backgroundColor: colors.background,
            padding: '20px',
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
    onTocLoaded,
    onLocationChange,
    onTextSelected,
    fontSize,
    fontFamily,
    theme,
}: EpubReaderProps) {
    const [location, setLocation] = useState<string | number>(0);
    const renditionRef = useRef<Rendition | null>(null);
    const tocRef = useRef<NavItem[]>([]);

    const locationChanged = useCallback((epubcfi: string) => {
        setLocation(epubcfi);
        onLocationChange?.(epubcfi);
    }, [onLocationChange]);

    const handleRendition = useCallback((rendition: Rendition) => {
        renditionRef.current = rendition;

        // Apply font settings
        rendition.themes.fontSize(`${fontSize}px`);
        rendition.themes.font(fontFamily);

        // Apply theme colors
        const themeStyles = {
            dark: { body: { background: '#0f0f0f', color: '#f0f0f0' } },
            light: { body: { background: '#fafafa', color: '#1a1a1a' } },
            sepia: { body: { background: '#f4ecd8', color: '#3d3929' } },
        };

        rendition.themes.register('current', themeStyles[theme]);
        rendition.themes.select('current');

        // Handle text selection for TTS
        rendition.on('selected', (_cfiRange: string, contents: Contents) => {
            const selection = contents.window.getSelection();
            if (selection && selection.toString().trim()) {
                onTextSelected?.(selection.toString());
            }
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
                epubOptions={{
                    flow: 'scrolled',
                    manager: 'continuous',
                }}
            />
        </div>
    );
}
