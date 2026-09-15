import test from 'node:test';
import assert from 'node:assert/strict';
import { answerChat } from '../server/chatRuntime.js';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch } from '../server/chatbotSearch.js';

test('resolves a short follow-up while allowing its explicit programme to replace old context', async () => {
  await answerChat('CED ค่าเทอมเท่าไหร่', 'follow-up-regression');
  const result = await answerChat('แล้ว TCT ล่ะ', 'follow-up-regression');
  assert.match(result.matchedQuestion, /ค่าเทอมหลักสูตร TCT/);
  assert.match(result.answer, /25,000 บาทต่อภาคการศึกษา/);
});

test('broad scope can return multiple selected Dataset records without generating facts', () => {
  const { records } = loadDataset(fileURLToPath(new URL('../data/Dataset_CED-TCT1_การรับสมัคร.xlsx', import.meta.url)));
  const search = new HybridSearch(records);
  const interpretation = { available: true, intent: 'course_information', normalized_query: 'ข้อมูลหลักสูตร CED', keywords: ['หลักสูตร'], semantic_concepts: ['course information'], search_queries: [], entities: { program: ['ced'] }, constraints: {}, answer_scope: 'multi', possible_meanings: [], confidence: 0.9, ambiguous: false };
  const preliminary = search.search('ขอข้อมูลหลักสูตร CED', {}, 8, interpretation);
  const chosen = preliminary.results.slice(0, 2).map(({ id }) => id);
  const rerank = { available: true, ranking: chosen.map((candidate_id) => ({ candidate_id, relevance: 1 })), selected_candidate_ids: chosen, confidence: 0.9, needs_clarification: false };
  const finalSearch = search.search('ขอข้อมูลหลักสูตร CED', {}, 8, interpretation, rerank);
  const result = search.reply('ขอข้อมูลหลักสูตร CED', {}, interpretation, rerank, finalSearch);
  assert.equal(result.intent, 'dataset_multi');
  assert.equal(result.selectedRecords.length, 2);
  for (const selected of result.selectedRecords) assert.ok(records.some((record) => record.id === selected.id));
});
