import { normalizeText, tokens } from './queryUnderstanding.js';

/**
 * Dataset-local BM25.  It deliberately indexes original Dataset fields, plus
 * search-only aliases; the answer returned to a user is never taken from an
 * alias or generated metadata.
 */
export class Bm25Retriever {
  constructor(domain, cachedVariants = {}) {
    this.k1 = Number(process.env.BM25_K1 || 1.2);
    this.b = Number(process.env.BM25_B || 0.75);
    this.documents = domain.records.map((record) => {
      const variants = cachedVariants[record.id] || [];
      // Search_Text is primary when present. Question is repeated for a modest
      // field weight; aliases/topic/intent/entities provide recall, never facts.
      const text = `${record.searchText || ''} ${record.question} ${record.question} ${(record.searchAliases || []).join(' ')} ${record.topic || ''} ${record.intent || ''} ${record.entities || ''} ${record.category} ${record.dataset} ${variants.join(' ')}`;
      const terms = tokens(text);
      const frequencies = new Map();
      for (const term of terms) frequencies.set(term, (frequencies.get(term) || 0) + 1);
      return { record, frequencies, length: terms.length };
    });
    this.averageLength = this.documents.reduce((sum, document) => sum + document.length, 0) / Math.max(this.documents.length, 1);
    this.documentFrequency = new Map();
    for (const document of this.documents) for (const term of document.frequencies.keys()) this.documentFrequency.set(term, (this.documentFrequency.get(term) || 0) + 1);
  }

  score(document, query) {
    const queryTerms = [...new Set(tokens(query))];
    const total = this.documents.length;
    return queryTerms.reduce((score, term) => {
      const frequency = document.frequencies.get(term) || 0;
      if (!frequency) return score;
      const docsWithTerm = this.documentFrequency.get(term) || 0;
      const idf = Math.log(1 + (total - docsWithTerm + 0.5) / (docsWithTerm + 0.5));
      const denominator = frequency + this.k1 * (1 - this.b + this.b * (document.length / Math.max(this.averageLength, 1)));
      return score + idf * (frequency * (this.k1 + 1)) / denominator;
    }, 0);
  }

  retrieve(parsed, topK = 30) {
    const queries = parsed.expanded_queries?.length ? parsed.expanded_queries : [parsed.normalized_query];
    return this.documents.map((document) => {
      const scores = queries.map((query, index) => ({ query: normalizeText(query), score: this.score(document, query), priority: index === 0 ? 1 : index < 4 ? 0.82 : 0.62 }));
      const best = scores.reduce((current, item) => item.score * item.priority > current.score * current.priority ? item : current, scores[0] || { score: 0, query: '' });
      return { ...document.record, bm25Score: Number(best.score.toFixed(6)), bm25MatchedQuery: best.query };
    }).sort((left, right) => right.bm25Score - left.bm25Score).slice(0, topK);
  }
}
