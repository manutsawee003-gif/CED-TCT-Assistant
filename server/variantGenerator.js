import { normalizeText, tokens } from './queryUnderstanding.js';

const FUNCTION_WORDS = new Set(['คือ', 'อะไร', 'ไหม', 'หรือไม่', 'สามารถ', 'ได้', 'หรือ', 'ของ', 'ที่', 'ใน', 'ให้', 'มี', 'การ', 'สำหรับ', 'เกี่ยวกับ', 'ผู้', 'ปีการศึกษา', 'หลักสูตร']);
const QUESTION_MARKERS = new Set(['อะไร', 'ไหม', 'หรือไม่', 'เท่าไร', 'กี่', 'อย่างไร', 'ที่ไหน', 'เมื่อไร']);

function meaningfulWords(question) {
  return normalizeText(question).split(/\s+/).filter((word) => word.length > 1 && !FUNCTION_WORDS.has(word));
}
function protectedValues(question) {
  return (normalizeText(question).match(/\b(?:ced|tct)\b|\d{4}|\d{3,10}|ม\d|ปว[ชส]|portfolio|tcas|tgat|tpat/gi) || []);
}
function valid(text, original) {
  const normalized = normalizeText(text); const protectedTokens = protectedValues(original);
  return normalized.length >= 4 && protectedTokens.every((value) => normalized.includes(value));
}

/**
 * Produces search-only formulations by analysing sentence structure. It does not
 * invent facts: all words/values come from the canonical question or category.
 */
export function generateSearchVariants(record) {
  const canonical = normalizeText(record.question); const words = meaningfulWords(record.question);
  const marker = words.filter((word) => QUESTION_MARKERS.has(word)).at(-1);
  const content = words.filter((word) => !QUESTION_MARKERS.has(word));
  const categoryWords = meaningfulWords(record.category).slice(0, 5);
  const candidates = new Set([canonical]);
  // Entity-preserving compression makes long official questions retrievable from chat-like short questions.
  candidates.add([...content, marker].filter(Boolean).join(' '));
  // Moving the requested value/question marker to the front supports inverted chat word order.
  if (marker) candidates.add([marker, ...content].join(' '));
  // Recombine the two semantic halves of the sentence without adding vocabulary/facts.
  if (content.length >= 4) candidates.add([...content.slice(Math.ceil(content.length / 2)), ...content.slice(0, Math.ceil(content.length / 2)), marker].filter(Boolean).join(' '));
  // Category anchors help terse questions inherit the record's Dataset-derived topic context.
  if (categoryWords.length) candidates.add([...content.slice(0, 6), ...categoryWords, marker].filter(Boolean).join(' '));
  // Token stream is retained as a final robust representation for whitespace/punctuation variation.
  candidates.add(tokens(record.question).filter((token) => token.length > 1).slice(0, 28).join(' '));
  return [...candidates].filter((variant) => valid(variant, record.question)).slice(0, 5);
}
