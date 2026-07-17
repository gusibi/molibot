/**
 * moryTokenize.ts
 *
 * Unified CJK-aware tokenizer and lexical scorer for memory search.
 *
 * Whitespace splitting cannot tokenize Chinese: a Chinese query becomes one
 * giant token and matching degenerates to whole-sentence substring search.
 * Word segmentation uses Jieba search mode; a CJK character-bigram channel
 * backs it up for unknown domain words. Function words are filtered on both
 * channels so a query like "的了" cannot match every record.
 *
 * This module is the single lexical-matching primitive for the memory stack
 * (host keyword search, prompt row selection, and — per T1b — moryRetrieval
 * and write-gate dedupe).
 */

import { cut_for_search } from "jieba-wasm";

const CJK_CHAR_RE = /[㐀-䶿一-鿿]/;

const STOP_WORDS = new Set([
  // zh function words
  "的", "了", "是", "在", "有", "和", "与", "就", "都", "也", "很", "还",
  "吗", "呢", "吧", "啊", "嘛", "呀", "哦", "嗯", "哈",
  "这", "那", "这个", "那个", "这些", "那些", "一个", "一下", "一点",
  "我", "你", "他", "她", "它", "我们", "你们", "他们", "她们", "它们",
  "什么", "怎么", "怎样", "为什么", "因为", "所以", "但是", "不过", "而且",
  "然后", "如果", "还是", "或者", "以及", "并且", "虽然", "可以", "可能",
  "对", "把", "被", "给", "让", "从", "到", "会", "能", "要", "想", "说",
  "来", "去", "又", "再", "只", "才", "等", "着", "过", "得", "地",
  // en stopwords
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "and", "or", "not", "no",
  "do", "does", "did", "have", "has", "had", "will", "would", "can",
  "could", "should", "i", "you", "he", "she", "it", "we", "they", "me",
  "my", "your", "his", "her", "its", "our", "their", "this", "that",
  "these", "those", "what", "how", "why", "when", "where", "which",
  "am", "so", "if", "as", "by", "from", "about", "into", "than", "then"
]);

// Single characters too weak to anchor a bigram: a bigram made of two of
// these (e.g. 的了) carries no retrieval signal and would match everywhere.
const STOP_CHARS = new Set(
  "的了是在有和与就都也很还吗呢吧啊嘛呀哦嗯哈这那我你他她它对把被给让从到会能要想说来去又再只才等着过得地"
);

export function normalizeForMatch(input: string): string {
  return String(input ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Jieba search-mode tokens, lowercased, punctuation and stopwords removed. */
export function tokenizeWords(text: string): string[] {
  const normalized = normalizeForMatch(text);
  if (!normalized) return [];
  return cut_for_search(normalized, true)
    .map((token) => token.trim())
    .filter((token) => /[\p{L}\p{N}]/u.test(token) && !STOP_WORDS.has(token));
}

/** Character bigrams over contiguous CJK runs, skipping pure function-char pairs. */
export function cjkBigrams(text: string): string[] {
  const normalized = normalizeForMatch(text);
  const grams: string[] = [];
  let run = "";
  const flush = (): void => {
    for (let i = 0; i + 1 < run.length; i += 1) {
      const a = run[i];
      const b = run[i + 1];
      if (STOP_CHARS.has(a) && STOP_CHARS.has(b)) continue;
      grams.push(a + b);
    }
    run = "";
  };
  for (const ch of normalized) {
    if (CJK_CHAR_RE.test(ch)) {
      run += ch;
    } else {
      flush();
    }
  }
  flush();
  return grams;
}

/** Shared token set for symmetric dedupe/conflict similarity. */
export function tokenizeForSimilarity(text: string): string[] {
  return [...new Set([...tokenizeWords(text), ...cjkBigrams(text)])];
}

export function jaccardLexicalSimilarity(a: string, b: string): number {
  const setA = new Set(tokenizeForSimilarity(a));
  const setB = new Set(tokenizeForSimilarity(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  return intersection / (setA.size + setB.size - intersection);
}

export function overlapLexicalSimilarity(a: string, b: string): number {
  const setA = new Set(tokenizeForSimilarity(a));
  const setB = new Set(tokenizeForSimilarity(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) if (setB.has(token)) intersection += 1;
  return intersection / Math.min(setA.size, setB.size);
}

/**
 * Lexical relevance of `content` for `query`, normalized to 0..1.
 *
 * - Empty query returns 1 (listing mode: every record is eligible).
 * - A query with no signal after stopword filtering returns 0 rather than
 *   matching everything.
 * - Word channel: Jieba search-mode tokens matched by substring, single-char
 *   tokens down-weighted. Bigram channel: overlap
 *   ratio of CJK bigrams, catching words the dictionary split apart.
 */
export function scoreLexical(content: string, query: string): number {
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return 1;
  const target = normalizeForMatch(content);
  if (!target) return 0;

  const words = tokenizeWords(normalizedQuery);
  let wordWeightTotal = 0;
  let wordWeightHit = 0;
  for (const word of words) {
    const weight = word.length >= 2 ? 1 : 0.3;
    wordWeightTotal += weight;
    if (target.includes(word)) wordWeightHit += weight;
  }
  const wordScore = wordWeightTotal > 0 ? wordWeightHit / wordWeightTotal : 0;

  const queryGrams = new Set(cjkBigrams(normalizedQuery));
  let gramScore = 0;
  if (queryGrams.size > 0) {
    const targetGrams = new Set(cjkBigrams(target));
    let hit = 0;
    for (const gram of queryGrams) {
      if (targetGrams.has(gram)) hit += 1;
    }
    gramScore = hit / queryGrams.size;
  }

  if (wordWeightTotal === 0 && queryGrams.size === 0) return 0;
  if (queryGrams.size === 0) return wordScore;
  if (wordWeightTotal === 0) return gramScore;
  return wordScore * 0.6 + gramScore * 0.4;
}
