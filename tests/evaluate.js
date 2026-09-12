import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';

const source = fileURLToPath(new URL('../data/Dataset_CED-TCT1_การรับสมัคร.xlsx', import.meta.url));
const { records } = loadDataset(source); const chatbot = new HybridSearch(records);
const sample = records.filter((_, index) => index % 25 === 0).slice(0, 20);
const variations = (question) => [question, question.replace(/[?？]/g, '').replace(/(?:ครับ|ค่ะ|คะ|หน่อย)/g, '').trim(), question.split(/\s+/).filter((_, index) => index % 3 !== 1).join(' ')].filter((value) => value.length >= 5);
let total = 0; let top1 = 0; let top3 = 0; let entityRetained = 0;
for (const record of sample) for (const query of variations(record.question)) {
  const { parsed, results } = chatbot.search(query); total += 1;
  if (results[0]?.id === record.id) top1 += 1;
  if (results.slice(0, 3).some((candidate) => candidate.id === record.id)) top3 += 1;
  const recordQuery = chatbot.search(record.question).parsed;
  const specified = Object.values(recordQuery.entities).flat().length;
  const retained = Object.entries(recordQuery.entities).every(([key, values]) => !values.length || values.every((value) => parsed.entities[key]?.includes(value)));
  if (!specified || retained) entityRetained += 1;
}
const noAnswerQueries = ['CED ค่าอาหารโรงอาหารเท่าไหร่', 'มีสระว่ายน้ำไหม', 'ค่าแท็กซี่ไปมหาวิทยาลัยเท่าไร'];
const noAnswerAccuracy = noAnswerQueries.filter((query) => chatbot.reply(query).intent === 'not_found').length / noAnswerQueries.length;
const ambiguityQuery = 'ค่าเทอมเท่าไหร่';
const ambiguityAccuracy = chatbot.reply(ambiguityQuery).intent === 'clarify' ? 1 : 0;
console.table([{ samples: total, top1_accuracy: `${(top1 / total * 100).toFixed(1)}%`, top3_recall: `${(top3 / total * 100).toFixed(1)}%`, entity_retention: `${(entityRetained / total * 100).toFixed(1)}%`, no_answer_accuracy: `${(noAnswerAccuracy * 100).toFixed(1)}%`, ambiguity_accuracy: `${(ambiguityAccuracy * 100).toFixed(1)}%` }]);
