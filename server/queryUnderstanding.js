import fs from 'node:fs';
import path from 'node:path';

const THAI_WORD = /[ก-๙]+/;
const STRUCTURED_PATTERNS = {
  academic_year: /(?<!\d)(25\d{2})(?!\d)/g,
  course_code: /(?<!\d)(\d{6,10})(?!\d)/g,
  semester: /(?:ภาค(?:การศึกษา)?|เทอม)\s*(?:ที่)?\s*(\d+)/gi,
  study_year: /(?:ชั้นปี|ปี)\s*(?:ที่)?\s*(\d+)/gi,
  admission_round: /รอบ\s*([\p{L}\p{N}.-]+)/giu,
  education_level: /(?:ม\.?\s*\d|ปว\.?\s*[ชส]|ปริญญา(?:ตรี|โท|เอก))/giu
};
const CORE_INTENTS = ['find_value', 'find_list', 'eligibility', 'procedure', 'requirement', 'date_time', 'cost', 'course_information', 'admission_information', 'comparison'];

export function normalizeText(value = '') {
  return String(value).toLowerCase().normalize('NFC')
    .replace(/ม\.\s*(\d)/g, 'ม$1')
    .replace(/ปว\.\s*([ชส])/g, 'ปว$1')
    .replace(/[“”"'`~!@#$%^&*()_+=[\]{};:,.?\\/|<>]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

export function tokens(value = '') {
  const normalized = normalizeText(value);
  const words = normalized.match(/[a-z]+(?:-[a-z]+)?|\d+|[ก-๙]+/g) || [];
  const thaiPieces = [];
  for (const word of words.filter((item) => THAI_WORD.test(item))) {
    for (const size of [2, 3, 4, 5]) for (let i = 0; i <= word.length - size; i += 1) thaiPieces.push(word.slice(i, i + size));
  }
  return [...words, ...thaiPieces];
}

function matches(text, pattern, group = 1) {
  return [...text.matchAll(pattern)].map((match) => normalizeText(match[group] || match[0])).filter(Boolean);
}

function titleTerms(value) {
  return (normalizeText(value).match(/[a-z]{2,}|[ก-๙]{2,}/g) || []).filter((term) => term.length > 2);
}

function inferRecordIntent(record) {
  const text = normalizeText(`${record.question} ${record.category}`);
  if (/ค่า|บาท|ค่าธรรมเนียม|บำรุง/.test(text)) return 'cost';
  if (/สมัครได้|คุณสมบัติ|ผู้จบ|รับ.*ไหม/.test(text)) return 'eligibility';
  if (/ขั้นตอน|วิธี|อย่างไร|ชำระ|ดำเนิน/.test(text)) return 'procedure';
  if (/วัน|เวลา|กำหนดการ|เปิดรับ|ปิดรับ/.test(text)) return 'date_time';
  if (/เอกสาร|หลักฐาน|เงื่อนไข/.test(text)) return 'requirement';
  if (/กี่|จำนวน|รหัส|หน่วยกิต|เท่าไร/.test(text)) return 'find_value';
  if (/มีอะไร|รายวิชา|รายการ|สาขาใด/.test(text)) return 'find_list';
  if (/สมัคร|portfolio|tcas|รับตรง|รอบ/.test(text)) return 'admission_information';
  return 'course_information';
}

export function buildDomainIndex(records, configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const vocabulary = new Map(); const programs = new Set(); const topics = new Set();
  const entityCatalog = { academic_year: new Set(), course_code: new Set(), admission_round: new Set(), education_level: new Set() };
  const indexedRecords = records.map((record) => {
    const corpus = `${record.dataset} ${record.category} ${record.question} ${record.answer}`;
    for (const term of titleTerms(corpus)) vocabulary.set(term, (vocabulary.get(term) || 0) + 1);
    for (const code of matches(corpus, STRUCTURED_PATTERNS.course_code)) entityCatalog.course_code.add(code);
    for (const year of matches(corpus, STRUCTURED_PATTERNS.academic_year)) entityCatalog.academic_year.add(year);
    for (const level of matches(corpus, STRUCTURED_PATTERNS.education_level, 0)) entityCatalog.education_level.add(level);
    for (const round of matches(corpus, STRUCTURED_PATTERNS.admission_round)) entityCatalog.admission_round.add(round);
    // Program labels are discovered from recurring uppercase tokens, not a fixed list.
    for (const label of corpus.match(/\b[A-Z][A-Z0-9-]{1,12}\b/g) || []) programs.add(label.toLowerCase());
    titleTerms(record.category).forEach((term) => topics.add(term));
    return { ...record, inferredIntent: inferRecordIntent(record) };
  });
  const intentDocuments = new Map(CORE_INTENTS.map((intent) => [intent, []]));
  for (const record of indexedRecords) intentDocuments.get(record.inferredIntent).push(record.question, record.category);
  const intentTokenSets = new Map([...intentDocuments].map(([intent, documents]) => [intent, new Set(tokens(documents.join(' ')))]));
  return { records: indexedRecords, vocabulary, programs, topics, entityCatalog, aliases: config.aliases || {}, intents: CORE_INTENTS, intentDocuments, intentTokenSets };
}

export function extractEntities(text, domain) {
  const normalized = normalizeText(text);
  const entities = {
    program: [...domain.programs].filter((program) => new RegExp(`\\b${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalized)),
    study_year: matches(normalized, STRUCTURED_PATTERNS.study_year),
    semester: matches(normalized, STRUCTURED_PATTERNS.semester),
    academic_year: matches(normalized, STRUCTURED_PATTERNS.academic_year),
    course_code: matches(normalized, STRUCTURED_PATTERNS.course_code),
    admission_round: matches(normalized, STRUCTURED_PATTERNS.admission_round),
    education_level: matches(normalized, STRUCTURED_PATTERNS.education_level, 0),
    topic: [...domain.topics].filter((topic) => topic.length > 3 && normalized.includes(topic)).slice(0, 8)
  };
  // Alias configuration only resolves an already-known program token; it never supplies facts or answers.
  for (const [canonical, aliases] of Object.entries(domain.aliases)) if (aliases.some((alias) => normalized.includes(normalizeText(alias))) && !entities.program.includes(canonical)) entities.program.push(canonical);
  return entities;
}

function detectIntent(text, entities, domain) {
  const queryTokens = tokens(text);
  const totals = new Map([...domain.intentTokenSets].map(([intent, values]) => [intent, overlap(queryTokens, values)]));
  const ranked = [...totals].sort((a, b) => b[1] - a[1]);
  if (entities.course_code.length || /กี่|เท่าไร|รหัส|หน่วยกิต/.test(normalizeText(text))) return 'find_value';
  return ranked[0]?.[0] || 'course_information';
}

function overlap(left, right) { const r = new Set(right); return left.filter((term) => term.length > 1 && r.has(term)).length / Math.max(new Set(left).size, 1); }

export function parseQuery(message, domain, previousContext = {}) {
  const normalized_query = normalizeText(message);
  const current = extractEntities(normalized_query, domain);
  const entities = Object.fromEntries(Object.keys(current).map((key) => [key, current[key].length ? current[key] : (previousContext[key] || [])]));
  const intent = detectIntent(normalized_query, entities, domain);
  return { original_query: message, normalized_query, intent, entities, inherited_context: previousContext, canonical: { intent, entities }, missing_entities: [], ambiguity: false };
}

export function contextFromQuery(parsed) {
  return Object.fromEntries(Object.entries(parsed.entities).filter(([, value]) => Array.isArray(value) && value.length));
}
