import { tokens, normalizeText } from './queryUnderstanding.js';
import { generateSearchVariants } from './variantGenerator.js';

function grams(text, size = 3) { const clean = normalizeText(text).replace(/\s/g, ''); const list = []; for (let i = 0; i <= clean.length - size; i += 1) list.push(clean.slice(i, i + size)); return list; }
function cosine(a, b) { let dot = 0; let aa = 0; let bb = 0; for (const [term, value] of a) { aa += value ** 2; dot += value * (b.get(term) || 0); } for (const value of b.values()) bb += value ** 2; return aa && bb ? dot / Math.sqrt(aa * bb) : 0; }
function dice(a, b) { const left = new Set(grams(a, 2)); const right = new Set(grams(b, 2)); let common = 0; for (const value of left) if (right.has(value)) common += 1; return left.size && right.size ? (2 * common) / (left.size + right.size) : 0; }

export class SemanticRetriever {
  constructor(domain, cachedVariants = {}) {
    this.domain = domain; this.docFrequency = new Map();
    this.searchUnits = domain.records.flatMap((record) => (cachedVariants[record.id] || generateSearchVariants(record)).map((variant, index) => ({ record, variant, variantIndex: index })));
    for (const unit of this.searchUnits) for (const term of new Set(tokens(`${unit.variant} ${unit.record.category}`))) this.docFrequency.set(term, (this.docFrequency.get(term) || 0) + 1);
    this.vectors = this.searchUnits.map((unit) => this.vector(`${unit.variant} ${unit.record.category}`));
  }
  text(record) { return `${record.question} ${record.category} ${record.dataset}`; }
  vector(text) { const values = tokens(text); const counts = new Map(); for (const term of values) counts.set(term, (counts.get(term) || 0) + 1); const n = this.searchUnits?.length || this.domain.records.length; return new Map([...counts].map(([term, count]) => [term, (count / Math.max(values.length, 1)) * (Math.log((n + 1) / ((this.docFrequency.get(term) || 0) + 1)) + 1)])); }
  retrieve(parsed, topK = 5) {
    const queryVector = this.vector(parsed.normalized_query); const queryTokens = new Set(tokens(parsed.normalized_query));
    const bestByRecord = new Map();
    this.searchUnits.forEach((unit, index) => {
      const normalized = normalizeText(`${unit.variant} ${unit.record.category}`);
      const semanticScore = cosine(queryVector, this.vectors[index]);
      const lexicalScore = [...queryTokens].filter((token) => token.length > 1 && normalized.includes(token)).length / Math.max(queryTokens.size, 1);
      const fuzzyScore = dice(parsed.normalized_query, unit.variant);
      const candidate = { ...unit.record, semanticScore, lexicalScore, fuzzyScore, matchedVariant: unit.variant, variantIndex: unit.variantIndex };
      const current = bestByRecord.get(unit.record.id);
      if (!current || semanticScore + lexicalScore + fuzzyScore > current.semanticScore + current.lexicalScore + current.fuzzyScore) bestByRecord.set(unit.record.id, candidate);
    });
    return [...bestByRecord.values()].sort((a, b) => (b.semanticScore + b.lexicalScore + b.fuzzyScore) - (a.semanticScore + a.lexicalScore + a.fuzzyScore)).slice(0, topK);
  }
}
