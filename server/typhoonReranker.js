const API_URL = 'https://api.opentyphoon.ai/v1/chat/completions';
const SYSTEM_PROMPT = `You are a dataset-candidate reranking component, not a knowledge answering component.
Rank only the supplied candidate IDs by how directly their Dataset question and answer context address the user's intent. Do not use outside knowledge, alter candidate data, create a new candidate, or write an answer. Respect explicit entities and constraints. When the parsed answer scope is multi, select only IDs needed to cover separate requested aspects. Return JSON only: {"ranking":[{"candidate_id":"id","relevance":0.0,"reason":"short relevance reason"}],"best_candidate_id":"id or null","selected_candidate_ids":["id"],"confidence":0.0,"needs_clarification":false}.`;

function parse(content, candidateIds) {
  const raw = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value = JSON.parse(raw); const allowed = new Set(candidateIds);
  const ranking = Array.isArray(value.ranking) ? value.ranking.filter((item) => item && allowed.has(String(item.candidate_id)) && Number.isFinite(Number(item.relevance))).map((item) => ({ candidate_id: String(item.candidate_id), relevance: Math.max(0, Math.min(1, Number(item.relevance))), reason: typeof item.reason === 'string' ? item.reason.slice(0, 180) : '' })).sort((a, b) => b.relevance - a.relevance) : [];
  if (!ranking.length) throw new Error('Typhoon returned no valid candidate rankings');
  const selected_candidate_ids = Array.isArray(value.selected_candidate_ids) ? [...new Set(value.selected_candidate_ids.map(String).filter((id) => allowed.has(id)))].slice(0, 3) : [];
  return { available: true, ranking, best_candidate_id: allowed.has(String(value.best_candidate_id)) ? String(value.best_candidate_id) : ranking[0].candidate_id, selected_candidate_ids, confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)), needs_clarification: value.needs_clarification === true };
}

/** Reranks existing Dataset records only; it never receives or produces an answer. */
export async function rerankWithTyphoon({ question, conversationContext, parsed, candidates }) {
  const apiKey = process.env.TYPHOON_API_KEY || process.env.OPENTYPHOON_API_KEY;
  if (!apiKey || candidates.length < 2) return { available: false, reason: !apiKey ? 'not_configured' : 'insufficient_candidates' };
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(process.env.TYPHOON_TIMEOUT_MS || 7000)));
  try {
    const candidateIds = candidates.map((item) => item.id);
    const body = { question, conversation_context: conversationContext, parsed_query: { intent: parsed.intent, entities: parsed.entities, constraints: parsed.constraints, answer_scope: parsed.answer_scope, normalized_query: parsed.normalized_query }, candidates: candidates.map(({ id, question: candidateQuestion, answer, category, dataset }) => ({ id, question: candidateQuestion, answer, category, dataset })) };
    const response = await fetch(API_URL, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.TYPHOON_MODEL || 'typhoon-v2.5-30b-a3b-instruct', temperature: 0, max_tokens: 500, stream: false, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(body) }] }) });
    if (!response.ok) throw new Error(`Typhoon HTTP ${response.status}`);
    const result = await response.json(); return parse(result?.choices?.[0]?.message?.content, candidateIds);
  } catch (error) { return { available: false, reason: error.name === 'AbortError' ? 'timeout' : 'request_failed', error: error.message }; } finally { clearTimeout(timer); }
}
