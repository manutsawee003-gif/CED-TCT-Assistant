import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from './datasetLoader.js';
import { HybridSearch } from './chatbotSearch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const datasetPath = process.env.DATASET_PATH ? path.resolve(root, process.env.DATASET_PATH) : path.join(root, 'data', 'Dataset_CED-TCT1_การรับสมัคร.xlsx');
let runtime;

/** Process-level singleton: loaded once per local server or Vercel function instance. */
export function getChatRuntime() {
  if (!runtime) {
    const { records, sheetName } = loadDataset(datasetPath);
    runtime = { search: new HybridSearch(records), records, sheetName, sessions: new Map() };
  }
  return runtime;
}

export function answerChat(message, sessionId = 'default') {
  const service = getChatRuntime();
  const response = service.search.reply(message, service.sessions.get(sessionId) || {});
  service.sessions.set(sessionId, response.context || {});
  const { results, ...publicResponse } = response;
  return {
    ...publicResponse,
    needsClarification: response.intent === 'clarify',
    topResults: results.map(({ question, answer, category, dataset, score, semanticScore, lexicalScore, fuzzyScore, entityScore, intentScore, conflictPenalty, matchedVariant }) => ({ question, answer, category, dataset, score, semanticScore, lexicalScore, fuzzyScore, entityScore, intentScore, conflictPenalty, matchedVariant }))
  };
}
