import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { EpubReader } from './components/EpubReader';
import { AudioControls } from './components/AudioControls';
import { ModelSetup } from './components/ModelSetup';
import { SettingsPanel } from './components/SettingsPanel';
import { useTTS } from './hooks/useTTS';
import { useSettings } from './hooks/useSettings';
import type { ModelStatus } from './hooks/useModelSetup';
import type { NavItem } from 'epubjs';
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
  const [epubUrl, setEpubUrl] = useState<string | null>(null);
  const [toc, setToc] = useState<NavItem[]>([]);
  const [selectedText, setSelectedText] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const tts = useTTS();
  const settings = useSettings();

  // Check model status on mount
  useEffect(() => {
    invoke<ModelStatus>('check_model_status')
      .then((status) => {
        setIsModelReady(status.is_ready);
      })
      .catch(() => {
        setIsModelReady(false);
      });
  }, []);

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
        setIsLoading(true);

        // Convert file path to URL for react-reader
        const url = convertFileSrc(selected);
        setEpubUrl(url);

        // Extract title from filename for now
        const filename = selected.split('/').pop() || selected;
        const title = filename.replace('.epub', '');

        setBookInfo({
          path: selected,
          title,
          author: '',
        });

        setIsLoading(false);
      }
    } catch (e) {
      console.error('Failed to open file:', e);
      setIsLoading(false);
    }
  };

  const handleTocLoaded = (tocItems: NavItem[]) => {
    setToc(tocItems);
  };

  const handleTextSelected = (text: string) => {
    setSelectedText(text);
  };

  const handlePlay = () => {
    if (selectedText) {
      tts.speak(selectedText);
    }
  };

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
                      onClick={() => {
                        // Navigation via TOC href will be handled by react-reader internally
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
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
        {epubUrl ? (
          <EpubReader
            url={epubUrl}
            title={bookInfo?.title}
            onTocLoaded={handleTocLoaded}
            onTextSelected={handleTextSelected}
            fontSize={settings.fontSize}
            fontFamily={settings.fontFamily}
            theme={settings.theme}
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
        />
      )}
    </div>
  );
}

export default App;
