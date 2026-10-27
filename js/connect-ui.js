// Dialogs for the hub (sync), exporting a task or project, and adding to a calendar.
import { store } from './store.js';
import { esc } from './util.js';
import { rerender } from './nav.js';
import { getSync, saveSync, syncReady, syncNow, syncStatus, hubCall } from './sync.js';
import { taskMarkdown, projectMarkdown, googleCalendarLink, icsFile, calendarSuggestion } from './export.js';

function open(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal ai-modal';
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  const close = () => { if (!dlg.open) return; dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) close(); });
  dlg.showModal();
  return { dlg, close };
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vesper';

export function when(st) {
  if (st.state === 'off') return 'Not connected';
  if (st.state === 'syncing') return 'Syncing...';
  if (st.state === 'error') return st.error || 'Could not sync';
  if (st.state === 'later') return 'Waiting until you stop typing';
  if (!st.at) return 'Connected';
  return 'Synced ' + new Date(st.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function syncDialog({ onChange } = {}) {
  const cfg = getSync();
  const { dlg, close } = open(`<form>
    <h2>Sync and Claude connector</h2>
    <p class="ai-note muted">Your own free Vesper hub keeps every device the same, and lets Claude read and fill your tasks. Setup steps are in worker/README.md.</p>
    <label class="ai-f">Hub address<input name="url" type="url" inputmode="url" placeholder="https://vesper-hub.you.workers.dev" value="${esc(cfg.url)}" autocomplete="off"></label>
    <label class="ai-f">Token<input name="token" type="password" placeholder="The APP_TOKEN you set on the hub" value="${esc(cfg.token)}" autocomplete="off"></label>
    <p class="ai-status" data-kind="${syncStatus().state === 'error' ? 'bad' : ''}" role="status">${esc(when(syncStatus()))}</p>
    <div class="modal-actions ai-actions">
      <button type="button" class="btn ghost" data-close>Close</button>
      ${syncReady() ? '<button type="button" class="btn ghost" data-act="off">Turn off</button>' : ''}
      <button type="submit" class="btn">Save and sync</button>
    </div>
  </form>`);
  const form = dlg.querySelector('form');
  const status = dlg.querySelector('.ai-status');
  dlg.querySelector('[data-act="off"]')?.addEventListener('click', () => { saveSync(null); close(); if (onChange) onChange(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = form.url.value.trim(), token = form.token.value.trim();
    if (!/^https:\/\//i.test(url) || !token) { status.dataset.kind = 'bad'; status.textContent = 'Enter the https address and the token.'; return; }
    saveSync({ url, token });
    status.dataset.kind = ''; status.textContent = 'Syncing...';
    const st = await syncNow({ force: true });
    if (st.state === 'ok') { close(); rerender(); if (onChange) onChange(); }
    else { status.dataset.kind = 'bad'; status.textContent = when(st); }
  });
}

export function exportDialog({ deck, project, decks }) {
  const title = deck ? deck.title : project.name;
  const md = deck ? taskMarkdown(deck, project ? project.name : '') : projectMarkdown(project, decks);
  const { dlg } = open(`<form>
    <h2>Send "${esc(title)}" elsewhere</h2>
    <p class="ai-note muted">Markdown pastes cleanly into Notion, Google Docs, GitHub and email.</p>
    <textarea readonly rows="8" class="ai-export" aria-label="Markdown">${esc(md)}</textarea>
    <p class="ai-status" role="status"></p>
    <div class="modal-actions ai-actions">
      <button type="button" class="btn ghost" data-close>Close</button>
      <button type="button" class="btn ghost" data-act="file">Download .md</button>
      ${navigator.share ? '<button type="button" class="btn ghost" data-act="share">Share</button>' : ''}
      <button type="button" class="btn" data-act="copy">Copy</button>
    </div>
  </form>`);
  const status = dlg.querySelector('.ai-status');
  dlg.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'file') download(`${slug(title)}.md`, md, 'text/markdown');
    else if (act === 'share') { try { await navigator.share({ title, text: md }); } catch (err) { /* cancelled */ } }
    else if (act === 'copy') {
      try { await navigator.clipboard.writeText(md); status.textContent = 'Copied.'; }
      catch (err) { const ta = dlg.querySelector('textarea'); ta.select(); status.textContent = 'Press copy on your keyboard to finish.'; }
    }
  });
}

const localValue = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const localStamp = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

export function calendarDialog(deck) {
  const sug = calendarSuggestion(deck);
  const next = new Date(); next.setDate(next.getDate() + 1); next.setHours(9, 0, 0, 0);
  const hub = syncReady();
  const { dlg } = open(`<form>
    <h2>Add to calendar</h2>
    <label class="ai-f">What<input name="title" value="${esc(sug.title)}"></label>
    <label class="ai-f">When<input name="when" type="datetime-local" value="${localValue(next)}"></label>
    <label class="ai-f">Minutes<input name="mins" type="number" min="5" max="480" step="5" value="30"></label>
    <label class="ai-f" data-cal hidden>Calendar<select name="cal"></select></label>
    <p class="ai-status" role="status">${hub ? 'Checking Google Calendar...' : 'Turn on Sync to let Vesper add events for you. Until then use the buttons below.'}</p>
    <div class="modal-actions ai-actions">
      <button type="button" class="btn ghost" data-close>Close</button>
      <button type="button" class="btn ghost" data-act="ics">Download .ics</button>
      <button type="button" class="btn ghost" data-act="google">Open in Google</button>
      <button type="button" class="btn" data-act="auto" hidden>Add to Google Calendar</button>
      <button type="button" class="btn" data-act="connect" hidden>Connect Google</button>
    </div>
  </form>`);
  const form = dlg.querySelector('form');
  const status = dlg.querySelector('.ai-status');
  const btn = (a) => dlg.querySelector(`[data-act="${a}"]`);
  const read = () => ({ title: form.title.value.trim() || sug.title, details: sug.details, start: new Date(form.when.value || next), minutes: Math.max(5, parseInt(form.mins.value, 10) || 30) });
  const say = (text, bad) => { status.dataset.kind = bad ? 'bad' : ''; status.textContent = text; };

  if (hub) {
    hubCall('/google/status').then(({ ok, data }) => {
      if (!ok) { say('Could not check Google Calendar. The buttons below still work.', true); return; }
      if (!data.configured) { say('Your hub has no Google setup yet (see worker/README.md). The buttons below still work.'); return; }
      if (data.connected) { say('Google Calendar is connected. Adding again moves the same event.'); btn('auto').hidden = false; loadCalendars(); }
      else { say('Connect Google once and Vesper can add events for you.'); btn('connect').hidden = false; }
    }).catch(() => say('Could not reach the hub. The buttons below still work.', true));
  }

  async function loadCalendars() {
    const sel = form.cal;
    const r = await hubCall('/google/calendars').catch(() => null);
    if (!r || !r.ok) { if (r && r.data && r.data.error) say(r.data.error, true); return; }
    const { calendars, selected } = r.data;
    sel.innerHTML = calendars.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)}${c.primary ? ' (main)' : ''}</option>`).join('') +
      '<option value="__new__">+ Create new: Vesper Tasks</option>';
    dlg.querySelector('[data-cal]').hidden = false;
    sel.onchange = async () => {
      say('Saving...');
      const body = sel.value === '__new__' ? { create: 'Vesper Tasks' } : { id: sel.value };
      const res = await hubCall('/google/calendar', { method: 'POST', body }).catch(() => null);
      if (res && res.ok) {
        say(`Events will go to "${res.data.name || 'that calendar'}".`);
        if (sel.value === '__new__') loadCalendars();
      } else say((res && res.data && res.data.error) || 'Could not change the calendar.', true);
    };
  }

  dlg.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'google') window.open(googleCalendarLink(read()), '_blank', 'noopener');
    else if (act === 'ics') download('vesper.ics', icsFile(read()), 'text/calendar');
    else if (act === 'connect') {
      say('Opening Google...');
      const r = await hubCall('/google/start', { method: 'POST' }).catch(() => null);
      if (r && r.ok && r.data.url) location.assign(r.data.url);
      else say((r && r.data && r.data.error) || 'Could not start the Google sign-in.', true);
    } else if (act === 'auto') {
      const v = read();
      say('Adding...');
      const r = await hubCall('/calendar/event', { method: 'POST', body: { deck: deck.id, kind: /^Selah/.test(v.title) ? 'selah' : 'work', title: v.title, details: v.details, start: localStamp(v.start), minutes: v.minutes } }).catch(() => null);
      if (r && r.ok) say(r.data.moved ? 'Moved the existing event.' : 'Added to your Google Calendar.');
      else say((r && r.data && r.data.error) || 'Could not add the event.', true);
    }
  });
}
