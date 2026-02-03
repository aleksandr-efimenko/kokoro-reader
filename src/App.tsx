import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { EpubReader } from './components/EpubReader';
import { AudioControls } from './components/AudioControls';
import { ModelSetup } from './components/ModelSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { useTTS } from './hooks/useTTS';
import { useSettings } from './hooks/useSettings';
import { useAI } from './hooks/useAI';
import { useLibrary, type BookEntry } from './hooks/useLibrary';
import { ClarifyPopover } from './components/ClarifyPopover';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import type { ReaderActions } from './components/EpubReader';
import type { NavItem } from 'epubjs';

interface ModelStatus {
  is_ready: boolean;
  is_downloading: boolean;
  missing_files: string[];
  download_size_bytes: number;
  model_dir: string;
}
import './styles/index.css';

interface BookInfo {
  path: string;
  title: string;
  author: string;
}

function App() {
  const [isModelReady, setIsModelReady] = useState<boolean | null>(null);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [currentBookId, setCurrentBookId] = useState<string | null>(null);
  const [epubData, setEpubData] = useState<ArrayBuffer | null>(null);
  const [initialLocation, setInitialLocation] = useState<string | undefined>(undefined);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [selection, setSelection] = useState<{ text: string; context: string; rect: DOMRect | null } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const settings = useSettings();
  const tts = useTTS();
  const ai = useAI();
  const library = useLibrary();

  // Check Kokoro model status on mount
  useEffect(() => {
    invoke<ModelStatus>('check_model_status')
      .then((status) => {
        // Ready only if model is fully downloaded
        setIsModelReady(status.is_ready);
      })
      .catch(() => {
        setIsModelReady(false);
      });
  }, []);

  // TTS Warmup on app startup when enabled in settings
  useEffect(() => {
    if (settings.ttsWarmup) {
      console.log('[App] TTS warmup enabled, triggering warmup...');
      invoke<boolean>('tts_warmup')
        .then((success) => {
          console.log('[App] TTS warmup completed:', success ? 'success' : 'failed');
        })
        .catch((err) => {
          console.warn('[App] TTS warmup error:', err);
        });
    }
  }, [settings.ttsWarmup]);

  // Open a book from file path (can be called from file picker or library)
  const openBook = useCallback(async (filePath: string, savedLocation?: string) => {
    try {
      // Stop any existing playback immediately
      tts.stop();
      setIsLoading(true);

      // Read file bytes via Tauri command
      const bytes = await invoke<number[]>('read_epub_bytes', { path: filePath });

      // Convert to ArrayBuffer for epubjs
      const uint8Array = new Uint8Array(bytes);
      setEpubData(uint8Array.buffer);

      // Extract title from filename for now
      const filename = filePath.split('/').pop() || filePath;
      const title = filename.replace('.epub', '');

      // Add/update book in library
      const book = library.addBook(filePath, title);
      setCurrentBookId(book.id);

      // Set initial location if we have a saved position
      setInitialLocation(savedLocation);

      setBookInfo({
        path: filePath,
        title,
        author: '',
      });

      setIsLoading(false);
    } catch (e) {
      console.error('Failed to open file:', e);
      setIsLoading(false);
    }
  }, [library]);

  const handleOpenFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'EPUB',
            extensions: ['epub'],
          },
        ],
      });

      if (selected && typeof selected === 'string') {
        // Check if we have a saved position for this book
        const existingBook = library.getBookByPath(selected);
        await openBook(selected, existingBook?.location);
      }
    } catch (e) {
      console.error('Failed to open file:', e);
    }
  };

  // Open a book from the library
  const handleOpenFromLibrary = useCallback((book: BookEntry) => {
    openBook(book.filePath, book.location);
  }, [openBook]);

  // Remove a book from library
  const handleRemoveFromLibrary = useCallback((bookId: string) => {
    library.removeBook(bookId);
  }, [library]);

  // Flatten nested TOC items (some EPUBs have deeply nested structures)
  const flattenToc = (items: NavItem[], depth = 0): (NavItem & { depth: number })[] => {
    const result: (NavItem & { depth: number })[] = [];
    for (const item of items) {
      result.push({ ...item, depth });
      if (item.subitems && item.subitems.length > 0) {
        result.push(...flattenToc(item.subitems, depth + 1));
      }
    }
    return result;
  };

  const handleTocLoaded = (tocItems: NavItem[]) => {
    // Flatten nested TOC and limit to reasonable number
    const flattened = flattenToc(tocItems);
    setToc(flattened.slice(0, 100)); // Limit to first 100 items
  };

  const handleTextSelected = (text: string, context: string, rect?: DOMRect) => {
    console.log('[DEBUG] handleTextSelected:', { text: text.substring(0, 50), hasRect: !!rect, rect });
    if (!text) {
      setSelection(null);
      return;
    }
    setSelection({ text, context, rect: rect || null });
  };

  // Save reading progress when location changes
  const handleLocationChange = useCallback((location: string) => {
    if (currentBookId && location) {
      // Debounce-ish: only save if it's a CFI (valid location)
      if (location.startsWith('epubcfi')) {
        library.updateProgress(currentBookId, location);
      }
    }
  }, [currentBookId, library]);

  // Store the page text getter function from EpubReader
  const [getPageText, setGetPageText] = useState<(() => string | null) | null>(null);
  const [getParagraphText, setGetParagraphText] = useState<(() => string | null) | null>(null);
  const [getAllRemainingText, setGetAllRemainingText] = useState<(() => string | null) | null>(null);
  const [readerActions, setReaderActions] = useState<ReaderActions | null>(null);

  const handlePlay = () => {
    const textSelection = selection?.text.trim();
    // For continuous reading, get ALL remaining text from clicked position
    const allRemaining = getAllRemainingText?.() ?? null;
    const paragraph = getParagraphText?.() ?? null;
    const page = getPageText?.() ?? null;

    // Priority: selected text > all remaining text (for continuous reading) > paragraph > page
    const raw = textSelection || allRemaining || paragraph || page;
    const textToSpeak = raw
      ? raw.replace(/\u00A0/g, ' ').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
      : '';

    if (textToSpeak) {
      console.log('[TTS] Playing continuous text, length:', textToSpeak.length);
      tts.speak(textToSpeak);
    } else {
      console.log('[TTS] No text available - please select text or click a paragraph');
    }
  };

  const handleStop = useCallback(() => {
    tts.stop();
  }, [tts]);

  const handleTogglePlayback = useCallback(() => {
    if (tts.isPlaying) {
      handleStop();
    } else {
      handlePlay();
    }
  }, [tts.isPlaying, handleStop]);

  const handleZoomIn = () => settings.setFontSize(Math.min(settings.fontSize + 2, 48));
  const handleZoomOut = () => settings.setFontSize(Math.max(settings.fontSize - 2, 12));

  useKeyboardShortcuts({
    togglePlayback: handleTogglePlayback,
    stopPlayback: handleStop,
    nextPage: () => readerActions?.nextPage(),
    prevPage: () => readerActions?.prevPage(),
    increaseFontSize: handleZoomIn,
    decreaseFontSize: handleZoomOut,
  });

  // Show loading while checking model status
  if (isModelReady === null) {
    return (
      <div className="app loading-screen" data-theme={settings.theme}>
        <div className="loading-spinner" />
        <p>Loading Kokoro Reader...</p>
      </div>
    );
  }

  // Show setup screen if model not ready
  if (!isModelReady) {
    return <ModelSetup onComplete={() => setIsModelReady(true)} />;
  }

  return (
    <div className="app" data-theme={settings.theme}>
      {/* Sidebar Toggle Button */}
      <button
        className="sidebar-toggle"
        onClick={() => setSidebarVisible(!sidebarVisible)}
        title={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
      >
        {sidebarVisible ? '◀' : '▶'}
      </button>

      {/* Sidebar with book navigation */}
      {sidebarVisible && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h1>📚 Kokoro Reader</h1>
          </div>

          <div className="sidebar-content">
            <button className="btn btn-primary" onClick={handleOpenFile} disabled={isLoading}>
              {isLoading ? 'Opening...' : '📂 Open EPUB'}
            </button>

            {bookInfo && (
              <div className="book-info">
                <h3>{bookInfo.title}</h3>
                {bookInfo.author && <p className="author">by {bookInfo.author}</p>}
              </div>
            )}

            {/* Table of Contents */}
            {toc.length > 0 && (
              <div className="toc">
                <h4>Contents</h4>
                <nav className="toc-nav">
                  {toc.map((item, idx) => (
                    <button
                      key={idx}
                      className="toc-item"
                      style={{ paddingLeft: `${12 + ((item as NavItem & { depth?: number }).depth || 0) * 16}px` }}
                      onClick={() => {
                        if (item.href && readerActions) {
                          readerActions.navigateTo(item.href);
                        }
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
            )}

            {/* Recent Books */}
            {library.books.length > 0 && (
              <div className="recent-books">
                <h4>📚 Recent Books</h4>
                <div className="recent-books-list">
                  {library.getRecentBooks(5).map((book) => (
                    <div
                      key={book.id}
                      className={`recent-book-item ${book.id === currentBookId ? 'active' : ''}`}
                    >
                      <button
                        className="recent-book-title"
                        onClick={() => handleOpenFromLibrary(book)}
                        title={book.filePath}
                      >
                        {book.title}
                      </button>
                      <button
                        className="recent-book-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveFromLibrary(book.id);
                        }}
                        title="Remove from library"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="sidebar-footer">
            <button
              className="btn btn-secondary"
              onClick={() => setSettingsVisible(true)}
            >
              ⚙️ Settings
            </button>
          </div>
        </aside>
      )}

      {/* Main reading area */}
      <main className="main-content">
        {epubData ? (
          <EpubReader
            url={epubData}
            title={bookInfo?.title}
            initialLocation={initialLocation}
            onTocLoaded={handleTocLoaded}
            onLocationChange={handleLocationChange}
            onTextSelected={handleTextSelected}
            onGetPageTextReady={(getter) => setGetPageText(() => getter)}
            onGetParagraphTextReady={(getter) => setGetParagraphText(() => getter)}
            onGetAllRemainingTextReady={(getter) => setGetAllRemainingText(() => getter)}
            onActionsReady={setReaderActions}
            onReadFromParagraph={handlePlay}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            theme={settings.theme}
            isPlaying={tts.isPlaying}
            currentChunkIndex={tts.currentChunkIndex}
            currentChunkText={tts.getCurrentChunkText()}
          />
        ) : (
          <div className="empty-state">
            <div className="empty-icon">📖</div>
            <h2>Welcome to Kokoro Reader</h2>
            <p>Open an EPUB file to start reading with AI-powered text-to-speech</p>
            <button className="btn btn-primary btn-large" onClick={handleOpenFile}>
              📂 Open EPUB File
            </button>
          </div>
        )}
      </main>

      {/* Audio controls (visible when book is loaded) */}
      {bookInfo && (
        <AudioControls
          isPlaying={tts.isPlaying}
          isPaused={tts.isPaused}
          isLoading={tts.isLoading}
          error={tts.error}
          speed={tts.speed}
          voice={tts.voice}
          voices={tts.voices}
          currentChunk={tts.currentChunkIndex}
          totalChunks={tts.totalChunks}
          onPlay={handlePlay}
          onPause={tts.pause}
          onResume={tts.resume}
          onStop={tts.stop}
          onSpeedChange={tts.setSpeed}
          onVoiceChange={tts.setVoice}
        />
      )}

      {/* Settings Panel */}
      {settingsVisible && (
        <SettingsPanel
          settings={settings}
          onClose={() => setSettingsVisible(false)}
          aiConnected={ai.isConnected}
          onConnectAI={ai.connect}
          onDisconnectAI={ai.disconnect}
        />
      )}

      {/* Clarify Popover */}
      {selection && selection.rect && (
        <ClarifyPopover
          text={selection.text}
          context={selection.context}
          rect={selection.rect}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}

export default App;
