import { answerChat, getChatRuntime } from '../server/chatRuntime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.length <= 100 ? req.body.sessionId : 'default';
  if (!message) return res.status(400).json({ error: 'message ต้องเป็นข้อความที่ไม่ว่าง' });
  try {
    const response = await answerChat(message, sessionId);
    if (process.env.DEBUG_CHAT === 'true') console.info(JSON.stringify({ query: message, result: response.matchedQuestion, confidence: response.confidence, debug: response.query }, null, 2));
    return res.status(200).json(response);
  } catch (error) {
    console.error('Chat API error', error);
    return res.status(500).json({ error: 'ไม่สามารถประมวลผล Dataset ได้ในขณะนี้' });
  }
}
