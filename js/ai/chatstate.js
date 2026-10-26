// Chat history and which task the bot is working on. Kept on this device, apart from the task data.
const KEY = 'vesper.chat';
const MAX = 60;

export function loadChat() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { msgs: Array.isArray(o.msgs) ? o.msgs : [], focus: o.focus || null };
  } catch (e) {
    return { msgs: [], focus: null };
  }
}

export function saveChat(chat) {
  const trimmed = { msgs: chat.msgs.slice(-MAX), focus: chat.focus };
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch (e) { /* storage full or blocked */ }
}

export function clearChat() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
