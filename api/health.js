import { getChatRuntime } from '../server/chatRuntime.js';

export default function handler(_req, res) {
  const runtime = getChatRuntime();
  return res.status(200).json({ ok: true, records: runtime.records.length, sheet: runtime.sheetName, variantCache: runtime.search.variantCacheStatus });
}
