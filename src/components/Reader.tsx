import './Reader.css';
import type { Chapter } from '../types';

interface ReaderProps {
    chapter: Chapter | null;
    fontSize: number;
    fontFamily: string;
    onFontSizeChange: (size: number) => void;
    isPlaying: boolean;
    currentWordIndex?: number;
    onOpenSettings: () => void;
    onNextChapter: () => void;
    onPrevChapter: () => void;
    hasNext: boolean;
    hasPrev: boolean;
}

export function Reader({
    chapter,
    fontSize,
    fontFamily,
    onFontSizeChange,
    isPlaying,
    currentWordIndex = -1,
    onOpenSettings,
    onNextChapter,
    onPrevChapter,
    hasNext,
    hasPrev,
}: ReaderProps) {
    if (!chapter) {
        return (
            <div className="reader-empty">
                <div className="empty-state fade-in">
                    <span className="empty-icon">📚</span>
                    <h2>No Book Open</h2>
                    <p>Open an EPUB or text file to start reading</p>
                </div>
            </div>
        );
    }

    // Split content into words for highlighting
    const renderContent = () => {
        if (!isPlaying) {
            return <p>{chapter.content}</p>;
        }

        // When playing, wrap each word in a span for highlighting
        const words = chapter.content.split(/(\s+)/);
        let wordIndex = 0;

        return (
            <p>
                {words.map((part, i) => {
                    if (/\s+/.test(part)) {
                        return <span key={i}>{part}</span>;
                    }

                    const isActive = wordIndex === currentWordIndex;
                    const isSpoken = wordIndex < currentWordIndex;
                    const idx = wordIndex;
                    wordIndex++;

                    return (
                        <span
                            key={i}
                            className={`word ${isActive ? 'active' : ''} ${isSpoken ? 'spoken' : ''}`}
                            data-word-index={idx}
                        >
                            {part}
                        </span>
                    );
                })}
            </p>
        );
    };

    return (
        <div className="reader">
            {/* Reader toolbar */}
            <div className="reader-toolbar">
                <div className="toolbar-left">
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={onPrevChapter}
                        disabled={!hasPrev}
                        title="Previous chapter"
                    >
                        ◀
                    </button>
                    <h3 className="chapter-title">{chapter.title}</h3>
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={onNextChapter}
                        disabled={!hasNext}
                        title="Next chapter"
                    >
                        ▶
                    </button>
                </div>

                <div className="toolbar-right">
                    <div className="font-controls">
                        <button
                            className="btn btn-icon btn-secondary"
                            onClick={() => onFontSizeChange(Math.max(12, fontSize - 2))}
                            title="Decrease font size"
                        >
                            A-
                        </button>
                        <span className="font-size-display">{fontSize}px</span>
                        <button
                            className="btn btn-icon btn-secondary"
                            onClick={() => onFontSizeChange(Math.min(32, fontSize + 2))}
                            title="Increase font size"
                        >
                            A+
                        </button>
                    </div>
                    <button
                        className="btn btn-icon btn-secondary"
                        onClick={onOpenSettings}
                        title="Settings"
                    >
                        ⚙️
                    </button>
                </div>
            </div>

            {/* Reading content */}
            <div
                className="reader-content"
                style={{ fontSize: `${fontSize}px`, fontFamily }}
            >
                <div className="reader-text">
                    {renderContent()}
                </div>
            </div>
        </div>
    );
}
