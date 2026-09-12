import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';
import { HybridSearch, NOT_FOUND } from '../server/chatbotSearch.js';

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
