import 'dotenv/config';
import express from 'express';
import { answerChat, getChatRuntime } from './chatRuntime.js';

const runtime = getChatRuntime();
const app = express(); app.use(express.json({ limit: '20kb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, records: runtime.records.length, sheet: runtime.sheetName, variantCache: runtime.search.variantCacheStatus }));
app.post('/api/chat', (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.length <= 100 ? req.body.sessionId : 'default';
  if (!message) return res.status(400).json({ error: 'message ต้องเป็นข้อความที่ไม่ว่าง' });
  const response = answerChat(message, sessionId);
  if (process.env.DEBUG_CHAT === 'true') console.info(JSON.stringify({ originalQuery: message, normalizedQuery: response.query?.normalized_query, detectedIntent: response.query?.intent, extractedEntities: response.query?.entities, inheritedContext: response.query?.inherited_context, candidates: response.results, confidence: response.confidence, ambiguity: response.query?.ambiguity, selectedRecord: response.matchedQuestion }, null, 2));
  return res.json(response);
});
const port = Number(process.env.PORT || 3001);
app.listen(port, () => console.log(`CED/TCT API ready at http://localhost:${port} (${runtime.records.length} records cached)`));
