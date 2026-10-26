// The assistant: a chat panel opened from the AI button. It structures what you say into
// projects, tasks and notes. Every turn that changes something can be undone. The settings
// icon inside the panel opens the address / key / model form.
import { store } from '../store.js';
import { SLIDES } from '../framework.js';
import { esc, confirmBox, notice } from '../util.js';
import { rerender } from '../nav.js';
import { slideName } from '../views/parts.js';
import { aiReady } from './settings.js';
import { askChat } from './client.js';
import { buildMessages, parseTurn, applyActions } from './agent.js';
import { loadChat, saveChat, clearChat } from './chatstate.js';
import { aiSettingsDialog } from './ui.js';

const SUGGEST = [
  'I want to start a new task',
  'Help me plan something I keep putting off',
  'What should I work on next?',
];

const GEAR = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
const CLOSE = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const fmt = (text) => esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');

let openPanel = null;

// focusId: the task to work on (when opened from a task or slide page).
export function openChatPanel({ focusId = null } = {}) {
  if (openPanel) return;
  const chat = loadChat();
  if (focusId && store.deck(focusId)) chat.focus = focusId;
  let undo = null;        // { before, after } for the latest bot turn, this session only
  let busy = null;        // AbortController while waiting for a reply
  let dirty = false;      // something changed behind the panel, so refresh the page on close
  let leaving = false;    // closing because a link was tapped (the page will render itself)

  const dlg = document.createElement('dialog');
  dlg.className = 'modal ai-panel';
  document.body.appendChild(dlg);
  openPanel = dlg;

  const focusDeck = () => {
    const own = chat.focus && store.deck(chat.focus);
    if (own) return own;
    const active = store.allDecks().filter((d) => !d.finished);
    return [...active].sort((a, b) => b.updated - a.updated)[0] || null;
  };

  const subline = () => {
    if (!aiReady()) return 'Set up AI to start';
    const d = focusDeck();
    if (!d) return 'Tell me what you are working on';
    const p = store.project(d.projectId);
    return `Working on: ${esc(d.title)}${p ? ` · ${esc(p.name)}` : ''} · ${esc(slideName(SLIDES[d.slide]))}`;
  };

  const bubble = (m, i) => {
    if (m.r === 'u') return `<div class="msg u"><div class="bub">${fmt(m.t)}</div></div>`;
    const chg = (m.changes && m.changes.length)
      ? `<div class="chg"><ul>${m.changes.map((c) => `<li><a href="${esc(c.href)}" data-link>${esc(c.text)}</a></li>`).join('')}</ul>${
        i === chat.msgs.length - 1 && undo ? '<button class="btn small" data-act="undo">Undo</button>' : ''}</div>`
      : '';
    const skip = (m.skipped && m.skipped.length) ? `<p class="chg-skip">Could not apply: ${m.skipped.map(esc).join(' ')}</p>` : '';
    return `<div class="msg b${m.err ? ' err' : ''}"><div class="bub">${fmt(m.t)}</div>${chg}${skip}${m.err ? '<button class="btn small" data-act="retry">Try again</button>' : ''}</div>`;
  };

  const emptyHtml = () => (aiReady()
    ? `<div class="chat-empty"><h2>What are you working on?</h2>
        <p class="muted">Tell me in your own words. I will set up the task and fill in the steps as we talk. You stay in charge of every Selah pause.</p>
        <div class="chips">${SUGGEST.map((s) => `<button class="btn small" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`
    : `<div class="chat-empty"><h2>Set up AI first</h2>
        <p class="muted">Tap the settings icon above and add an address, a key and a model. They stay on this device.</p>
        <div class="chips"><button class="btn primary" data-act="settings">Open settings</button></div></div>`);

  dlg.innerHTML = `
    <div class="pn-head">
      <div class="pn-t"><h2>Assistant</h2><p id="pn-sub"></p></div>
      <button type="button" class="icon-btn" data-act="settings" aria-label="AI settings">${GEAR}</button>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">${CLOSE}</button>
    </div>
    <div class="thread" id="thread" aria-live="polite"></div>
    <form class="composer" id="composer">
      <textarea id="say" rows="1" aria-label="Message"></textarea>
      <button type="submit" class="send" id="send" aria-label="Send">↑</button>
    </form>
    <button type="button" class="chat-clear" data-act="clear" hidden>Clear chat</button>`;

  const thread = dlg.querySelector('#thread');
  const box = dlg.querySelector('#say');
  const sendBtn = dlg.querySelector('#send');
  const clearBtn = dlg.querySelector('.chat-clear');

  function fit() { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; }
  function toBottom() { thread.scrollTop = thread.scrollHeight; }
  function draw() {
    const ready = aiReady();
    box.disabled = !ready; sendBtn.disabled = !ready && !busy;
    box.placeholder = ready ? 'Tell me what you are working on' : 'Set up AI to chat';
    dlg.querySelector('#pn-sub').innerHTML = subline();
    thread.innerHTML = chat.msgs.length ? chat.msgs.map(bubble).join('') : emptyHtml();
    clearBtn.hidden = !chat.msgs.length;
    toBottom();
  }
  function typing(on) {
    const old = thread.querySelector('.typing');
    if (old) old.remove();
    if (on) { thread.insertAdjacentHTML('beforeend', '<div class="msg b typing"><div class="bub"><i></i><i></i><i></i></div></div>'); toBottom(); }
    sendBtn.textContent = on ? '■' : '↑';
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
    sendBtn.disabled = !on && !aiReady();
  }

  function close() {
    if (busy) busy.abort();
    dlg.close();
    dlg.remove();
    openPanel = null;
    if (dirty && !leaving) rerender();
  }

  async function send(textIn) {
    if (busy) { busy.abort(); return; }
    const text = String(textIn || '').trim();
    if (!text || !aiReady()) return;
    box.value = ''; fit();
    chat.msgs = chat.msgs.filter((m) => !m.err);
    chat.msgs.push({ r: 'u', t: text });
    undo = null;
    draw(); typing(true);
    busy = new AbortController();
    const signal = busy.signal;
    try {
      const fd = focusDeck();
      const raw = await askChat(buildMessages(chat.msgs.slice(0, -1), text, fd && fd.id), { signal });
      const turn = parseTurn(raw);
      const before = store.exportJSON();
      const out = applyActions(turn.actions, { focusId: fd && fd.id });
      if (out.focus) chat.focus = out.focus;
      if (out.changes.length) { undo = { before, after: store.exportJSON() }; dirty = true; }
      chat.msgs.push({ r: 'b', t: turn.reply, raw: turn.raw, changes: out.changes, skipped: out.skipped });
    } catch (e) {
      chat.msgs.push({ r: 'b', t: signal.aborted ? 'Stopped.' : ((e && e.message) || 'Something went wrong.'), err: !signal.aborted });
    } finally {
      busy = null;
      saveChat(chat);
      typing(false);
      if (dlg.isConnected) draw();
    }
  }

  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', async (e) => {
    if (e.target === dlg) { close(); return; }
    if (e.target.closest('[data-link]')) { leaving = true; close(); return; }   // let the link navigate
    const say = e.target.closest('[data-say]');
    if (say) { send(say.dataset.say); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') close();
    else if (act === 'settings') aiSettingsDialog({ onSaved: () => { dirty = true; draw(); } });
    else if (act === 'retry') {
      const last = [...chat.msgs].reverse().find((m) => m.r === 'u');
      chat.msgs = chat.msgs.filter((m) => !m.err && m !== last);
      if (last) send(last.t);
    } else if (act === 'undo') {
      if (!undo) return;
      if (store.exportJSON() !== undo.after) {
        notice('Cannot undo safely', 'Something changed since then, so undoing could lose your edits. Change it by hand instead.');
        return;
      }
      store.importJSON(undo.before);
      const last = chat.msgs[chat.msgs.length - 1];
      last.changes = []; last.t = `${last.t}\n\n(Undone.)`;
      undo = null; dirty = true;
      saveChat(chat);
      draw();
    } else if (act === 'clear') {
      if (await confirmBox('Clear the chat?', 'Only the conversation is removed. Your projects and tasks stay.', { ok: 'Clear', danger: false })) {
        chat.msgs = []; undo = null; clearChat(); draw();
      }
    }
  });
  dlg.querySelector('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(box.value); });
  box.addEventListener('input', fit);
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(min-width: 700px)').matches) {
      e.preventDefault(); send(box.value);
    }
  });

  draw();
  dlg.showModal();
  if (aiReady()) box.focus();
}
