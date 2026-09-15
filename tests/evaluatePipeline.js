import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';
import { retrievalCases } from './evaluationCases.js';

const source = fileURLToPath(new URL('../data/Dataset_CED-TCT1_การรับสมัคร.xlsx', import.meta.url));
const { records } = loadDataset(source); const chatbot = new HybridSearch(records);
function matches(candidate, expected) { return candidate?.question.includes(expected); }
function score(mode) {
  const totals = { answer: 0, top1: 0, top3: 0, top5: 0, reject: 0, rejectOk: 0, clarify: 0, clarifyOk: 0 };
  for (const item of retrievalCases) {
    const interpretation = mode === 'after' ? item.interpretation || null : null;
    if (item.type === 'answer') {
      totals.answer += 1; const results = chatbot.search(item.query, {}, 8, interpretation).results;
      if (matches(results[0], item.expectedQuestion)) totals.top1 += 1;
      if (results.slice(0, 3).some((candidate) => matches(candidate, item.expectedQuestion))) totals.top3 += 1;
      if (results.slice(0, 5).some((candidate) => matches(candidate, item.expectedQuestion))) totals.top5 += 1;
    } else {
      const reply = chatbot.reply(item.query, {}, interpretation);
      if (item.type === 'reject') { totals.reject += 1; if (reply.intent === 'not_found') totals.rejectOk += 1; }
      if (item.type === 'clarify') { totals.clarify += 1; if (reply.intent === 'clarify') totals.clarifyOk += 1; }
    }
  }
  const percent = (value, total) => `${(value / Math.max(total, 1) * 100).toFixed(1)}%`;
  return { mode, answer_cases: totals.answer, top1_accuracy: percent(totals.top1, totals.answer), top3_recall: percent(totals.top3, totals.answer), top5_recall: percent(totals.top5, totals.answer), correct_rejection: percent(totals.rejectOk, totals.reject), clarification_behavior: percent(totals.clarifyOk, totals.clarify) };
}
console.table([score('before'), score('after')]);
console.log('“after” uses structured-query fixtures that emulate validated Typhoon JSON. Set TYPHOON_API_KEY and run live traffic/evaluation separately to measure provider output. Expected records are Dataset question text only.');
