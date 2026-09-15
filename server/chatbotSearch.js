import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDomainIndex, contextFromQuery, extractEntities, normalizeText, parseQuery } from './queryUnderstanding.js';
import { SemanticRetriever } from './semanticRetriever.js';
import { Bm25Retriever } from './bm25Retriever.js';
import { DenseRetriever } from './denseRetriever.js';
import { loadOrBuildVariantCache } from './variantCache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VOCABULARY_PATH = path.join(here, '..', 'config', 'domainVocabulary.json');
const VARIANT_CACHE_PATH = path.join(here, '..', 'cache', 'searchVariants.json');
const MIN_SCORE = Number(process.env.RETRIEVAL_MIN_SCORE || 0.35);
const MIN_EVIDENCE = Number(process.env.RETRIEVAL_MIN_EVIDENCE || 0.19);
const AMBIGUITY_MARGIN = Number(process.env.RETRIEVAL_AMBIGUITY_MARGIN || 0.045);
const ENTITY_WEIGHT = Number(process.env.RETRIEVAL_ENTITY_WEIGHT || 0.30);
const SEMANTIC_WEIGHT = Number(process.env.RETRIEVAL_SEMANTIC_WEIGHT || 0.28);
const ANSWER_SEMANTIC_WEIGHT = Number(process.env.RETRIEVAL_ANSWER_SEMANTIC_WEIGHT || 0.08);
const LEXICAL_WEIGHT = Number(process.env.RETRIEVAL_LEXICAL_WEIGHT || 0.16);
const FUZZY_WEIGHT = Number(process.env.RETRIEVAL_FUZZY_WEIGHT || 0.07);
const INTENT_WEIGHT = Number(process.env.RETRIEVAL_INTENT_WEIGHT || 0.07);
const CATEGORY_WEIGHT = Number(process.env.RETRIEVAL_CATEGORY_WEIGHT || 0.04);
const EXPANSION_WEIGHT = Number(process.env.RETRIEVAL_EXPANSION_WEIGHT || 0.04);
const CONFLICT_PENALTY = Number(process.env.RETRIEVAL_CONFLICT_PENALTY || 0.50);
const RRF_K = Number(process.env.RETRIEVAL_RRF_K || 60);
const AI_RERANK_BLEND = Number(process.env.AI_RERANK_BLEND || 0.25);
const MULTI_RECORD_WINDOW = Number(process.env.MULTI_RECORD_SCORE_WINDOW || 0.10);
const MAX_MULTI_RECORDS = Math.max(2, Number(process.env.MAX_MULTI_RECORDS || 3));
const GREETINGS = /^(?:สวัสดี|หวัดดี|hello|hi|hey)$/i;
const THANKS = /^(?:ขอบคุณ|ขอบใจ|thanks?|thank you)$/i;
export const NOT_FOUND = 'ขออภัยครับ ผมยังไม่พบข้อมูลเกี่ยวกับคำถามนี้ในฐานข้อมูล CED/TCT กรุณาลองถามใหม่โดยระบุรายละเอียดเพิ่มเติมครับ';

function sourceFromAnswer(answer) { return answer.split(/\r?\n/).filter((line) => /(?:ดูข้อมูลเพิ่มเติม|แหล่งอ้างอิง|https?:\/\/)/i.test(line)).join('\n'); }
function valuesIntersect(left = [], right = []) { return left.some((value) => right.includes(value)); }
// Categories frequently say "CED/TCT" for both programmes, so use the record
// question as the authoritative scope for a programme/entity constraint.
function recordEntities(record, domain) { return extractEntities(record.question, domain); }
function formatDatasetAnswers(records) { return records.map((record, index) => `${index + 1}. ${record.question}\n${record.answer}`).join('\n\n'); }

export class HybridSearch {
  constructor(records) {
    this.domain = buildDomainIndex(records, VOCABULARY_PATH);
    const cache = loadOrBuildVariantCache(this.domain.records, VARIANT_CACHE_PATH);
    this.variantCacheStatus = cache.cacheStatus;
    this.retriever = new SemanticRetriever(this.domain, cache.variants);
    this.bm25Retriever = new Bm25Retriever(this.domain, cache.variants);
    this.denseRetriever = new DenseRetriever(this.domain, cache.variants);
    this.denseEnabled = process.env.DENSE_ENABLED === 'true';
    this.recordEntityIndex = new Map(this.domain.records.map((record) => [record.id, recordEntities(record, this.domain)]));
  }
  fuseCandidates(semanticResults, bm25Results, candidateLimit, denseResults = []) {
    const byId = new Map();
    const add = (candidate, engine, rank) => {
      const current = byId.get(candidate.id) || { ...candidate, engineRanks: {}, rrfScore: 0 };
      // Retain all component values from the semantic retriever; BM25 supplies
      // the best Dataset record metadata where semantic retrieval did not.
      Object.assign(current, candidate, { engineRanks: current.engineRanks });
      current.engineRanks[engine] = rank;
      current.rrfScore += 1 / (RRF_K + rank);
      byId.set(candidate.id, current);
    };
    semanticResults.forEach((candidate, index) => add(candidate, 'semantic', index + 1));
    bm25Results.forEach((candidate, index) => add(candidate, 'bm25', index + 1));
    denseResults.forEach((candidate, index) => add(candidate, 'dense', index + 1));
    return [...byId.values()].sort((left, right) => right.rrfScore - left.rrfScore).slice(0, candidateLimit);
  }
  rerank(parsed, candidates, aiRerank = null) {
    const aiScores = new Map((aiRerank?.available ? aiRerank.ranking : []).map(({ candidate_id, relevance }) => [candidate_id, relevance]));
    return candidates.map((candidate) => {
      const candidateEntities = this.recordEntityIndex.get(candidate.id); let compatible = 0; let conflicts = 0; let specified = 0;
      for (const [key, expected] of Object.entries(parsed.entities)) {
        if (!expected?.length || key === 'topic') continue;
        specified += 1;
        if (valuesIntersect(expected, candidateEntities[key])) compatible += 1; else conflicts += 1;
      }
      const entityScore = specified ? compatible / specified : 0.5;
      const conflictPenalty = specified ? conflicts / specified : 0;
      const intentScore = candidate.inferredIntent === parsed.intent ? 1 : 0;
      const categoryScore = parsed.entities.topic?.some((topic) => normalizeText(candidate.category).includes(topic)) ? 1 : 0;
      const structuredScore = entityScore;
      const rankAgreement = Object.keys(candidate.engineRanks || {}).length / 3;
      const denseScore = Number.isFinite(candidate.denseScore) ? Math.max(0, candidate.denseScore + 1) / 2 : 0;
      const baseScore = Math.max(0, (candidate.semanticScore || 0) * SEMANTIC_WEIGHT + (candidate.answerSemanticScore || 0) * ANSWER_SEMANTIC_WEIGHT + (candidate.lexicalScore || 0) * LEXICAL_WEIGHT + (candidate.fuzzyScore || 0) * FUZZY_WEIGHT + denseScore * 0.16 + structuredScore * ENTITY_WEIGHT + intentScore * INTENT_WEIGHT + categoryScore * CATEGORY_WEIGHT + (candidate.expansionSupport || 0) * EXPANSION_WEIGHT + candidate.rrfScore * 3 * 0.08 + rankAgreement * 0.04 - conflictPenalty * CONFLICT_PENALTY);
      const aiRerankScore = aiScores.get(candidate.id) ?? null;
      const finalScore = aiRerankScore === null ? baseScore : baseScore * (1 - AI_RERANK_BLEND) + aiRerankScore * AI_RERANK_BLEND;
      return { ...candidate, structuredScore, entityScore, intentScore, categoryScore, conflictPenalty, rankAgreement, baseScore: Number(baseScore.toFixed(4)), aiRerankScore, score: Number(finalScore.toFixed(4)) };
    }).sort((a, b) => b.score - a.score);
  }
  search(query, context = {}, topK = 8, interpretation = null, aiRerank = null) {
    const parsed = parseQuery(query, this.domain, context, interpretation);
    const candidateLimit = Math.max(topK * 4, 30);
    const semanticResults = this.retriever.retrieve(parsed, candidateLimit);
    const bm25Results = this.bm25Retriever.retrieve(parsed, candidateLimit);
    const candidates = this.fuseCandidates(semanticResults, bm25Results, candidateLimit);
    return { parsed, results: this.rerank(parsed, candidates, aiRerank).slice(0, topK), retrievalDebug: { semanticResults, bm25Results, rrfResults: candidates } };
  }
  async searchWithDense(query, context = {}, topK = 8, interpretation = null, aiRerank = null) {
    const base = this.search(query, context, topK, interpretation, null);
    if (!this.denseEnabled) return { ...base, denseStatus: { available: false, reason: 'disabled' } };
    // Dense retrieval must improve recall, never turn a chat request into a
    // model-loading wait. Its initialization continues in the background and
    // BM25/TF-IDF/fuzzy remain the deterministic fast fallback.
    const timeoutMs = Math.max(100, Number(process.env.DENSE_QUERY_TIMEOUT_MS || 1500));
    let timeout;
    const dense = await Promise.race([
      this.denseRetriever.retrieve(base.parsed, Math.max(topK * 4, 30)),
      new Promise((resolve) => { timeout = setTimeout(() => resolve({ available: false, reason: 'timeout' }), timeoutMs); })
    ]);
    clearTimeout(timeout);
    if (!dense.available) return { ...base, denseStatus: dense };
    const candidates = this.fuseCandidates(base.retrievalDebug.semanticResults, base.retrievalDebug.bm25Results, Math.max(topK * 4, 30), dense.results);
    return { parsed: base.parsed, results: this.rerank(base.parsed, candidates, aiRerank).slice(0, topK), denseStatus: dense, retrievalDebug: { ...base.retrievalDebug, denseResults: dense.results, rrfResults: candidates } };
  }
  reply(message, context = {}, interpretation = null, aiRerank = null, precomputed = null) {
    const normalized = normalizeText(message);
    if (GREETINGS.test(normalized)) return { answer: 'สวัสดีครับ ผมคือ CED/TCT Assistant สามารถสอบถามข้อมูลเกี่ยวกับหลักสูตร รายวิชา คุณสมบัติผู้สมัคร ค่าเล่าเรียน และการรับสมัคร CED/TCT ได้ครับ', intent: 'greeting', confidence: 1, results: [], context: {} };
    if (THANKS.test(normalized)) return { answer: 'ยินดีครับ หากมีคำถามเกี่ยวกับ CED/TCT หรือการรับสมัคร สามารถสอบถามได้เลยครับ', intent: 'thanks', confidence: 1, results: [], context };
    const { parsed, results } = precomputed || this.search(message, context, 8, interpretation, aiRerank); const best = results[0]; const second = results[1];
    if (parsed.ambiguity) return { answer: 'คำถามนี้อาจมีได้มากกว่าหนึ่งความหมาย กรุณาระบุหลักสูตร รอบสมัคร ปีการศึกษา หรือรายละเอียดที่ต้องการเพิ่มเติมครับ', intent: 'clarify', confidence: parsed.interpretation_confidence || 0, results, query: parsed, context: contextFromQuery(parsed) };
    const ambiguityKeys = ['program', 'academic_year', 'admission_round', 'education_level'];
    if (parsed.entities.course_code.length) ambiguityKeys.push('course_code');
    const importantDivergence = second && ambiguityKeys.some((key) => {
      const left = this.recordEntityIndex.get(best.id)[key] || []; const right = this.recordEntityIndex.get(second.id)[key] || [];
      return (left.length || right.length) && !valuesIntersect(left, right);
    });
    const scoreGap = best && second ? Number((best.score - second.score).toFixed(4)) : 1;
    const ambiguous = Boolean(best && second && best.score >= MIN_SCORE && scoreGap < AMBIGUITY_MARGIN && importantDivergence && !parsed.entities.program.length && !parsed.entities.course_code.length) || Boolean(aiRerank?.available && aiRerank.needs_clarification && scoreGap < AMBIGUITY_MARGIN * 2);
    if (ambiguous) return { answer: 'คำถามนี้อาจหมายถึงข้อมูลมากกว่าหนึ่งกรณี กรุณาระบุหลักสูตร รอบสมัคร หรือปีการศึกษาเพิ่มเติมครับ', intent: 'clarify', confidence: best.score, results, query: { ...parsed, ambiguity: true }, context: contextFromQuery(parsed) };
    const evidence = best ? (best.semanticScore * 0.5) + (best.lexicalScore * 0.3) + (best.fuzzyScore * 0.2) : 0;
    const finalConfidence = best ? Number(Math.min(1, best.score * 0.72 + Math.min(1, evidence / 0.5) * 0.16 + Math.min(1, scoreGap / 0.2) * 0.12).toFixed(4)) : 0;
    if (!best || best.score < MIN_SCORE || evidence < MIN_EVIDENCE) return { answer: NOT_FOUND, intent: 'not_found', confidence: finalConfidence, results, query: parsed, context: contextFromQuery(parsed), confidenceBreakdown: { retrieval: best?.score || 0, evidence, scoreGap } };
    if (parsed.answer_scope === 'multi') {
      const rerankedIds = aiRerank?.available ? new Set(aiRerank.selected_candidate_ids || []) : null;
      const selectedRecords = results.filter((candidate) => candidate.score >= MIN_SCORE && candidate.score >= best.score - MULTI_RECORD_WINDOW && candidate.conflictPenalty === 0 && (!rerankedIds || rerankedIds.has(candidate.id))).filter((candidate, index, all) => all.findIndex((item) => item.answer === candidate.answer) === index).slice(0, MAX_MULTI_RECORDS);
      if (selectedRecords.length >= 2) return { answer: formatDatasetAnswers(selectedRecords), matchedQuestion: best.question, selectedRecords: selectedRecords.map(({ id, question, category, dataset, score }) => ({ id, question, category, dataset, score })), category: best.category, dataset: best.dataset, confidence: finalConfidence, source: selectedRecords.map((record) => sourceFromAnswer(record.answer)).filter(Boolean).join('\n'), intent: 'dataset_multi', results, query: parsed, context: contextFromQuery(parsed), confidenceBreakdown: { retrieval: best.score, evidence, scoreGap, structured: best.structuredScore, aiRerank: best.aiRerankScore } };
    }
    return { answer: best.answer, matchedQuestion: best.question, category: best.category, dataset: best.dataset, confidence: finalConfidence, source: sourceFromAnswer(best.answer), intent: 'dataset', results, query: parsed, context: contextFromQuery(parsed), confidenceBreakdown: { retrieval: best.score, evidence, scoreGap, structured: best.structuredScore, aiRerank: best.aiRerankScore } };
  }
}

export { normalizeText };
