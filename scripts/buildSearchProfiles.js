import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset } from '../server/datasetLoader.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'Dataset_CED-TCT1_การรับสมัคร.xlsx');
const output = path.join(root, 'cache', 'searchProfiles.json');
const apiKey = process.env.TYPHOON_API_KEY || process.env.OPENTYPHOON_API_KEY;
const limit = Math.max(1, Number(process.env.PROFILE_LIMIT || 1249));
const timeoutMs = Math.max(1000, Number(process.env.TYPHOON_TIMEOUT_MS || 15000));
const { records } = loadDataset(source);
const datasetSignature = crypto.createHash('sha256').update(records.map((record) => `${record.id}|${record.question}|${record.category}`).join('\n')).digest('hex');

if (!apiKey) throw new Error('Set TYPHOON_API_KEY before building search profiles.');
let existing = {};
try { const cached = JSON.parse(fs.readFileSync(output, 'utf8')); if (cached.datasetSignature === datasetSignature) existing = cached.profiles || {}; } catch { /* begin a fresh cache */ }

const system = `You create retrieval metadata for one Dataset Q&A record. You are not an answerer. Do not add facts, dates, names, eligibility requirements, or conditions beyond the supplied record. Return JSON only: {"semantic_summary":"meaning-preserving short summary","important_concepts":["dataset-grounded concept"],"entities":["explicit entity"],"alternative_phrasings":["Thai paraphrase"],"search_terms":["discriminative dataset phrase"],"synthetic_queries":["natural Thai user question"]}. Synthetic queries and alternatives must ask exactly the same thing as the original question. They are aliases for retrieval only, never answers.`;

async function profile(record) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch('https://api.opentyphoon.ai/v1/chat/completions', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.TYPHOON_MODEL || 'typhoon-v2.5-30b-a3b-instruct', temperature: 0, max_tokens: 650, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ id: record.id, dataset: record.dataset, category: record.category, question: record.question, answer: record.answer }) }] }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = String((await response.json())?.choices?.[0]?.message?.content || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const value = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
    const strings = (items, max) => Array.isArray(items) ? items.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim().slice(0, 300)).slice(0, max) : [];
      return { semantic_summary: typeof value.semantic_summary === 'string' ? value.semantic_summary.slice(0, 500) : '', important_concepts: strings(value.important_concepts, 8), entities: strings(value.entities, 8), alternative_phrasings: strings(value.alternative_phrasings, 5), search_terms: strings(value.search_terms, 10), synthetic_queries: strings(value.synthetic_queries, 6) };
    } catch (error) { lastError = error; } finally { clearTimeout(timer); }
  }
  throw lastError;
}

let completed = 0;
for (const record of records.slice(0, limit)) {
  if (existing[record.id]) { completed += 1; continue; }
  try { existing[record.id] = await profile(record); } catch (error) { console.error(`profile ${record.id} failed: ${error.message}`); }
  completed += 1;
  if (completed % 10 === 0 || completed === Math.min(limit, records.length)) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify({ datasetSignature, generatedAt: new Date().toISOString(), profiles: existing }, null, 2), 'utf8');
    console.log(`saved ${Object.keys(existing).length}/${Math.min(limit, records.length)} profiles`);
  }
}
