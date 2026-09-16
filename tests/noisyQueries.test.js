import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';
const { records } = loadDataset(fileURLToPath(new URL('../data/CED_TCT_2569_Dataset_1200.xlsx', import.meta.url)));
const chatbot = new HybridSearch(records);
test('spacing variation remains retrievable', () => { const record = records[0]; assert.equal(chatbot.search(record.question.replace(/\s+/g, ''), {}, 1).results[0]?.id, record.id); });
