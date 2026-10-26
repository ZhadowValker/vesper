// Chat history and which task the bot is working on. Kept on this device, apart from the task data.
const KEY = 'vesper.chat';
const MAX = 60;

export function loadChat() {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || '{}');
    const iv = o.iv || {};
    return {
      msgs: Array.isArray(o.msgs) ? o.msgs : [],
      focus: o.focus || null,
      mode: o.mode === 'iv' ? 'iv' : 'chat',
      iv: { taskId: iv.taskId || null, active: !!iv.active, skipped: Array.isArray(iv.skipped) ? iv.skipped : [], msgs: Array.isArray(iv.msgs) ? iv.msgs : [] },
    };
  } catch (e) {
    return { msgs: [], focus: null, mode: 'chat', iv: { taskId: null, active: false, skipped: [], msgs: [] } };
  }
}

export function saveChat(chat) {
  const trimmed = { msgs: chat.msgs.slice(-MAX), focus: chat.focus, mode: chat.mode, iv: { ...chat.iv, msgs: chat.iv.msgs.slice(-MAX) } };
  try { localStorage.setItem(KEY, JSON.stringify(trimmed)); } catch (e) { /* storage full or blocked */ }
}

export function clearChat() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}
