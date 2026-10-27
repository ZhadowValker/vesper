// Dialogs for the hub (sync), exporting a task or project, and adding to a calendar.
import { store } from './store.js';
import { esc, confirmBox } from './util.js';
import { rerender } from './nav.js';
import { getSync, saveSync, syncReady, syncNow, syncStatus, hubCall, googleSignIn, signOut } from './sync.js';
import { taskMarkdown, projectMarkdown, googleCalendarLink, icsFile, calendarSuggestion } from './export.js';
import { aiReady } from './ai/settings.js';

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

// First visit on a hub that offers Google sign-in. Resolves 'google', 'offline', or 'later' (closed without choosing).
export function loginDialog() {
  return new Promise((resolve) => {
    const { dlg, close } = open(`<form>
      <h2>Welcome to Vesper</h2>
      <p class="ai-note">Sign in with Google once to keep your projects on every device, with a copy in your own Google Drive, and to add tasks to your Google Calendar. Google shows one permission screen; you can untick anything you don't want. Or carry on without an account; everything then stays on this device.</p>
      <p class="ai-status" role="status"></p>
      <div class="modal-actions ai-actions">
        <button type="button" class="btn" data-act="google">Continue with Google</button>
        <button type="button" class="btn ghost" data-act="offline">Continue offline</button>
      </div>
    </form>`);
    const status = dlg.querySelector('.ai-status');
    let answered = false;
    const finish = (v) => { if (answered) return; answered = true; close(); resolve(v); };
    dlg.addEventListener('close', () => finish('later'));
    dlg.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'offline') { try { localStorage.setItem('vesper.login.choice', 'offline'); } catch (err) { /* storage blocked */ } finish('offline'); }
      else if (act === 'google') {
        status.textContent = 'Opening Google...';
        try { await googleSignIn(location.origin); } catch (err) { status.dataset.kind = 'bad'; status.textContent = err.message; }
      } else if (e.target === dlg) finish('later');
    });
  });
}

export function syncDialog({ onChange } = {}) {
  const cfg = getSync();
  const google = !!cfg.email && syncReady();
  const advanced = google
    ? `<details class="ai-adv" open>
      <summary>Hub details</summary>
      <dl class="hub-det"><dt>Hub address</dt><dd>${esc(cfg.url)}</dd><dt>Signed in as</dt><dd>${esc(cfg.email)}</dd>
        <dt>Google Drive copy</dt><dd data-d="drive">Checking...</dd>
        <dt>Google Calendar</dt><dd data-d="cal">Checking...</dd>
        <dt>AI settings</dt><dd data-d="ai">${aiReady() ? 'Saved in your account' : 'Not set. Open AI on the home page.'}</dd>
        <dt>Claude connector</dt><dd data-d="mcp">Checking...</dd></dl>
    </details>`
    : `<details class="ai-adv"${cfg.url ? ' open' : ''}>
      <summary>Use a hub token instead (advanced)</summary>
      <label class="ai-f">Hub address<input name="url" type="url" inputmode="url" placeholder="https://vesper.yoursite.com" value="${esc(cfg.url)}" autocomplete="off"></label>
      <label class="ai-f">Token<input name="token" type="password" placeholder="The APP_TOKEN you set on the hub" value="${esc(cfg.token)}" autocomplete="off"></label>
    </details>`;
  const { dlg, close } = open(`<form>
    <h2>${google ? 'Your account' : 'Sign in'}</h2>
    ${google
      ? `<p class="ai-note">Signed in as <b>${esc(cfg.email)}</b>. Your projects sync across devices and a copy is kept in your own Google Drive.</p>`
      : '<p class="ai-note muted">Sign in with Google to keep your projects on every device, with a copy in your own Google Drive. Or use a hub token (advanced).</p>'}
    ${google ? '' : '<button type="button" class="btn" data-act="google">Continue with Google</button>'}
    <p class="ai-status" data-kind="${syncStatus().state === 'error' ? 'bad' : ''}" role="status">${esc(when(syncStatus()))}</p>
    ${google ? `<div class="modal-actions ai-actions">
      <button type="button" class="btn ghost" data-act="now">Sync now</button>
      <button type="button" class="btn ghost" data-act="backup">Back up to Drive</button>
      <button type="button" class="btn ghost" data-act="restore">Restore from Drive</button>
    </div>` : ''}
    ${advanced}
    <div class="modal-actions ai-actions">
      <button type="button" class="btn ghost" data-close>Close</button>
      ${google ? '<button type="button" class="btn ghost" data-act="signout">Sign out</button><button type="button" class="btn ghost danger" data-act="delete">Delete my data</button>' : (syncReady() ? '<button type="button" class="btn ghost" data-act="off">Turn off</button>' : '')}
      ${google ? '' : '<button type="submit" class="btn">Save and sync</button>'}
    </div>
  </form>`);
  const form = dlg.querySelector('form');
  const status = dlg.querySelector('.ai-status');
  const say = (text, bad) => { status.dataset.kind = bad ? 'bad' : ''; status.textContent = text; };
  const done = () => { close(); rerender(); if (onChange) onChange(); };

  if (google) {
    const cell = (k) => dlg.querySelector(`[data-d=${k}]`);
    const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago'; };
    hubCall('/me').then((r) => {
      const me = r && r.ok ? r.data : null;
      cell('drive').textContent = !me ? 'Could not check' : me.drive.connected ? (me.drive.last ? 'On. Last copy ' + ago(me.drive.last) : 'On. First copy will be saved on your next sync') : 'Not connected. Sign in with Google again.';
      if (!me) { cell('mcp').textContent = 'Could not check'; return; }
      hubCall('/me/mcp-link').then((l) => {
        const has = l && l.ok && l.data.exists;
        cell('mcp').innerHTML = has
          ? 'A link exists. <button type="button" class="btn ghost small" data-act="mcpnew">Replace link</button> <button type="button" class="btn ghost small" data-act="mcprevoke">Turn off</button>'
          : '<button type="button" class="btn ghost small" data-act="mcpnew">Create my Claude link</button>';
      });
    }).catch(() => { cell('drive').textContent = cell('mcp').textContent = 'Could not check'; });
    hubCall('/google/status').then((r) => {
      const g = r && r.ok ? r.data : null;
      const calBtn = (t) => `<button type="button" class="btn ghost small" data-act="calconnect">${t}</button>`;
      if (!g) cell('cal').textContent = 'Could not check';
      else if (!g.configured) cell('cal').textContent = 'Not set up on this hub';
      else if (g.connected) cell('cal').innerHTML = 'Connected. Calendar: ' + esc(g.calendar || 'primary') + ' ' + calBtn('Reconnect') + '<br><span class="muted">Pick or create the calendar from Add to calendar on a task.</span>';
      else cell('cal').innerHTML = calBtn('Connect Google Calendar');
    }).catch(() => { cell('cal').textContent = 'Could not check'; });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = form.url.value.trim(), token = form.token.value.trim();
    if (!/^https:\/\//i.test(url) || !token) { say('Enter the https address and the token.', true); return; }
    saveSync({ url, token });
    say('Syncing...');
    const st = await syncNow({ force: true });
    if (st.state === 'ok') done(); else say(when(st), true);
  });

  dlg.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'google') {
      say('Opening Google...');
      try { await googleSignIn((form.url.value || '').trim() || location.origin); }
      catch (err) { say(err.message.includes('Failed to fetch') ? 'Could not reach the hub. Open Vesper from your own hub address, or fill in the address under advanced.' : err.message, true); }
    } else if (act === 'calconnect') {
      say('Opening Google...');
      const r = await hubCall('/google/start', { method: 'POST' }).catch(() => null);
      if (r && r.ok && r.data.url) location.assign(r.data.url);
      else say((r && r.data && r.data.error) || 'Could not start the Google sign-in.', true);
    } else if (act === 'mcpnew') {
      const r = await hubCall('/me/mcp-link', { method: 'POST', body: {} }).catch(() => null);
      if (!r || !r.ok) { say('Could not create the link.', true); return; }
      const link = location.origin + r.data.path;
      const box = dlg.querySelector('[data-d=mcp]');
      box.innerHTML = '<input readonly class="mcp-link" aria-label="Your Claude link"> <button type="button" class="btn ghost small" data-act="copymcp">Copy</button><p class="muted">Shown once. In Claude: Settings, Connectors, Add custom connector, paste it. It works like a password.</p>';
      box.querySelector('input').value = link;
      box.dataset.link = link;
    } else if (act === 'mcprevoke') {
      const yes = await confirmBox('Turn off your Claude link?', 'Claude will lose access until you create a new link.', { ok: 'Turn off' });
      if (!yes) return;
      await hubCall('/me/mcp-link', { method: 'POST', body: { revoke: true } }).catch(() => null);
      dlg.querySelector('[data-d=mcp]').innerHTML = '<button type="button" class="btn ghost small" data-act="mcpnew">Create my Claude link</button>';
    } else if (act === 'copymcp') {
      try { await navigator.clipboard.writeText(dlg.querySelector('[data-d=mcp]').dataset.link || ''); say('Link copied. Keep it private.'); } catch (err) { say('Could not copy.', true); }
    } else if (act === 'now') {
      say('Syncing...');
      const st = await syncNow({ force: true });
      say(when(st), st.state === 'error');
      if (st.state === 'ok') rerender();
    } else if (act === 'backup') {
      say('Saving to Google Drive...');
      const r = await hubCall('/me/backup', { method: 'POST' }).catch(() => null);
      say(r && r.ok ? 'Saved a copy to your Google Drive.' : (r && r.data && r.data.error) || 'Could not save to Google Drive.', !(r && r.ok));
    } else if (act === 'restore') {
      const yes = await confirmBox('Restore from Google Drive?', 'This adds anything from your Drive copy that is missing here. Nothing newer is overwritten.', { ok: 'Restore', danger: false });
      if (!yes) return;
      say('Restoring...');
      const r = await hubCall('/me/restore', { method: 'POST' }).catch(() => null);
      if (r && r.ok) { await syncNow({ force: true }); say('Restored from Google Drive.'); rerender(); }
      else say((r && r.data && r.data.error) || 'Could not restore.', true);
    } else if (act === 'signout') {
      await signOut();
      done();
    } else if (act === 'delete') {
      const yes = await confirmBox('Delete my data?', 'This removes your data from the hub and your Vesper copy in Google Drive, and signs you out. The projects on this device stay here.', { ok: 'Delete my data' });
      if (!yes) return;
      const r = await hubCall('/me/delete', { method: 'POST' }).catch(() => null);
      if (r && r.ok) { saveSync(null); done(); }
      else say((r && r.data && r.data.error) || 'Could not delete.', true);
    } else if (act === 'off') {
      saveSync(null);
      done();
    }
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
