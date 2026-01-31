// TypeScript types for Tauri commands

export interface BookMetadata {
  title: string;
  author: string;
  language: string | null;
  description: string | null;
  cover_path: string | null;
}

export interface Word {
  text: string;
  start_offset: number;
  end_offset: number;
}

export interface Chapter {
  index: number;
  title: string;
  content: string;
  words: Word[];
}

export interface Book {
  metadata: BookMetadata;
  chapters: Chapter[];
  total_words: number;
}

export interface Voice {
  id: string;
  name: string;
  gender: string;
  accent: string;
}

export type Theme = 'dark' | 'light' | 'sepia';

export interface ReaderSettings {
  voice: string;
  speed: number;
  fontSize: number;
  theme: Theme;
}
