// The only file that talks to the network. Any OpenAI-style chat endpoint works
// (NVIDIA, OpenRouter, a Worker proxy, local Ollama).
import { getAI } from './settings.js';

export class AIError extends Error {
  constructor(message, kind) { super(message); this.kind = kind; }
}

// Drop any visible reasoning some models write before the answer.
export function cleanReply(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

// Pull the first JSON object out of a reply, even if it is wrapped in text or code fences.
export function extractJSON(text) {
  const t = cleanReply(text);
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw new AIError('The reply was not in the expected format.', 'format');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) {
    throw new AIError('The reply was not in the expected format.', 'format');
  }
}

async function chatOnce(messages, model, { signal, maxTokens = 2048 } = {}) {
  const s = getAI();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 60000);
  if (signal) signal.addEventListener('abort', () => ctl.abort());
  let res;
  try {
    res = await fetch(`${s.url}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.key}` },
      body: JSON.stringify({ model, messages, temperature: 0.4, max_tokens: maxTokens, stream: false }),
      signal: ctl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new AIError(signal && signal.aborted ? 'Cancelled.' : 'The request took too long.', 'timeout');
    throw new AIError('The browser could not reach the AI address. Either you are offline, or this service does not allow calls from a web page (a proxy or OpenRouter will fix that).', 'network');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) throw new AIError('The key was not accepted. Check it in AI settings.', 'auth');
  if (res.status === 404) throw new AIError(`The model "${model}" was not found. Check the name in AI settings.`, 'model');
  if (res.status === 429) throw new AIError('Too many requests right now. Try again in a minute.', 'rate');
  if (!res.ok) throw new AIError(`The AI service returned an error (${res.status}).`, 'server');
  let data;
  try { data = await res.json(); } catch (e) { throw new AIError('The AI service sent an unreadable reply.', 'format'); }
  const msg = data && data.choices && data.choices[0] && data.choices[0].message;
  const text = cleanReply(msg && msg.content);
  if (!text) throw new AIError('The model sent an empty reply. Try again, or pick another model.', 'format');
  return text;
}

export const chat = chatOnce;

// Ask for JSON. Try the slot's model first, then the backup if the first one fails.
export async function askJSON(messages, slot = 'draft', { signal } = {}) {
  const s = getAI();
  const models = [s[slot] || s.draft];
  if (s.backup && !models.includes(s.backup)) models.push(s.backup);
  let lastErr;
  for (const model of models) {
    try {
      return extractJSON(await chatOnce(messages, model, { signal }));
    } catch (e) {
      lastErr = e;
      if (e.kind === 'auth' || (signal && signal.aborted)) break;
    }
  }
  throw lastErr;
}
