import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset, REQUIRED_COLUMNS } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';

const source = fileURLToPath(new URL('../data/CED_TCT_2569_Dataset_1200.xlsx', import.meta.url));
const loaded = loadDataset(source); const chatbot = new HybridSearch(loaded.records);

test('loads the 1,200-record header-mapped Dataset รวม workbook', () => {
  assert.equal(loaded.sheetName, 'Dataset รวม'); assert.equal(loaded.records.length, 1200);
  assert.deepEqual(loaded.columns, REQUIRED_COLUMNS); assert.match(loaded.datasetHash, /^[a-f0-9]{64}$/);
});
test('parses aliases without duplicating canonical IDs', () => {
  const record = loaded.records.find((item) => item.id === 'CED-0001');
  assert.deepEqual(record.searchAliases, ['020033501 ชื่อวิชาอะไร', 'วิชา 020033501 คืออะไร']);
  const result = chatbot.search(record.searchAliases[0], {}, 5).results;
  assert.equal(result[0].id, record.id); assert.equal(new Set(result.map((item) => item.id)).size, result.length);
});
test('returns Answer only and carries real source metadata', () => {
  const record = loaded.records.find((item) => item.id === 'CED-0002');
  const reply = chatbot.reply(record.question);
  assert.equal(reply.answer, record.answer); assert.equal(reply.source, record.source); assert.equal(reply.sourcePage, record.sourcePage);
});
test('metadata intent breaks ties within a shared entity/topic candidate pool', () => {
  const groups = new Map();
  for (const record of loaded.records) { const key = `${record.topic}|${record.entities}`; const values = groups.get(key) || []; values.push(record); groups.set(key, values); }
  const pair = [...groups.values()].find((values) => new Set(values.map((item) => item.intent)).size > 1 && values.some((item) => item.searchAliases.length));
  assert.ok(pair, 'dataset must contain an intent-confusion hard-negative pair');
  const target = pair.find((item) => item.searchAliases.length) || pair[0];
  assert.equal(chatbot.search(target.searchAliases[0] || target.question, {}, 1).results[0]?.id, target.id);
});
