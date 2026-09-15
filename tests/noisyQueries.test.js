import test from 'node:test';
import assert from 'node:assert/strict';
import { answerChat, getChatRuntime } from '../server/chatRuntime.js';
import { preprocessQuery } from '../server/queryUnderstanding.js';

test('spacing, no-space, missing and extra-character variants retain the Dataset record', async () => {
  for (const query of ['ค่า เทอม   CED เท่าไหร่', 'ค่าเทอมCEDเท่าไหร่', 'ค่าเทอมมม CED เท่าไหร']) {
    const result = await answerChat(query, `noise-${query}`);
    assert.match(result.matchedQuestion, /ค่าเทอมหลักสูตร CED/);
  }
});

test('Dataset-aware correction offers a transposition alternative without blindly applying it', async () => {
  const preprocessing = preprocessQuery('ค่าเทอม CDE เท่าไหร่', getChatRuntime().search.domain);
  const correction = preprocessing.corrections.find((item) => item.token === 'cde');
  assert.ok(correction?.candidates.some((candidate) => candidate.value === 'ced'));
  assert.equal(correction.applied, false);
  const result = await answerChat('ค่าเทอม CDE เท่าไหร่', 'ambiguous-typo');
  assert.equal(result.intent, 'clarify');
});

test('Thai typo remains retrievable through Dataset-derived character signals', async () => {
  const result = await answerChat('รหัสสมัค TCT คืออะไร', 'thai-typo');
  assert.match(result.matchedQuestion, /รหัสสาขาวิชาสำหรับการสมัครหลักสูตร TCT/);
});
