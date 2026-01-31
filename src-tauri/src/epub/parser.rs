//! EPUB and text file parser

use epub::doc::EpubDoc;
use regex::Regex;
use std::fs;
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ParseError {
    #[error("Failed to open file: {0}")]
    FileError(String),
    #[error("Failed to parse EPUB: {0}")]
    EpubError(String),
    #[error("Unsupported format: {0}")]
    UnsupportedFormat(String),
}

/// Book metadata
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BookMetadata {
    pub title: String,
    pub author: String,
    pub language: Option<String>,
    pub description: Option<String>,
    pub cover_path: Option<String>,
}

/// A chapter in a book
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Chapter {
    pub index: usize,
    pub title: String,
    pub content: String,
    /// Words in this chapter for highlighting
    pub words: Vec<Word>,
}

/// A word with position info for highlighting
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Word {
    pub text: String,
    pub start_offset: usize,
    pub end_offset: usize,
}

/// Parsed book
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Book {
    pub metadata: BookMetadata,
    pub chapters: Vec<Chapter>,
    pub total_words: usize,
}

/// EPUB and text file parser
pub struct EpubParser;

impl EpubParser {
    /// Parse a file (EPUB or TXT)
    pub fn parse(path: &Path) -> Result<Book, ParseError> {
        let extension = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();

        match extension.as_str() {
            "epub" => Self::parse_epub(path),
            "txt" | "text" => Self::parse_text(path),
            _ => Err(ParseError::UnsupportedFormat(format!(
                "Unsupported file format: .{}",
                extension
            ))),
        }
    }

    /// Parse an EPUB file
    fn parse_epub(path: &Path) -> Result<Book, ParseError> {
        let mut doc = EpubDoc::new(path).map_err(|e| ParseError::EpubError(e.to_string()))?;

        // Get metadata - mdata returns Option<&MetadataItem>, need to extract the value
        let title = doc.mdata("title")
            .map(|m| m.value.clone())
            .unwrap_or_else(|| "Unknown Title".to_string());
        let author = doc.mdata("creator")
            .map(|m| m.value.clone())
            .unwrap_or_else(|| "Unknown Author".to_string());
        let language = doc.mdata("language").map(|m| m.value.clone());
        let description = doc.mdata("description").map(|m| m.value.clone());

        // Parse chapters
        let mut chapters = Vec::new();
        let mut total_words = 0;

        // Get spine (reading order)
        let spine_len = doc.spine.len();

        for index in 0..spine_len {
            #[allow(deprecated)]
            doc.set_current_page(index);

            if let Some((content, _mime)) = doc.get_current_str() {
                let plain_text = Self::html_to_text(&content);

                if plain_text.trim().is_empty() {
                    continue;
                }

                let words = Self::extract_words(&plain_text);
                total_words += words.len();

                // Try to extract chapter title from content
                let chapter_title = Self::extract_title(&content)
                    .unwrap_or_else(|| format!("Chapter {}", chapters.len() + 1));

                chapters.push(Chapter {
                    index: chapters.len(),
                    title: chapter_title,
                    content: plain_text,
                    words,
                });
            }
        }

        Ok(Book {
            metadata: BookMetadata {
                title,
                author,
                language,
                description,
                cover_path: None,
            },
            chapters,
            total_words,
        })
    }

    /// Parse a plain text file
    fn parse_text(path: &Path) -> Result<Book, ParseError> {
        let content = fs::read_to_string(path).map_err(|e| ParseError::FileError(e.to_string()))?;

        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown");

        let words = Self::extract_words(&content);
        let total_words = words.len();

        // Split into chapters by double newlines or treat as single chapter
        let paragraphs: Vec<&str> = content.split("\n\n").collect();
        let mut chapters = Vec::new();

        if paragraphs.len() > 10 {
            // Group paragraphs into chapters (roughly 10 paragraphs each)
            let chunk_size = (paragraphs.len() / 10).max(1);
            for (i, chunk) in paragraphs.chunks(chunk_size).enumerate() {
                let chapter_content = chunk.join("\n\n");
                let chapter_words = Self::extract_words(&chapter_content);

                chapters.push(Chapter {
                    index: i,
                    title: format!("Section {}", i + 1),
                    content: chapter_content,
                    words: chapter_words,
                });
            }
        } else {
            // Single chapter
            chapters.push(Chapter {
                index: 0,
                title: filename.to_string(),
                content: content.clone(),
                words,
            });
        }

        Ok(Book {
            metadata: BookMetadata {
                title: filename.to_string(),
                author: "Unknown".to_string(),
                language: None,
                description: None,
                cover_path: None,
            },
            chapters,
            total_words,
        })
    }

    /// Convert HTML content to plain text
    fn html_to_text(html: &str) -> String {
        // Remove script tags with content (no backreferences - separate patterns)
        let re_script = Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
        let text = re_script.replace_all(html, "");
        
        // Remove style tags with content
        let re_style = Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
        let text = re_style.replace_all(&text, "");

        // Replace block elements with newlines
        let re_block = Regex::new(r"(?i)</(p|div|h[1-6]|li|br|tr)>").unwrap();
        let text = re_block.replace_all(&text, "\n");

        // Replace list items
        let re_li = Regex::new(r"(?i)<li[^>]*>").unwrap();
        let text = re_li.replace_all(&text, "• ");

        // Remove all remaining tags
        let re_tags = Regex::new(r"<[^>]+>").unwrap();
        let text = re_tags.replace_all(&text, "");

        // Decode HTML entities
        let text = text
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&apos;", "'");

        // Normalize whitespace
        let re_whitespace = Regex::new(r"[ \t]+").unwrap();
        let text = re_whitespace.replace_all(&text, " ");

        // Normalize newlines
        let re_newlines = Regex::new(r"\n{3,}").unwrap();
        let text = re_newlines.replace_all(&text, "\n\n");

        text.trim().to_string()
    }

    /// Extract words with offsets for highlighting
    fn extract_words(text: &str) -> Vec<Word> {
        let re = Regex::new(r"\b\w+\b").unwrap();
        re.find_iter(text)
            .map(|m| Word {
                text: m.as_str().to_string(),
                start_offset: m.start(),
                end_offset: m.end(),
            })
            .collect()
    }

    /// Extract title from HTML heading
    fn extract_title(html: &str) -> Option<String> {
        let re = Regex::new(r"(?is)<h[1-3][^>]*>([^<]+)</h[1-3]>").unwrap();
        re.captures(html)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string())
            .filter(|s| !s.is_empty() && s.len() < 100)
    }
}
