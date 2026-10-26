// The home screen: a chat with the assistant. It structures what you say into projects,
// tasks and notes, and every change it makes can be undone.
import { store } from '../store.js';
import { SLIDES } from '../framework.js';
import { esc, confirmBox, notice, ask } from '../util.js';
import { go } from '../nav.js';
import { stageBar, slideName } from './parts.js';
import { aiReady } from '../ai/settings.js';
import { askChat } from '../ai/client.js';
import { buildMessages, parseTurn, applyActions } from '../ai/agent.js';
import { loadChat, saveChat, clearChat } from '../ai/chatstate.js';
import { aiSettingsDialog } from '../ai/ui.js';
import { showGuide, guideSeen } from '../guide.js';
import { buildSample } from '../sample.js';

const SUGGEST = [
  'I want to start a new task',
  'Help me plan something I keep putting off',
  'What should I work on next?',
];

function fmt(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
}

function focusDeck(chat) {
  const own = chat.focus && store.deck(chat.focus);
  if (own) return own;
  const active = store.allDecks().filter((d) => !d.finished);
  return [...active].sort((a, b) => b.updated - a.updated)[0] || null;
}

function strip(chat) {
  const d = focusDeck(chat);
  if (!d) return '';
  const p = store.project(d.projectId);
  const verb = d.finished ? 'Recap' : d.reached === 0 ? 'Begin' : 'Resume';
  return `<a class="chat-strip s-${SLIDES[d.slide].stage ? SLIDES[d.slide].stage.id : ''}" href="#/d/${d.id}">
    <span class="cs-t"><strong>${esc(d.title)}</strong><span>${esc(p ? p.name : '')} · ${esc(slideName(SLIDES[d.slide]))}</span></span>
    <span class="cs-go">${verb} ›</span>${stageBar(d.slide)}</a>`;
}

export function chatView() {
  const chat = loadChat();
  const ready = aiReady();
  let undo = null;       // { before, after } for the latest bot turn, this session only
  let busy = null;       // AbortController while waiting

  const bubble = (m, i) => {
    if (m.r === 'u') return `<div class="msg u"><div class="bub">${fmt(m.t)}</div></div>`;
    const chg = (m.changes && m.changes.length)
      ? `<div class="chg"><ul>${m.changes.map((c) => `<li><a href="${esc(c.href)}">${esc(c.text)}</a></li>`).join('')}</ul>${
        i === chat.msgs.length - 1 && undo ? '<button class="btn small" data-act="undo">Undo</button>' : ''}</div>`
      : '';
    const skip = (m.skipped && m.skipped.length) ? `<p class="chg-skip">Could not apply: ${m.skipped.map(esc).join(' ')}</p>` : '';
    return `<div class="msg b${m.err ? ' err' : ''}"><div class="bub">${fmt(m.t)}</div>${chg}${skip}${m.err ? '<button class="btn small" data-act="retry">Try again</button>' : ''}</div>`;
  };

  const empty = ready
    ? `<div class="chat-empty"><h2>What are you working on?</h2>
        <p class="muted">Tell me in your own words. I will set up the task and fill in the steps as we talk. You stay in charge of every Selah pause.</p>
        <div class="chips">${SUGGEST.map((s) => `<button class="btn small" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`
    : `<div class="chat-empty"><h2>Chat needs an AI key</h2>
        <p class="muted">Add an address, a key and a model once. They stay on this device. Until then you can use Vesper by hand from the overview.</p>
        <div class="chips"><button class="btn primary" data-act="ai">Set up AI</button><button class="btn" data-act="overview">Open overview</button></div></div>`;

  const html = `<div class="chat-page">
    <div class="top">
      <div class="grow"><h1>Vesper</h1></div>
      <a class="btn small" href="#/overview">Overview</a>
      <button class="icon-btn ai-set" data-act="ai" aria-label="AI settings">AI</button>
      <button class="icon-btn" data-act="guide" aria-label="How to use Vesper">?</button>
    </div>
    <div id="strip">${strip(chat)}</div>
    <div class="thread" id="thread" aria-live="polite">${chat.msgs.length ? chat.msgs.map(bubble).join('') : empty}</div>
    <form class="composer" id="composer">
      <textarea id="say" rows="1" placeholder="${ready ? 'Tell me what you are working on' : 'Set up AI to chat'}" ${ready ? '' : 'disabled'} aria-label="Message"></textarea>
      <button type="submit" class="send" id="send" aria-label="Send" ${ready ? '' : 'disabled'}>↑</button>
    </form>
    ${chat.msgs.length ? '<button class="chat-clear" data-act="clear">Clear chat</button>' : ''}
  </div>`;

  function mount(root) {
    const thread = root.querySelector('#thread');
    const box = root.querySelector('#say');
    const sendBtn = root.querySelector('#send');
    root.addEventListener('click', onClick);
    root.querySelector('#composer').addEventListener('submit', (e) => { e.preventDefault(); send(box.value); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.matchMedia('(min-width: 700px)').matches) {
        e.preventDefault(); send(box.value);
      }
    });
    box.addEventListener('input', fit);
    if (!guideSeen()) showGuide().then((r) => { if (r === 'sample') { openSample(); } });
    toBottom();

    function fit() { box.style.height = 'auto'; box.style.height = `${Math.min(box.scrollHeight, 140)}px`; }
    function toBottom() { thread.scrollTop = thread.scrollHeight; }
    function draw() {
      thread.innerHTML = chat.msgs.length ? chat.msgs.map(bubble).join('') : empty;
      root.querySelector('#strip').innerHTML = strip(chat);
      const c = root.querySelector('.chat-clear');
      if (chat.msgs.length && !c) root.querySelector('.chat-page').insertAdjacentHTML('beforeend', '<button class="chat-clear" data-act="clear">Clear chat</button>');
      if (!chat.msgs.length && c) c.remove();
      toBottom();
    }
    function typing(on) {
      const old = thread.querySelector('.typing');
      if (old) old.remove();
      if (on) { thread.insertAdjacentHTML('beforeend', '<div class="msg b typing"><div class="bub"><i></i><i></i><i></i></div></div>'); toBottom(); }
      sendBtn.textContent = on ? '■' : '↑';
      sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
    }
    function openSample() {
      const have = store.findSample('book');
      go(`#/p/${(have || store.insertSample(buildSample())).id}`);
    }

    async function send(textIn) {
      if (busy) { busy.abort(); return; }
      const text = String(textIn || '').trim();
      if (!text || !ready) return;
      box.value = ''; fit();
      chat.msgs = chat.msgs.filter((m) => !m.err);
      chat.msgs.push({ r: 'u', t: text });
      undo = null;
      draw(); typing(true);
      busy = new AbortController();
      const history = chat.msgs.slice(0, -1);
      try {
        const raw = await askChat(buildMessages(history, text, focusDeck(chat) && focusDeck(chat).id), { signal: busy.signal });
        const turn = parseTurn(raw);
        const before = store.exportJSON();
        const out = applyActions(turn.actions, { focusId: focusDeck(chat) && focusDeck(chat).id });
        if (out.focus) chat.focus = out.focus;
        const changed = out.changes.length > 0;
        undo = changed ? { before, after: store.exportJSON() } : null;
        chat.msgs.push({ r: 'b', t: turn.reply, raw: turn.raw, changes: out.changes, skipped: out.skipped });
      } catch (e) {
        const msg = (e && e.message) || 'Something went wrong.';
        chat.msgs.push({ r: 'b', t: e && e.kind === 'timeout' && busy.signal.aborted ? 'Stopped.' : msg, err: !(busy.signal.aborted), lastUser: text });
      } finally {
        busy = null;
        saveChat(chat);
        typing(false);
        draw();
      }
    }

    async function onClick(e) {
      const say = e.target.closest('[data-say]');
      if (say) { send(say.dataset.say); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'ai') aiSettingsDialog();
      else if (act === 'overview') go('#/overview');
      else if (act === 'guide') showGuide().then((r) => { if (r === 'sample') openSample(); });
      else if (act === 'retry') {
        const last = [...chat.msgs].reverse().find((m) => m.r === 'u');
        chat.msgs = chat.msgs.filter((m) => !m.err);
        if (last) { chat.msgs = chat.msgs.filter((m) => m !== last); send(last.t); }
      } else if (act === 'undo') {
        if (!undo) return;
        if (store.exportJSON() !== undo.after) {
          notice('Cannot undo safely', 'Something changed since then, so undoing could lose your edits. Change it by hand instead.');
          return;
        }
        store.importJSON(undo.before);
        const last = chat.msgs[chat.msgs.length - 1];
        last.changes = []; last.t = `${last.t}\n\n(Undone.)`;
        undo = null;
        saveChat(chat);
        draw();
      } else if (act === 'clear') {
        if (await confirmBox('Clear the chat?', 'Only the conversation is removed. Your projects and tasks stay.', { ok: 'Clear', danger: false })) {
          chat.msgs = []; undo = null; clearChat(); draw();
        }
      }
    }

    return () => { root.removeEventListener('click', onClick); if (busy) busy.abort(); };
  }

  return { html, mount };
}
