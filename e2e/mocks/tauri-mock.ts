/**
 * Mock Tauri APIs for browser-based testing
 * This allows e2e tests to run without the Tauri runtime
 */

// Sample minimal EPUB content as base64
const SAMPLE_EPUB_BASE64 = ''; // We'll use a fixture file instead

// Mock Tauri invoke function
export function mockTauriAPIs(window: Window) {
    // @ts-expect-error - Mock Tauri global
    window.__TAURI_INTERNALS__ = {
        invoke: async (cmd: string, args?: Record<string, unknown>) => {
            console.log(`[Mock Tauri] invoke: ${cmd}`, args);

            switch (cmd) {
                case 'check_model_status':
                    return {
                        is_ready: true,
                        is_downloading: false,
                        missing_files: [],
                        download_size_bytes: 0,
                        model_dir: '/mock/model/dir',
                    };

                case 'open_book':
                    return {
                        path: args?.path || '/mock/book.epub',
                        title: 'Sample Book',
                        author: 'Test Author',
                    };

                case 'read_epub_bytes':
                    // Return empty array - tests will inject mock content
                    return new Uint8Array([]);

                case 'set_tts_engine':
                case 'tts_warmup':
                case 'tts_start_session':
                case 'tts_stop':
                case 'tts_pause':
                case 'tts_resume':
                    return null;

                case 'get_tts_engine':
                    return 'Chatterbox';

                case 'is_playing':
                    return false;

                case 'is_paused':
                    return false;

                default:
                    console.warn(`[Mock Tauri] Unhandled command: ${cmd}`);
                    return null;
            }
        },

        transformCallback: () => 0,
    };

    console.log('[Mock Tauri] APIs mocked successfully');
}

// Script to inject into page
export const MOCK_TAURI_SCRIPT = `
(function() {
  window.__TAURI_INTERNALS__ = {
    invoke: async function(cmd, args) {
      console.log('[Mock Tauri] invoke:', cmd, args);
      
      switch (cmd) {
        case 'check_model_status':
          return {
            is_ready: true,
            is_downloading: false,
            missing_files: [],
            download_size_bytes: 0,
            model_dir: '/mock/model/dir',
          };
        
        case 'open_book':
          return {
            path: args?.path || '/mock/book.epub',
            title: 'Sample Book',
            author: 'Test Author',
          };
        
        case 'read_epub_bytes':
          return new Uint8Array([]);
        
        case 'set_tts_engine':
        case 'tts_warmup':
        case 'tts_start_session':
        case 'tts_stop':
        case 'tts_pause':
        case 'tts_resume':
          return null;
        
        case 'get_tts_engine':
          return 'Chatterbox';
        
        case 'is_playing':
          return false;
        
        case 'is_paused':
          return false;
        
        default:
          console.warn('[Mock Tauri] Unhandled command:', cmd);
          return null;
      }
    },
    
    transformCallback: function() { return 0; },
  };
  
  console.log('[Mock Tauri] APIs mocked in page context');
})();
`;
