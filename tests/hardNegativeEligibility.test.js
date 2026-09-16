import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';
const { records } = loadDataset(fileURLToPath(new URL('../data/CED_TCT_2569_Dataset_1200.xlsx', import.meta.url)));
const chatbot = new HybridSearch(records);
test('hard negative: same topic/entities with different intents is resolved by alias intent', () => { const groups = new Map(); for (const record of records) { const key = `${record.topic}|${record.entities}`; groups.set(key, [...(groups.get(key) || []), record]); } const group = [...groups.values()].find((items) => new Set(items.map((item) => item.intent)).size > 1 && items.some((item) => item.searchAliases.length)); const target = group.find((item) => item.searchAliases.length); assert.equal(chatbot.search(target.searchAliases[0], {}, 1).results[0]?.id, target.id); });
