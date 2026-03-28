/**
 * Convert markdown-formatted model reply to Feishu-friendly format.
 * Preserves structure while adapting syntax for optimal Feishu rendering.
 */
export function markdownToFeishuMarkdown(text: string): string {
  let result = text;

  // Normalize line endings
  result = result.replace(/\r\n?/g, "\n");

  // Code blocks: convert ```language to standard markdown
  // Feishu supports standard ``` code blocks
  result = result.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => {
    const language = lang || "";
    const trimmedCode = code.trim();
    return "```" + language + "\n" + trimmedCode + "\n```";
  });

  // Inline code: `code` - keep as is (supported)

  // Headers: convert # to bold (Feishu cards render headers poorly)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "**$1**");

  // Bold: **text** or __text__ - keep (supported)
  result = result.replace(/__(.+?)__/g, "**$1**");

  // Italic: *text* or _text_ - keep (supported)
  // But need to be careful not to break bold
  // Handle single word italics
  result = result.replace(/(?<!\*)\*(?!\*)([^\*\n]+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Strikethrough: ~~text~~ - keep (supported)

  // Links: [text](url) - keep (supported)
  // Images: ![alt](url) - keep (supported)

  // Tables: Feishu supports markdown tables
  // Keep as is - they render reasonably well

  // Lists: convert to simple format
  // Unordered lists
  result = result.replace(/^\s*[-\*]\s+/gm, "• ");
  // Ordered lists - keep as is (1. 2. etc)

  // Horizontal rules: convert to simple line
  result = result.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, "---");

  // Blockquotes: > text
  // Feishu doesn't support blockquotes well, convert to bold italic
  result = result.replace(/^>\s+(.+)$/gm, "_$1_");

  // Clean up excessive whitespace
  result = result.replace(/\n{4,}/g, "\n\n\n");

  return result.trim();
}

/**
 * Detect if text contains significant markdown formatting
 */
export function hasSignificantMarkdown(text: string): boolean {
  const patterns = [
    /```[\s\S]*?```/,           // Code blocks
    /\*\*[\s\S]+?\*\*/,         // Bold
    /__[^\n]+?__/,               // Bold (alt)
    /\*(?!\*)[^\n]+?\*(?!\*)/,   // Italic
    /_[^\n]+?_/,                 // Italic (alt)
    /~~[^\n]+?~~/,               // Strikethrough
    /`[^`\n]+?`/,                // Inline code
    /\[[^\]]+\]\([^)]+\)/,       // Links
    /!\[[^\]]*\]\([^)]+\)/,      // Images
    /^#{1,6}\s+/m,               // Headers
    /^\s*[-\*]\s+/m,             // Lists
    /^\|.+\|$/m                  // Tables
  ];

  return patterns.some(pattern => pattern.test(text));
}

/**
 * Format plain text for Feishu display
 * Adds basic structure and escaping if needed
 */
export function formatPlainTextForFeishu(text: string): string {
  // Normalize line endings
  let result = text.replace(/\r\n?/g, "\n");

  // Preserve paragraph breaks
  result = result.replace(/\n{3,}/g, "\n\n");

  // Escape special markdown characters that might be misinterpreted
  // Only escape if they look like they might be formatting
  if (result.includes("**") || result.includes("__")) {
    // If it has asterisks or underscores, it might be intentional markdown
    // Leave it as is
  }

  return result.trim();
}