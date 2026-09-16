import test from 'node:test';
import assert from 'node:assert/strict';
import { getChatRuntime } from '../server/chatRuntime.js';
test('runtime defaults to the deployed 2569 dataset', () => assert.equal(getChatRuntime().records.length, 1200));
