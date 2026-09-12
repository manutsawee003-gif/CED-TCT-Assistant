import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateSearchVariants } from './variantGenerator.js';

function signature(records) {
  return crypto.createHash('sha256').update(records.map((record) => `${record.id}|${record.question}|${record.category}`).join('\n')).digest('hex');
}

/** Search-only cache. It never writes to, or mutates, the supplied Excel workbook. */
export function loadOrBuildVariantCache(records, cacheFile) {
  const datasetSignature = signature(records);
  try {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (cached.datasetSignature === datasetSignature && cached.variants) return { variants: cached.variants, cacheStatus: 'loaded' };
  } catch { /* cache is optional and rebuilt when absent/stale */ }
  const variants = Object.fromEntries(records.map((record) => [record.id, generateSearchVariants(record)]));
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ datasetSignature, generatedAt: new Date().toISOString(), variants }, null, 2), 'utf8');
    return { variants, cacheStatus: 'built' };
  } catch {
    // Serverless filesystems can be read-only. Keep the cache in this warm instance instead.
    return { variants, cacheStatus: 'memory' };
  }
}
