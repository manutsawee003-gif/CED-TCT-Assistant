import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from './datasetLoader.js';
import { HybridSearch } from './chatbotSearch.js';
import { interpretWithTyphoon } from './typhoonQueryInterpreter.js';
import { rerankWithTyphoon } from './typhoonReranker.js';
import { preprocessQuery } from './queryUnderstanding.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
// Relative to project root so the same deployment bundle works locally/Vercel.
const datasetPath = process.env.DATASET_PATH ? path.resolve(root, process.env.DATASET_PATH) : path.join(root, 'data', 'CED_TCT_2569_Dataset_1200.xlsx');
let runtime;

export function getChatRuntime() {
  if (!runtime) {
    const loaded = loadDataset(datasetPath);
    runtime = { search: new HybridSearch(loaded.records), records: loaded.records, sheetName: loaded.sheetName, columns: loaded.columns, datasetHash: loaded.datasetHash, sessions: new Map() };
    if (runtime.search.denseEnabled) void runtime.search.denseRetriever.initialize();
  }
  return runtime;
}

export async function answerChat(message, sessionId = 'default') {
  const service = getChatRuntime();
  const session = service.sessions.get(sessionId) || { entities: {}, history: [] };
  const previousContext = session.entities || {}; const relevantHistory = (session.history || []).slice(-3);
  const isShortFollowup = Boolean(relevantHistory.length && message.trim().length <= 60 && /(?:^แล้ว|ล่ะ$|เดิม|เทอม\s*\d+)/u.test(message.trim()));
  const searchContext = isShortFollowup ? { ...previousContext, __followup_anchor: relevantHistory.at(-1).question } : previousContext;
  const conversationContext = { entities: previousContext, relevant_turns: relevantHistory, followup_anchor_used: isShortFollowup ? relevantHistory.at(-1).question : null };
  const preprocessing = preprocessQuery(message, service.search.domain);
  const interpretation = await interpretWithTyphoon(message, service.search.domain, { ...conversationContext, query_preprocessing: preprocessing });
  const preliminary = await service.search.searchWithDense(message, searchContext, 8, interpretation);
  const gap = preliminary.results.length > 1 ? preliminary.results[0].score - preliminary.results[1].score : 1;
  const shouldRerank = interpretation.available && !preliminary.parsed.ambiguity && preliminary.results.length >= 2 && gap <= Number(process.env.AI_RERANK_MAX_GAP || 0.12);
  const aiRerank = shouldRerank ? await rerankWithTyphoon({ question: message, conversationContext, parsed: preliminary.parsed, candidates: preliminary.results }) : { available: false, reason: shouldRerank ? 'not_available' : 'not_needed' };
  const finalSearch = aiRerank.available ? await service.search.searchWithDense(message, searchContext, 8, interpretation, aiRerank) : preliminary;
  const response = service.search.reply(message, searchContext, interpretation, aiRerank, finalSearch);
  const turn = { question: message, intent: response.query?.intent || response.intent, entities: response.context || {}, matched_record_id: finalSearch.results[0]?.id || null, matched_question: response.matchedQuestion || null };
  service.sessions.set(sessionId, { entities: response.context || previousContext, history: [...relevantHistory, turn].slice(-4) });
  const { results, ...publicResponse } = response;
  const publicCandidate = ({ id, dataset, category, topic, intent, entities, question, answer, source, sourcePage, sourceExcerpt, confidence: datasetConfidence, score, baseScore, structuredScore, semanticScore, answerSemanticScore, lexicalScore, fuzzyScore, bm25Score, rrfScore, engineRanks, expansionSupport, entityScore, intentScore, topicScore, conflictPenalty, aiRerankScore, aiJudgment, answerabilityScore, matchedVariant }) => ({ id, dataset, category, topic, intent, entities, question, answer, source, sourcePage, sourceExcerpt, datasetConfidence, score, baseScore, structuredScore, semanticScore, answerSemanticScore, lexicalScore, fuzzyScore, bm25Score, rrfScore, engineRanks, expansionSupport, entityScore, intentScore, topicScore, conflictPenalty, aiRerankScore, aiJudgment, answerabilityScore, matchedVariant });
  return { ...publicResponse, needsClarification: response.intent === 'clarify', topResults: results.map(publicCandidate), debug: { conversationContext, typhoonInterpretation: interpretation, reranking: aiRerank.available ? aiRerank : aiRerank.reason, top1Top2Gap: finalSearch.results.length > 1 ? Number((finalSearch.results[0].score - finalSearch.results[1].score).toFixed(4)) : null, retrieval: finalSearch.retrievalDebug ? { bm25TopResults: finalSearch.retrievalDebug.bm25Results.slice(0, 10).map(({ id, bm25Score }) => ({ id, bm25Score })), tfidfTopResults: finalSearch.retrievalDebug.semanticResults.slice(0, 10).map(({ id, semanticScore }) => ({ id, semanticScore })), fuzzyTopResults: finalSearch.retrievalDebug.fuzzyResults.slice(0, 10).map(({ id, fuzzyScore }) => ({ id, fuzzyScore })), denseTopResults: finalSearch.retrievalDebug.denseResults?.slice(0, 10).map(({ id, denseScore }) => ({ id, denseScore })) || [], rrfTopResults: finalSearch.retrievalDebug.rrfResults.slice(0, 10).map(({ id, rrfScore, engineRanks }) => ({ id, rrfScore, engineRanks })), denseStatus: finalSearch.denseStatus?.status || finalSearch.denseStatus?.reason || 'not_used' } : null } };
}
