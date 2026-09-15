const API_URL = 'https://api.opentyphoon.ai/v1/chat/completions';

const SYSTEM_PROMPT = `You are a query understanding component, not a knowledge answering component.
Your job is to understand a user's Thai question and convert it into structured data for searching a CED/TCT dataset. You may receive Dataset-aware possible typo corrections: treat them as alternatives, not facts. Preserve the user's intended meaning and do not force an uncertain correction.
Understand Thai conversational language, informal language, abbreviations, synonyms, paraphrases, spelling variations, and equivalent expressions.
Do not answer the question. Do not use outside knowledge. Do not invent facts, entities, dates, programmes, or eligibility rules.
Only describe the meaning expressed by the user. When genuinely ambiguous, preserve the alternatives instead of guessing.
Return JSON only, with this exact shape:
{"intent":"one supported retrieval intent","normalized_query":"Thai query preserving the intended meaning","keywords":["important search phrase"],"semantic_concepts":["meaningful concept"],"search_queries":["meaning-preserving query variation"],"entities":{"program":[],"academic_year":[],"course_code":[],"admission_round":[],"education_level":[],"semester":[],"study_year":[],"topic":[]},"constraints":{"field":"explicit value or condition from the user"},"answer_scope":"single or multi","possible_meanings":["meaning only when ambiguous"],"confidence":0.0,"ambiguous":false}.
Supported retrieval intents: find_value, find_list, eligibility, procedure, requirement, date_time, cost, course_information, admission_information, comparison.`;

function cleanJson(content) {
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(text);
}
function asStrings(value, limit = 12) { return Array.isArray(value) ? value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, limit) : []; }
function validateInterpretation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.normalized_query !== 'string' || !value.normalized_query.trim()) throw new Error('Typhoon returned an invalid interpretation schema');
  const entities = value.entities && typeof value.entities === 'object' && !Array.isArray(value.entities) ? value.entities : {};
  const constraints = value.constraints && typeof value.constraints === 'object' && !Array.isArray(value.constraints) ? Object.fromEntries(Object.entries(value.constraints).filter(([key, item]) => typeof key === 'string' && typeof item === 'string').slice(0, 10).map(([key, item]) => [key.slice(0, 80), item.trim().slice(0, 160)])) : {};
  return { intent: typeof value.intent === 'string' ? value.intent.trim().slice(0, 80) : '', normalized_query: value.normalized_query.trim().slice(0, 1000), keywords: asStrings(value.keywords), semantic_concepts: asStrings(value.semantic_concepts), search_queries: asStrings(value.search_queries, 6), entities: Object.fromEntries(['program', 'academic_year', 'course_code', 'admission_round', 'education_level', 'semester', 'study_year', 'topic'].map((key) => [key, asStrings(entities[key])])), constraints, answer_scope: value.answer_scope === 'multi' ? 'multi' : 'single', possible_meanings: asStrings(value.possible_meanings, 5), confidence: Number.isFinite(Number(value.confidence)) ? Math.max(0, Math.min(1, Number(value.confidence))) : 0, ambiguous: value.ambiguous === true };
}
function domainSummary(domain) { return { dataset_schema: { records: 'question, answer, category, dataset', answer_rule: 'The dataset, not you, supplies every final answer.' }, known_programs: [...domain.programs], known_academic_years: [...domain.entityCatalog.academic_year], known_admission_rounds: [...domain.entityCatalog.admission_round], known_education_levels: [...domain.entityCatalog.education_level], known_categories: [...domain.topics].slice(0, 80) }; }

/** Calls Typhoon only to interpret a query. Any failure returns a safe local-retrieval fallback. */
export async function interpretWithTyphoon(message, domain, context = {}) {
  const apiKey = process.env.TYPHOON_API_KEY || process.env.OPENTYPHOON_API_KEY;
  if (!apiKey) return { available: false, reason: 'not_configured' };
  const timeoutMs = Math.max(1000, Number(process.env.TYPHOON_TIMEOUT_MS || 7000));
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(API_URL, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.TYPHOON_MODEL || 'typhoon-v2.5-30b-a3b-instruct', temperature: 0.1, max_tokens: 450, stream: false, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify({ question: message, previous_retrieval_context: context, dataset_search_schema: domainSummary(domain) }) }] }) });
    if (!response.ok) throw new Error(`Typhoon HTTP ${response.status}`);
    const body = await response.json();
    return { available: true, ...validateInterpretation(cleanJson(body?.choices?.[0]?.message?.content)) };
  } catch (error) { return { available: false, reason: error.name === 'AbortError' ? 'timeout' : 'request_failed', error: error.message }; } finally { clearTimeout(timer); }
}
