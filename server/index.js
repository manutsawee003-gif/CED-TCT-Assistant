import 'dotenv/config';
import express from 'express';
import { answerChat, getChatRuntime } from './chatRuntime.js';

const runtime = getChatRuntime();
const app = express(); app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, records: runtime.records.length, sheet: runtime.sheetName, columns: runtime.columns, datasetHash: runtime.datasetHash, variantCache: runtime.search.variantCacheStatus }));
app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.length <= 100 ? req.body.sessionId : 'default';
  if (!message) return res.status(400).json({ error: 'message ต้องเป็นข้อความที่ไม่ว่าง' });
  try {
    const response = await answerChat(message, sessionId);
    if (process.env.DEBUG_CHAT === 'true') console.info(JSON.stringify({ originalQuestion: message, normalizedQuery: response.query?.normalized_query, compactQuery: response.query?.compact_query, correctedQuery: response.query?.corrected_query, detectedErrors: response.query?.corrections, conversationContextUsed: response.debug?.conversationContext, typhoonParsedQuery: response.query?.typhoon === 'used' ? { keywords: response.query?.keywords, semanticConcepts: response.query?.semantic_concepts, constraints: response.query?.constraints, possibleMeanings: response.query?.possible_meanings, confidence: response.query?.interpretation_confidence } : response.query?.typhoon, detectedIntent: response.query?.intent, detectedEntities: response.query?.entities, expandedQueries: response.query?.expanded_queries, retrievalEngines: response.debug?.retrieval, topKCandidates: response.topResults, rerankingResult: response.debug?.reranking, top1Top2Gap: response.debug?.top1Top2Gap, confidenceBreakdown: response.confidenceBreakdown, selectedDatasetRecords: response.selectedRecords || response.matchedQuestion, finalConfidence: response.confidence, finalAnswer: response.answer }, null, 2));
    return res.json(response);
  } catch (error) { console.error('Chat API error', error); return res.status(500).json({ error: 'ไม่สามารถประมวลผล Dataset ได้ในขณะนี้' }); }
});
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`CED/TCT API ready at http://localhost:${port} (${runtime.records.length} records cached)`));
