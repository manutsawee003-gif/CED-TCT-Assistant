import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch, NOT_FOUND } from '../server/chatbotSearch.js';

test('uses an AI-normalized semantic query but still returns only a Dataset answer', () => {
  const result = chatbot.reply('ค่าเรียนแพงปะของซีอีดี', {}, { available: true, intent: 'cost', normalized_query: 'ค่าเทอมหลักสูตร CED ปีการศึกษา 2569 เท่าไร', keywords: ['ค่าบำรุงการศึกษา'], entities: { program: ['ced'] }, possible_meanings: [], confidence: 0.94, ambiguous: false });
  assert.equal(result.query.typhoon, 'used');
  assert.match(result.answer, /25,000 บาทต่อภาคการศึกษา/);
});
test('does not guess when the interpreter marks a question ambiguous', () => {
  const result = chatbot.reply('ค่าใช้จ่ายเท่าไหร่', {}, { available: true, intent: 'cost', normalized_query: 'ค่าใช้จ่าย', keywords: [], entities: {}, possible_meanings: ['ค่าเทอม', 'ค่าสมัคร'], confidence: 0.4, ambiguous: true });
  assert.equal(result.intent, 'clarify');
});

const { records } = loadDataset(fileURLToPath(new URL('../data/Dataset_CED-TCT1_การรับสมัคร.xlsx', import.meta.url)));
const chatbot = new HybridSearch(records);

test('uses only Dataset รวม and loads all usable records', () => assert.equal(records.length, 1249));
test('CED tuition finds the source answer', () => assert.match(chatbot.reply('CED ค่าเทอมเท่าไหร่').answer, /25,000 บาทต่อภาคการศึกษา/));
test('CED application code is 02111', () => assert.match(chatbot.reply('รหัสสมัคร CED คืออะไร').answer, /02111/));
test('TCT application code is 02301', () => assert.match(chatbot.reply('รหัสสมัคร TCT').answer, /02301/));
test('TCT vocational qualification is relevant', () => { const result = chatbot.reply('ปวส สมัคร TCT ได้ไหม'); assert.equal(result.intent, 'dataset'); assert.match(`${result.matchedQuestion} ${result.answer}`, /ปวส/); });
test('CED M6 eligibility is relevant', () => { const result = chatbot.reply('CED ม6 สมัครได้ไหม'); assert.equal(result.intent, 'dataset'); assert.match(`${result.matchedQuestion} ${result.answer}`, /ม\.6|ม6/); });
test('English 1 has 3 credits', () => assert.match(chatbot.reply('ภาษาอังกฤษ 1 กี่หน่วยกิต').answer, /3 หน่วยกิต/));
test('unavailable cafeteria price never hallucinates', () => assert.equal(chatbot.reply('CED ค่าอาหารโรงอาหารเท่าไหร่').answer, NOT_FOUND));
test('greeting bypasses search', () => assert.equal(chatbot.reply('สวัสดี').intent, 'greeting'));
test('thanks bypasses search', () => assert.equal(chatbot.reply('ขอบคุณ').intent, 'thanks'));
