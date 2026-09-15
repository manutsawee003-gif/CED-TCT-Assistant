import { getChatRuntime } from '../server/chatRuntime.js';

const runtime = getChatRuntime();
await runtime.search.denseRetriever.initialize();
console.log(JSON.stringify({
  denseStatus: runtime.search.denseRetriever.status,
  error: runtime.search.denseRetriever.error || null,
  vectors: runtime.search.denseRetriever.vectors?.length || 0,
  dimension: runtime.search.denseRetriever.vectors?.[0]?.length || 0
}));
