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
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/ม\.\s*(\d)/g, 'ม$1')
    .replace(/ปว\.\s*([ชส])/g, 'ปว$1')
    .replace(/[“”"'`~!@#$%^&*()_+=[\]{};:,.?\\/|<>]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function editDistance(left, right) {
  if (left === right) return 0;
  if (!left.length) return right.length; if (!right.length) return left.length;
  let previousPrevious = null; let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      let cost = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
      if (row > 1 && column > 1 && left[row - 1] === right[column - 2] && left[row - 2] === right[column - 1]) cost = Math.min(cost, previousPrevious[column - 2] + 1);
      current[column] = cost;
    }
    previousPrevious = previous; previous = current;
  }
  return previous[right.length];
}

function correctionCandidates(normalized, domain) {
  const observed = normalized.match(/[\p{L}]{3,}/gu) || [];
  const vocabulary = [...new Set([...domain.vocabulary.keys(), ...domain.programs, ...domain.entityCatalog.course_code])].filter((term) => /^[\p{L}\d]{3,}$/u.test(term));
  const corrections = [];
  for (const token of observed) {
    if (domain.vocabulary.has(token) || token.length > 18) continue;
    const permittedDistance = token.length <= 4 ? 1 : token.length <= 8 ? 2 : 3;
    const matches = vocabulary.map((candidate) => {
      const distance = Math.abs(candidate.length - token.length) > permittedDistance ? permittedDistance + 1 : editDistance(token, candidate);
      return { candidate, distance, similarity: 1 - distance / Math.max(token.length, candidate.length) };
    }).filter((match) => match.distance <= permittedDistance && match.similarity >= (token.length <= 3 ? 0.6 : 0.7)).sort((a, b) => b.similarity - a.similarity || a.distance - b.distance).slice(0, 3);
    if (!matches.length) continue;
    const [best, second] = matches;
    const confidence = Number(Math.max(0, Math.min(1, best.similarity - (second ? Math.max(0, second.similarity - best.similarity + 0.08) : 0) + 0.04)).toFixed(3));
    corrections.push({ token, candidates: matches.map(({ candidate, similarity }) => ({ value: candidate, similarity: Number(similarity.toFixed(3)) })), confidence, applied: confidence >= 0.88 && (!second || best.similarity - second.similarity >= 0.08) });
  }
  return corrections.slice(0, 8);
}

/** Safe, Dataset-aware preprocessing. It preserves the original and never alters numeric identifiers. */
export function preprocessQuery(value, domain) {
  const original_query = String(value ?? '');
  const normalized_query = normalizeText(original_query);
  const compact_query = normalized_query.replace(/\s+/g, '');
  const corrections = correctionCandidates(normalized_query, domain);
  let corrected_query = normalized_query;
  for (const correction of corrections.filter((item) => item.applied)) corrected_query = corrected_query.replace(new RegExp(`(^|\\s)${correction.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'gu'), `$1${correction.candidates[0].value}`);
  return { original_query, normalized_query, compact_query, corrected_query, corrections };
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
  if (record.intent) return normalizeText(record.intent);
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
  const entityCatalog = { academic_year: new Set(), course_code: new Set(), admission_round: new Set(), education_level: new Set(), generic: new Set() };
  const indexedRecords = records.map((record) => {
    // Search metadata is used only for retrieval. Answer remains source-of-truth
    // at response time and is deliberately excluded from inference/index catalogues.
    const corpus = `${record.dataset} ${record.category} ${record.topic || ''} ${record.intent || ''} ${record.entities || ''} ${record.question} ${(record.searchAliases || []).join(' ')} ${record.searchText || ''}`;
    for (const term of titleTerms(corpus)) vocabulary.set(term, (vocabulary.get(term) || 0) + 1);
    for (const code of matches(corpus, STRUCTURED_PATTERNS.course_code)) entityCatalog.course_code.add(code);
    for (const year of matches(corpus, STRUCTURED_PATTERNS.academic_year)) entityCatalog.academic_year.add(year);
    for (const level of matches(corpus, STRUCTURED_PATTERNS.education_level, 0)) entityCatalog.education_level.add(level);
    for (const round of matches(corpus, STRUCTURED_PATTERNS.admission_round)) entityCatalog.admission_round.add(round);
    for (const entity of String(record.entities || '').split(/[,|;]/).map(normalizeText).filter((item) => item.length >= 3)) entityCatalog.generic.add(entity);
    // Program labels are discovered from recurring uppercase tokens, not a fixed list.
    for (const label of corpus.match(/\b[A-Z][A-Z0-9-]{1,12}\b/g) || []) programs.add(label.toLowerCase());
    titleTerms(`${record.category} ${record.topic || ''}`).forEach((term) => topics.add(term));
    return { ...record, inferredIntent: inferRecordIntent(record) };
  });
  const allIntents = [...new Set([...CORE_INTENTS, ...indexedRecords.map((record) => record.inferredIntent).filter(Boolean)])];
  const intentDocuments = new Map(allIntents.map((intent) => [intent, []]));
  for (const record of indexedRecords) intentDocuments.get(record.inferredIntent).push(record.question, record.category, record.topic || '', record.entities || '', ...(record.searchAliases || []));
  const intentTokenSets = new Map([...intentDocuments].map(([intent, documents]) => [intent, new Set(tokens(documents.join(' ')))]));
  return { records: indexedRecords, vocabulary, programs, topics, entityCatalog, aliases: config.aliases || {}, intents: allIntents, intentDocuments, intentTokenSets };
}

export function extractEntities(text, domain) {
  const normalized = normalizeText(text);
  // Treat a parsed value as a strict constraint only when it is present in the
  // Dataset-derived catalog. Conversational fragments must remain retrieval
  // text, rather than becoming false contradictions.
  const knownValues = (pattern, catalog, group = 1) => matches(normalized, pattern, group).filter((value) => catalog.has(value));
  const entities = {
    program: [...domain.programs].filter((program) => new RegExp(`\\b${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalized)),
    study_year: matches(normalized, STRUCTURED_PATTERNS.study_year),
    semester: matches(normalized, STRUCTURED_PATTERNS.semester),
    academic_year: knownValues(STRUCTURED_PATTERNS.academic_year, domain.entityCatalog.academic_year),
    course_code: knownValues(STRUCTURED_PATTERNS.course_code, domain.entityCatalog.course_code),
    admission_round: knownValues(STRUCTURED_PATTERNS.admission_round, domain.entityCatalog.admission_round),
    education_level: knownValues(STRUCTURED_PATTERNS.education_level, domain.entityCatalog.education_level, 0),
    generic: [...domain.entityCatalog.generic].filter((entity) => normalized.includes(entity)).slice(0, 8),
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

function verifiedAiEntities(aiEntities, domain) {
  const known = { program: domain.programs, academic_year: domain.entityCatalog.academic_year, course_code: domain.entityCatalog.course_code, admission_round: domain.entityCatalog.admission_round, education_level: domain.entityCatalog.education_level, generic: domain.entityCatalog.generic, topic: domain.topics };
  return Object.fromEntries(Object.keys(known).map((key) => [key, (aiEntities?.[key] || []).map(normalizeText).filter((value) => known[key].has(value))]));
}

export function parseQuery(message, domain, previousContext = {}, interpretation = null) {
  const preprocessing = preprocessQuery(message, domain);
  const aiQuery = interpretation?.available && interpretation.normalized_query ? interpretation.normalized_query : preprocessing.normalized_query;
  const normalized_query = normalizeText(aiQuery);
  const current = extractEntities(normalized_query, domain);
  const verified = interpretation?.available ? verifiedAiEntities(interpretation.entities, domain) : {};
  for (const [key, values] of Object.entries(verified)) if (values.length) current[key] = [...new Set([...current[key], ...values])];
  const entities = Object.fromEntries(Object.keys(current).map((key) => [key, current[key].length ? current[key] : (previousContext[key] || [])]));
  const fallbackIntent = detectIntent(normalized_query, entities, domain);
  const interpretedIntent = normalizeText(interpretation?.intent || '');
  const intent = interpretation?.available && domain.intents.includes(interpretedIntent) ? interpretedIntent : fallbackIntent;
  const keywords = interpretation?.available ? interpretation.keywords.map(normalizeText).filter(Boolean) : [];
  const semantic_concepts = interpretation?.available ? (interpretation.semantic_concepts || []).map(normalizeText).filter(Boolean) : [];
  // The anchor is a previous Dataset question, supplied only for a short follow-up turn.
  // It preserves the topic without treating an old entity as a mandatory constraint.
  const correctionAlternatives = preprocessing.corrections.filter((item) => item.confidence >= 0.65).flatMap((item) => item.candidates.map((candidate) => preprocessing.normalized_query.replace(new RegExp(item.token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu'), candidate.value)));
  const expansionInputs = [message, preprocessing.normalized_query, preprocessing.compact_query, preprocessing.corrected_query, normalized_query, previousContext.__followup_anchor || '', ...correctionAlternatives, ...keywords, ...semantic_concepts, ...(interpretation?.available ? (interpretation.search_queries || []) : [])];
  const expanded_queries = [...new Set(expansionInputs.map(normalizeText).filter((value) => value.length >= 3))].slice(0, 8);
  return { ...preprocessing, original_query: message, normalized_query, search_query: normalized_query, expanded_queries, intent, entities, constraints: interpretation?.available ? interpretation.constraints || {} : {}, answer_scope: interpretation?.available && interpretation.answer_scope === 'multi' ? 'multi' : 'single', keywords, semantic_concepts, possible_meanings: interpretation?.possible_meanings || [], interpretation_confidence: interpretation?.confidence ?? null, typhoon: interpretation?.available ? 'used' : interpretation?.reason || 'not_configured', inherited_context: previousContext, canonical: { intent, entities }, missing_entities: [], ambiguity: interpretation?.available && (interpretation.ambiguous || (interpretation.possible_meanings?.length > 1 && interpretation.confidence < 0.75)) };
}

export function contextFromQuery(parsed) {
  return Object.fromEntries(Object.entries(parsed.entities).filter(([, value]) => Array.isArray(value) && value.length));
}
