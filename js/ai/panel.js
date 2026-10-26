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
import { extractJSON } from './client.js';
import { emptySteps, progress, nextQuestion, extractMessages, saveAnswer, intentOf } from './interview.js';

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
export function openChatPanel({ focusId = null, mode = null } = {}) {
  if (openPanel) return;
  const chat = loadChat();
  if (focusId && store.deck(focusId)) chat.focus = focusId;
  if (mode) chat.mode = mode;
  let ivUndo = null;      // { before, after } for the latest interview answer, this session only
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

  const ivDeck = () => (chat.iv.taskId && store.deck(chat.iv.taskId)) || null;
  const ivOn = () => chat.mode === 'iv' && chat.iv.active && ivDeck();

  const subline = () => {
    if (ivOn()) {
      const d = ivDeck(); const pr = progress(d);
      return `Interview · ${esc(d.title)} · ${pr.filled} of ${pr.total} filled`;
    }
    if (chat.mode === 'iv') return 'Pick a task and I will ask the questions';
    if (!aiReady()) return 'Set up AI to start';
    const d = focusDeck();
    if (!d) return 'Tell me what you are working on';
    const pj = store.project(d.projectId);
    return `Working on: ${esc(d.title)}${pj ? ` · ${esc(pj.name)}` : ''} · ${esc(slideName(SLIDES[d.slide]))}`;
  };

  const bubble = (m, i, list) => {
    if (m.r === 'u') return `<div class="msg u"><div class="bub">${fmt(m.t)}</div></div>`;
    const chg = (m.changes && m.changes.length)
      ? `<div class="chg"><ul>${m.changes.map((c) => `<li><a href="${esc(c.href)}" data-link>${esc(c.text)}</a></li>`).join('')}</ul>${
        chat.mode === 'chat' && i === list.length - 1 && undo ? '<button class="btn small" data-act="undo">Undo</button>' : ''}</div>`
      : '';
    const links = (m.links && m.links.length) ? `<div class="iv-links">${m.links.map((l) => `<a class="btn small" href="${esc(l.href)}" data-link>${esc(l.text)}</a>`).join('')}</div>` : '';
    const skip = (m.skipped && m.skipped.length) ? `<p class="chg-skip">Could not apply: ${m.skipped.map(esc).join(' ')}</p>` : '';
    return `<div class="msg b${m.err ? ' err' : ''}"><div class="bub">${fmt(m.t)}</div>${chg}${links}${skip}${m.err ? '<button class="btn small" data-act="retry">Try again</button>' : ''}</div>`;
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
    <div class="pn-tabs" role="tablist"><button type="button" role="tab" data-tab="chat">Chat</button><button type="button" role="tab" data-tab="iv">Interview</button></div>
    <div class="thread" id="thread" aria-live="polite"></div>
    <div class="iv-chips" id="chips" hidden></div>
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
  const cur = () => (chat.mode === 'iv' ? chat.iv.msgs : chat.msgs);

  function setupHtml() {
    const projects = store.projects();
    const pre = (ivDeck() || focusDeck());
    const preP = pre ? pre.projectId : (projects[0] && projects[0].id) || '__new';
    const projOpts = projects.map((pj) => `<option value="${esc(pj.id)}" ${pj.id === preP ? 'selected' : ''}>${esc(pj.name)}</option>`).join('')
      + `<option value="__new" ${preP === '__new' ? 'selected' : ''}>＋ New project</option>`;
    return `<div class="iv-setup">
      <h2>Interview me</h2>
      <p class="muted">Pick a task. I will ask one plain question at a time and fill in every step for you. Say "skip" to pass on a question, or "stop" to pause. Selah stays yours.</p>
      <label class="ai-f"><span>Project</span><select id="iv-proj">${projOpts}</select></label>
      <input id="iv-pname" class="iv-in" placeholder="Name the new project" maxlength="80" hidden>
      <label class="ai-f"><span>Task</span><select id="iv-task"></select></label>
      <input id="iv-tname" class="iv-in" placeholder="Name the new task" maxlength="80" hidden>
      <p class="sub" id="iv-prog"></p>
      <p class="ai-status" id="iv-err" data-kind="bad"></p>
      <button type="button" class="btn primary" data-act="iv-start" id="iv-start">Start interview</button>
      ${aiReady() ? '' : '<p class="sub">AI is not set up, so your answers are saved exactly as you write them. Add AI in settings to have them tidied into notes.</p>'}
    </div>`;
  }

  // Fill the task list for the chosen project and update the buttons and hints.
  function syncSetup() {
    const ps = dlg.querySelector('#iv-proj'); if (!ps) return;
    const ts = dlg.querySelector('#iv-task');
    const newProj = ps.value === '__new';
    dlg.querySelector('#iv-pname').hidden = !newProj;
    const decks = newProj ? [] : store.decksOf(ps.value).filter((d) => !d.finished);
    const keep = ts.value;
    const want = (ivDeck() && ivDeck().projectId === ps.value && ivDeck().id) || (focusDeck() && focusDeck().projectId === ps.value && focusDeck().id) || '';
    ts.innerHTML = decks.map((d) => { const pr = progress(d); return `<option value="${esc(d.id)}">${esc(d.title)} (${pr.filled}/${pr.total})</option>`; }).join('')
      + '<option value="__new">＋ New task</option>';
    ts.value = decks.find((d) => d.id === keep) ? keep : (decks.find((d) => d.id === want) ? want : (decks[0] ? decks[0].id : '__new'));
    const newTask = ts.value === '__new';
    dlg.querySelector('#iv-tname').hidden = !newTask;
    const d = newTask ? null : store.deck(ts.value);
    const pr = d ? progress(d) : null;
    dlg.querySelector('#iv-prog').textContent = pr ? `${pr.filled} of ${pr.total} steps filled. ${pr.filled ? 'I will only ask about the empty ones.' : 'I will start at Vision.'}` : '';
    dlg.querySelector('#iv-start').textContent = pr && pr.filled ? 'Continue interview' : 'Start interview';
  }

  function draw() {
    const ready = aiReady();
    const iv = chat.mode === 'iv';
    dlg.querySelectorAll('[data-tab]').forEach((t) => { t.setAttribute('aria-selected', String(t.dataset.tab === chat.mode)); });
    const live = iv ? !!ivOn() : ready;
    box.disabled = !live; sendBtn.disabled = !live && !busy;
    box.placeholder = iv ? (live ? 'Type your answer' : 'Start an interview first') : (ready ? 'Tell me what you are working on' : 'Set up AI to chat');
    dlg.querySelector('#composer').hidden = iv && !live;
    dlg.querySelector('#pn-sub').innerHTML = subline();
    if (iv && !live) {
      const last = chat.iv.msgs[chat.iv.msgs.length - 1];
      thread.innerHTML = (last && last.r === 'b' ? bubble(last, 0, [last]) : '') + setupHtml();
    }
    else thread.innerHTML = cur().length ? cur().map(bubble).join('') : emptyHtml();
    clearBtn.hidden = iv || !chat.msgs.length;
    const chips = dlg.querySelector('#chips');
    chips.hidden = !(iv && live);
    chips.innerHTML = (iv && live) ? `<button type="button" class="btn small" data-act="iv-skip">Skip this</button>${ivUndo ? '<button type="button" class="btn small" data-act="iv-undo">Undo last answer</button>' : ''}<button type="button" class="btn small" data-act="iv-stop">Stop</button>` : '';
    if (iv && !live) syncSetup();
    toBottom();
  }
  function typing(on) {
    const old = thread.querySelector('.typing');
    if (old) old.remove();
    if (on) { thread.insertAdjacentHTML('beforeend', '<div class="msg b typing"><div class="bub"><i></i><i></i><i></i></div></div>'); toBottom(); }
    sendBtn.textContent = on ? '■' : '↑';
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
    if (on) sendBtn.disabled = false;
  }

  function close() {
    if (busy) busy.abort();
    dlg.close();
    dlg.remove();
    openPanel = null;
    if (dirty && !leaving) rerender();
  }

  // ---- Interview ----------------------------------------------------------------------

  const pushBot = (m) => { chat.iv.msgs.push({ r: 'b', ...m }); };

  function startInterview() {
    const err = dlg.querySelector('#iv-err');
    const fail = (t) => { err.textContent = t; };
    let project;
    const ps = dlg.querySelector('#iv-proj').value;
    if (ps === '__new') {
      const name = dlg.querySelector('#iv-pname').value.trim();
      if (!name) return fail('Give the new project a name.');
      project = store.addProject(name);
    } else project = store.project(ps);
    let deck;
    const ts = dlg.querySelector('#iv-task').value;
    if (ts === '__new' || ps === '__new') {
      const name = dlg.querySelector('#iv-tname').value.trim();
      if (!name) { if (ps === '__new') store.removeProject(project.id); return fail('Give the new task a name.'); }
      deck = store.addDeck(project.id, name);
    } else deck = store.deck(ts);
    if (!deck) return fail('Pick a task.');
    if (chat.iv.taskId !== deck.id) { chat.iv.msgs = []; chat.iv.skipped = []; }
    chat.iv.taskId = deck.id; chat.focus = deck.id; ivUndo = null; dirty = true;
    const pr = progress(deck);
    const q = nextQuestion(deck, chat.iv.skipped, null);
    if (!q.target) {
      chat.iv.active = false;
      chat.iv.msgs.push({ r: 'b', t: `Every step of **${deck.title}** is already filled in.`, links: q.links });
      chat.mode = 'iv'; saveChat(chat); draw();
      return;
    }
    chat.iv.active = true;
    pushBot({ t: `Let us go through **${deck.title}**. ${pr.filled} of ${pr.total} steps are filled so far. Say "skip" to pass on a question, or "stop" to pause.\n\n${q.text}` });
    saveChat(chat); draw();
    box.focus();
  }

  function ivNext(prev, ack, changes) {
    const d = ivDeck();
    const q = nextQuestion(d, chat.iv.skipped, prev);
    if (!q.target) chat.iv.active = false;
    pushBot({ t: `${ack ? `${ack}\n\n` : ''}${q.text}`, changes, links: q.links });
  }

  function ivSkip() {
    const d = ivDeck(); if (!d || busy) return;
    const t = emptySteps(d, chat.iv.skipped)[0];
    if (!t) return;
    chat.iv.skipped.push(t.key); ivUndo = null;
    chat.iv.msgs.push({ r: 'u', t: 'Skip' });
    ivNext(null, '', []);
    saveChat(chat); draw();
  }

  function ivStop(why) {
    const d = ivDeck(); if (!d) return;
    if (busy) busy.abort();
    const pr = progress(d);
    chat.iv.active = false; ivUndo = null;
    chat.iv.msgs.push({ r: 'b', t: `${why || 'Paused.'} ${pr.filled} of ${pr.total} steps are filled in **${d.title}**. Come back anytime and I will continue with the empty ones.`, links: [{ text: 'Open the task map', href: `#/d/${d.id}` }] });
    saveChat(chat); draw();
  }

  async function ivSend(textIn) {
    if (busy) { busy.abort(); return; }
    const text = String(textIn || '').trim();
    const d = ivDeck();
    if (!text || !d || !chat.iv.active) return;
    const intent = intentOf(text);
    if (intent === 'skip') { box.value = ''; fit(); ivSkip(); return; }
    if (intent === 'stop') { box.value = ''; fit(); ivStop(); return; }
    const target = emptySteps(d, chat.iv.skipped)[0];
    if (!target) { ivStop('Everything is filled.'); return; }
    box.value = ''; fit();
    chat.iv.msgs.push({ r: 'u', t: text });
    draw(); typing(true);
    busy = new AbortController();
    const signal = busy.signal;
    let reply = null;
    if (aiReady()) {
      try { reply = extractJSON(await askChat(extractMessages(d, store.project(d.projectId), target, text, chat.iv.skipped), { signal, maxTokens: 1500 })); } catch (e) { reply = null; }
    }
    if (signal.aborted) {          // stopped while waiting: give the answer back to the person
      chat.iv.msgs.pop(); busy = null; typing(false); box.value = text; fit(); draw(); return;
    }
    const before = store.exportJSON();
    const res = saveAnswer(d, target, text, reply, chat.iv.skipped);
    ivUndo = { before, after: store.exportJSON() };
    dirty = true;
    const ack = res.ack || (res.fallback && aiReady() ? '(I could not tidy that up, so I saved it in your words.)' : '');
    ivNext(target, ack, res.changes);
    busy = null; saveChat(chat); typing(false); draw();
    if (chat.iv.active) box.focus();
  }

  function ivUndoLast() {
    if (!ivUndo || busy) return;
    if (store.exportJSON() !== ivUndo.after) { notice('Cannot undo safely', 'Something changed since then, so undoing could lose your edits. Change it by hand instead.'); return; }
    store.importJSON(ivUndo.before);
    const m = chat.iv.msgs;
    if (m.length && m[m.length - 1].r === 'b') m.pop();
    if (m.length && m[m.length - 1].r === 'u') m.pop();
    chat.iv.active = true; ivUndo = null; dirty = true;
    saveChat(chat); draw();
  }

  async function send(textIn) {
    if (chat.mode === 'iv') return ivSend(textIn);
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
    const tab = e.target.closest('[data-tab]');
    if (tab) { if (busy) return; chat.mode = tab.dataset.tab; saveChat(chat); draw(); return; }
    const say = e.target.closest('[data-say]');
    if (say) { send(say.dataset.say); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'close') close();
    else if (act === 'iv-start') startInterview();
    else if (act === 'iv-skip') ivSkip();
    else if (act === 'iv-stop') ivStop();
    else if (act === 'iv-undo') ivUndoLast();
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
  dlg.addEventListener('change', (e) => { if (e.target.id === 'iv-proj' || e.target.id === 'iv-task') syncSetup(); });
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
