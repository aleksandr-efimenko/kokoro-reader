import './Sidebar.css';
import type { Book } from '../types';

interface SidebarProps {
    book: Book | null;
    currentChapterIndex: number;
    onChapterSelect: (index: number) => void;
    onOpenFile: () => void;
    isLoading: boolean;
    onNextChapter: () => void;
    onPrevChapter: () => void;
}

export function Sidebar({
    book,
    currentChapterIndex,
    onChapterSelect,
    onOpenFile,
    isLoading,
    onNextChapter,
    onPrevChapter,
}: SidebarProps) {
    return (
        <aside className="sidebar">
            {/* Header */}
            <div className="sidebar-header">
                <h1 className="app-title">📖 Kokoro Reader</h1>
            </div>

            {/* Open file button */}
            <button className="btn btn-primary open-btn" onClick={onOpenFile} disabled={isLoading}>
                {isLoading ? (
                    <>
                        <div className="spinner" />
                        Opening...
                    </>
                ) : (
                    <>📂 Open Book</>
                )}
            </button>

            {/* Book info */}
            {book && (
                <div className="book-info fade-in">
                    <h2 className="book-title">{book.metadata.title}</h2>
                    <p className="book-author">{book.metadata.author}</p>
                    <p className="book-stats">
                        {book.chapters.length} chapters • {book.total_words.toLocaleString()} words
                    </p>

                    {/* Quick nav */}
                    <div className="quick-nav">
                        <button
                            className="btn btn-secondary"
                            onClick={onPrevChapter}
                            disabled={currentChapterIndex <= 0}
                        >
                            ◀ Prev
                        </button>
                        <span className="chapter-indicator">
                            {currentChapterIndex + 1} / {book.chapters.length}
                        </span>
                        <button
                            className="btn btn-secondary"
                            onClick={onNextChapter}
                            disabled={currentChapterIndex >= book.chapters.length - 1}
                        >
                            Next ▶
                        </button>
                    </div>
                </div>
            )}

            {/* Table of contents */}
            {book && (
                <div className="toc">
                    <h3 className="toc-title">Contents</h3>
                    <ul className="chapter-list">
                        {book.chapters.map((chapter, index) => (
                            <li key={index}>
                                <button
                                    className={`chapter-item ${index === currentChapterIndex ? 'active' : ''}`}
                                    onClick={() => onChapterSelect(index)}
                                >
                                    <span className="chapter-number">{index + 1}</span>
                                    <span className="chapter-name">{chapter.title}</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Footer */}
            <div className="sidebar-footer">
                <span className="version">v0.1.0</span>
            </div>
        </aside>
    );
}
