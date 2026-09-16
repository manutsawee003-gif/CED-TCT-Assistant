import { tokens, normalizeText } from './queryUnderstanding.js';
import { generateSearchVariants } from './variantGenerator.js';

function grams(text, size = 3) { const clean = normalizeText(text).replace(/\s/g, ''); const list = []; for (let i = 0; i <= clean.length - size; i += 1) list.push(clean.slice(i, i + size)); return list; }
function cosine(a, b) { let dot = 0; let aa = 0; let bb = 0; for (const [term, value] of a) { aa += value ** 2; dot += value * (b.get(term) || 0); } for (const value of b.values()) bb += value ** 2; return aa && bb ? dot / Math.sqrt(aa * bb) : 0; }
function dice(a, b) { const left = new Set(grams(a, 2)); const right = new Set(grams(b, 2)); let common = 0; for (const value of left) if (right.has(value)) common += 1; return left.size && right.size ? (2 * common) / (left.size + right.size) : 0; }

export class SemanticRetriever {
  constructor(domain, cachedVariants = {}) {
    this.domain = domain; this.docFrequency = new Map();
    // Keep the canonical Dataset question even if a cached search variant is overly compressed.
    this.searchUnits = domain.records.flatMap((record) => [...new Set([normalizeText(record.searchText || record.question), normalizeText(record.question), ...(cachedVariants[record.id] || generateSearchVariants(record))])].map((variant, index) => ({ record, variant, variantIndex: index })));
    for (const unit of this.searchUnits) for (const term of new Set(tokens(this.searchableText(unit)))) this.docFrequency.set(term, (this.docFrequency.get(term) || 0) + 1);
    this.vectors = this.searchUnits.map((unit) => this.vector(`${unit.variant} ${unit.record.searchText || ''} ${unit.record.question} ${unit.record.topic || ''} ${unit.record.intent || ''} ${unit.record.entities || ''}`));
    this.answerVectors = this.searchUnits.map((unit) => this.vector(this.searchableText(unit)));
  }
  searchableText(unit) { return `${unit.variant} ${unit.record.searchText || ''} ${unit.record.question} ${(unit.record.searchAliases || []).join(' ')} ${unit.record.topic || ''} ${unit.record.intent || ''} ${unit.record.entities || ''} ${unit.record.category} ${unit.record.dataset}`; }
  vector(text) { const values = tokens(text); const counts = new Map(); for (const term of values) counts.set(term, (counts.get(term) || 0) + 1); const n = this.searchUnits?.length || this.domain.records.length; return new Map([...counts].map(([term, count]) => [term, (count / Math.max(values.length, 1)) * (Math.log((n + 1) / ((this.docFrequency.get(term) || 0) + 1)) + 1)])); }
  retrieve(parsed, topK = 5) {
    const queries = parsed.expanded_queries?.length ? parsed.expanded_queries : [parsed.search_query || parsed.normalized_query];
    const queryFeatures = queries.map((query, index) => ({ query, vector: this.vector(query), tokens: new Set(tokens(query)), priority: index === 1 ? 1 : index === 0 ? 0.82 : 0.58 }));
    const bestByRecord = new Map();
    this.searchUnits.forEach((unit, index) => {
      const normalized = normalizeText(this.searchableText(unit));
      const scores = queryFeatures.map(({ query, vector, tokens: queryTokens, priority }) => { const semanticScore = cosine(vector, this.vectors[index]); const answerSemanticScore = cosine(vector, this.answerVectors[index]); const lexicalScore = [...queryTokens].filter((token) => token.length > 1 && normalized.includes(token)).length / Math.max(queryTokens.size, 1); const fuzzyScore = dice(query, unit.variant); return { query, semanticScore, answerSemanticScore, lexicalScore, fuzzyScore, priority, weightedEvidence: (semanticScore + lexicalScore + fuzzyScore + answerSemanticScore * 0.25) * priority }; });
      // The normalized query is the primary representation; broad expansion terms
      // may increase recall but cannot overpower it merely because they are generic.
      const bestQuery = scores.reduce((best, score) => score.weightedEvidence > best.weightedEvidence ? score : best);
      const expansionSupport = scores.filter((score) => score.semanticScore >= 0.16 || score.lexicalScore >= 0.25).length / scores.length;
      const candidate = { ...unit.record, ...bestQuery, expansionSupport, matchedVariant: unit.variant, variantIndex: unit.variantIndex };
      const current = bestByRecord.get(unit.record.id);
      if (!current || candidate.semanticScore + candidate.lexicalScore + candidate.fuzzyScore + candidate.answerSemanticScore * 0.25 > current.semanticScore + current.lexicalScore + current.fuzzyScore + current.answerSemanticScore * 0.25) bestByRecord.set(unit.record.id, candidate);
    });
    return [...bestByRecord.values()].sort((a, b) => (b.semanticScore + b.lexicalScore + b.fuzzyScore) - (a.semanticScore + a.lexicalScore + a.fuzzyScore)).slice(0, topK);
  }
}
