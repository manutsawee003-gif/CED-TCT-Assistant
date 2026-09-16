import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';

const source = fileURLToPath(new URL('../data/CED_TCT_2569_Dataset_1200.xlsx', import.meta.url));
const { records } = loadDataset(source); const chatbot = new HybridSearch(records);
const sampled = records.slice(0, 1);
const cases = sampled.flatMap((record) => [{ type: 'Exact Question', query: record.question }, { type: 'Spacing Error', query: record.question.replace(/\s+/g, '') }, ...record.searchAliases.slice(0, 1).map((query) => ({ type: 'Search Alias', query }))].map((item) => ({ ...item, id: record.id })));
const metrics = { total: cases.length, hit1: 0, hit3: 0, hit5: 0, hit10: 0, reciprocalRank: 0 };
for (const item of cases) {
  const results = chatbot.search(item.query, {}, 10).results; const rank = results.findIndex((candidate) => candidate.id === item.id) + 1;
  if (rank === 1) metrics.hit1 += 1; if (rank && rank <= 3) metrics.hit3 += 1; if (rank && rank <= 5) metrics.hit5 += 1; if (rank && rank <= 10) metrics.hit10 += 1; if (rank) metrics.reciprocalRank += 1 / rank;
}
const pct = (value) => `${(value / metrics.total * 100).toFixed(1)}%`;
console.table([{ cases: metrics.total, 'Hit@1': pct(metrics.hit1), 'Hit@3': pct(metrics.hit3), 'Hit@5': pct(metrics.hit5), 'Hit@10': pct(metrics.hit10), MRR: (metrics.reciprocalRank / metrics.total).toFixed(4) }]);
