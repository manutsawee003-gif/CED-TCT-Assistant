import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDomainIndex, contextFromQuery, extractEntities, normalizeText, parseQuery } from './queryUnderstanding.js';
import { SemanticRetriever } from './semanticRetriever.js';
import { loadOrBuildVariantCache } from './variantCache.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const VOCABULARY_PATH = path.join(here, '..', 'config', 'domainVocabulary.json');
const VARIANT_CACHE_PATH = path.join(here, '..', 'cache', 'searchVariants.json');
const GREETINGS = /^(?:สวัสดี|หวัดดี|hello|hi|hey)$/i;
const THANKS = /^(?:ขอบคุณ|ขอบใจ|thanks?|thank you)$/i;
export const NOT_FOUND = 'ขออภัยครับ ผมยังไม่พบข้อมูลเกี่ยวกับคำถามนี้ในฐานข้อมูล CED/TCT กรุณาลองถามใหม่โดยระบุรายละเอียดเพิ่มเติมครับ';

function sourceFromAnswer(answer) { return answer.split(/\r?\n/).filter((line) => /(?:ดูข้อมูลเพิ่มเติม|แหล่งอ้างอิง|https?:\/\/)/i.test(line)).join('\n'); }
function valuesIntersect(left = [], right = []) { return left.some((value) => right.includes(value)); }
function recordEntities(record, domain) { return extractEntities(record.question, domain); }

export class HybridSearch {
  constructor(records) {
    this.domain = buildDomainIndex(records, VOCABULARY_PATH);
    const cache = loadOrBuildVariantCache(this.domain.records, VARIANT_CACHE_PATH);
    this.variantCacheStatus = cache.cacheStatus;
    this.retriever = new SemanticRetriever(this.domain, cache.variants);
    this.recordEntityIndex = new Map(this.domain.records.map((record) => [record.id, recordEntities(record, this.domain)]));
  }
  rerank(parsed, candidates) {
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
      const finalScore = Math.max(0, candidate.semanticScore * 0.38 + candidate.lexicalScore * 0.20 + candidate.fuzzyScore * 0.08 + entityScore * 0.24 + intentScore * 0.06 + categoryScore * 0.04 - conflictPenalty * 0.42);
      return { ...candidate, entityScore, intentScore, categoryScore, conflictPenalty, score: Number(finalScore.toFixed(4)) };
    }).sort((a, b) => b.score - a.score);
  }
  search(query, context = {}, topK = 5) {
    const parsed = parseQuery(query, this.domain, context);
    const candidates = this.retriever.retrieve(parsed, Math.max(topK * 4, 20));
    return { parsed, results: this.rerank(parsed, candidates).slice(0, topK) };
  }
  reply(message, context = {}) {
    const normalized = normalizeText(message);
    if (GREETINGS.test(normalized)) return { answer: 'สวัสดีครับ ผมคือ CED/TCT Assistant สามารถสอบถามข้อมูลเกี่ยวกับหลักสูตร รายวิชา คุณสมบัติผู้สมัคร ค่าเล่าเรียน และการรับสมัคร CED/TCT ได้ครับ', intent: 'greeting', confidence: 1, results: [], context: {} };
    if (THANKS.test(normalized)) return { answer: 'ยินดีครับ หากมีคำถามเกี่ยวกับ CED/TCT หรือการรับสมัคร สามารถสอบถามได้เลยครับ', intent: 'thanks', confidence: 1, results: [], context };
    const { parsed, results } = this.search(message, context); const best = results[0]; const second = results[1];
    const ambiguityKeys = ['program', 'academic_year', 'admission_round', 'education_level'];
    if (parsed.entities.course_code.length) ambiguityKeys.push('course_code');
    const importantDivergence = second && ambiguityKeys.some((key) => {
      const left = this.recordEntityIndex.get(best.id)[key] || []; const right = this.recordEntityIndex.get(second.id)[key] || [];
      return (left.length || right.length) && !valuesIntersect(left, right);
    });
    const ambiguous = Boolean(best && second && best.score >= 0.35 && (best.score - second.score) < 0.045 && importantDivergence && !parsed.entities.program.length && !parsed.entities.course_code.length);
    if (ambiguous) return { answer: 'คำถามนี้อาจหมายถึงข้อมูลมากกว่าหนึ่งกรณี กรุณาระบุหลักสูตร รอบสมัคร หรือปีการศึกษาเพิ่มเติมครับ', intent: 'clarify', confidence: best.score, results, query: { ...parsed, ambiguity: true }, context: contextFromQuery(parsed) };
    const evidence = best ? (best.semanticScore * 0.5) + (best.lexicalScore * 0.3) + (best.fuzzyScore * 0.2) : 0;
    if (!best || best.score < 0.35 || evidence < 0.19) return { answer: NOT_FOUND, intent: 'not_found', confidence: best?.score || 0, results, query: parsed, context: contextFromQuery(parsed) };
    return { answer: best.answer, matchedQuestion: best.question, category: best.category, dataset: best.dataset, confidence: best.score, source: sourceFromAnswer(best.answer), intent: 'dataset', results, query: parsed, context: contextFromQuery(parsed) };
  }
}

export { normalizeText };
