import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODEL = process.env.DENSE_MODEL || 'Xenova/multilingual-e5-small';
const BATCH_SIZE = Math.max(1, Number(process.env.DENSE_BATCH_SIZE || 16));

function signature(records, variants) {
  return crypto.createHash('sha256').update(records.map((record) => `${record.id}|${record.question}|${record.answer}|${(variants[record.id] || []).join('|')}`).join('\n')).digest('hex');
}
function dot(left, right) { return left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0); }
function normalizeQuery(query) { return `query: ${query}`; }
function normalizePassage(record, variants) { return `passage: Dataset: ${record.dataset}. Category: ${record.category}. Question: ${record.question}. Answer: ${record.answer}. Search aliases: ${(variants[record.id] || []).slice(0, 8).join(' | ')}`; }

/** Local multilingual dense retrieval. If the model or its cache is unavailable,
 * callers receive a safe disabled result and the BM25/fuzzy pipeline continues. */
export class DenseRetriever {
  constructor(domain, variants = {}) {
    this.domain = domain; this.variants = variants; this.status = 'not_initialized'; this.initialization = null;
    this.cacheFile = path.join(root, 'cache', 'denseEmbeddings.json');
    this.datasetSignature = signature(domain.records, variants);
  }
  async initialize() {
    if (this.initialization) return this.initialization;
    this.initialization = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        env.cacheDir = path.join(root, 'cache', 'hf');
        env.allowLocalModels = true;
        const cached = (() => { try { return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')); } catch { return null; } })();
        this.extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
        if (cached?.datasetSignature === this.datasetSignature && cached.model === MODEL && Array.isArray(cached.vectors) && cached.vectors.length === this.domain.records.length) {
          this.vectors = cached.vectors; this.status = 'ready_cached'; return;
        }
        const vectors = [];
        for (let start = 0; start < this.domain.records.length; start += BATCH_SIZE) {
          const passages = this.domain.records.slice(start, start + BATCH_SIZE).map((record) => normalizePassage(record, this.variants));
          const output = await this.extractor(passages, { pooling: 'mean', normalize: true });
          const data = Array.from(output.data); const dimension = output.dims.at(-1);
          for (let index = 0; index < passages.length; index += 1) vectors.push(data.slice(index * dimension, (index + 1) * dimension));
        }
        this.vectors = vectors; this.status = 'ready_built';
        try { fs.mkdirSync(path.dirname(this.cacheFile), { recursive: true }); fs.writeFileSync(this.cacheFile, JSON.stringify({ model: MODEL, datasetSignature: this.datasetSignature, vectors }), 'utf8'); } catch { /* memory cache remains valid */ }
      } catch (error) { this.status = 'unavailable'; this.error = error.message; }
    })();
    return this.initialization;
  }
  async retrieve(parsed, topK = 30) {
    await this.initialize();
    if (!this.vectors?.length) return { available: false, reason: this.status, error: this.error, results: [] };
    try {
      const queries = [...new Set((parsed.expanded_queries || [parsed.normalized_query]).filter(Boolean))].slice(0, 5);
      const output = await this.extractor(queries.map(normalizeQuery), { pooling: 'mean', normalize: true });
      const dimension = output.dims.at(-1); const data = Array.from(output.data);
      const queryVectors = queries.map((query, index) => ({ query, vector: data.slice(index * dimension, (index + 1) * dimension), priority: index === 0 ? 1 : 0.82 }));
      const results = this.domain.records.map((record, index) => {
        const best = queryVectors.reduce((current, query) => {
          const score = dot(query.vector, this.vectors[index]) * query.priority;
          return score > current.score ? { query: query.query, score } : current;
        }, { query: '', score: -1 });
        return { ...record, denseScore: Number(best.score.toFixed(6)), denseMatchedQuery: best.query };
      }).sort((left, right) => right.denseScore - left.denseScore).slice(0, topK);
      return { available: true, status: this.status, results };
    } catch (error) { return { available: false, reason: 'query_failed', error: error.message, results: [] }; }
  }
}
