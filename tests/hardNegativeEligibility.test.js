import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';

const source = fileURLToPath(new URL('../data/Dataset_CED-TCT1_การรับสมัคร.xlsx', import.meta.url));
const { records } = loadDataset(source);
const chatbot = new HybridSearch(records);

test('hard negative: eligibility outranks an on-topic Portfolio schedule', () => {
  const result = chatbot.reply('นักเรียน วิทย์-คณิต สมัคร CED รอบพอร์ตได้ไหม');
  assert.equal(result.intent, 'dataset');
  assert.match(result.matchedQuestion, /วิทยาศาสตร์-คณิตศาสตร์/);
  assert.doesNotMatch(result.answer, /21 กันยายน 2568 ถึง 10 พฤศจิกายน 2568/);
});
