// Dialogs for the AI helpers. Suggestions are previews: nothing is saved until the person accepts.
import { store } from '../store.js';
import { esc } from '../util.js';
import { rerender } from '../nav.js';
import { syncReady } from '../sync.js';
import { getAI, saveAI, DEFAULTS } from './settings.js';
import { chat, askJSON, AIError } from './client.js';
import { draftMessages, reviewMessages, validDraft, validReview } from './prompts.js';

function open(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal ai-modal';
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  const ctl = { dlg, closed: false, onClose: null };
  ctl.close = () => {
    if (ctl.closed) return;
    ctl.closed = true;
    if (ctl.onClose) ctl.onClose();
    dlg.close();
    dlg.remove();
  };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); ctl.close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) ctl.close(); });
  dlg.showModal();
  return ctl;
}

const msgOf = (e) => (e instanceof AIError ? e.message : 'Something went wrong. Try again.');

// ---- Settings -------------------------------------------------------------------------

export function aiSettingsDialog({ onSaved } = {}) {
  const s = getAI();
  const field = (id, label, val, extra = '') =>
    `<label class="ai-f"><span>${label}</span><input id="ai-${id}" value="${esc(val)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${extra}></label>`;
  const ctl = open(`<form class="ai-form">
    <h2>AI settings</h2>
    <p class="muted ai-note">Optional. ${syncReady() ? 'Saved in your Vesper account, so your other devices fill this in after you sign in.' : 'Stored on this device only.'} It is not in Export backup. Your notes for a slide are sent to the address below when you use an AI button.</p>
    ${field('url', 'Address', s.url)}
    <label class="ai-f"><span>Key (or your Worker token)</span><input id="ai-key" type="password" value="${esc(s.key)}" autocomplete="off" placeholder="Paste your key"></label>
    ${field('draft', 'Draft model', s.draft)}
    ${field('review', 'Review model (empty: same as Draft)', s.review)}
    ${field('backup', 'Backup model (used if the first fails)', s.backup)}
    <p class="ai-status" id="ai-status" role="status"></p>
    <div class="modal-actions ai-actions">
      <button type="button" class="btn" data-x="test">Test connection</button>
      <button type="button" class="btn" data-x="close">Close</button>
      <button type="submit" class="btn primary">Save</button>
    </div>
  </form>`);
  const q = (id) => ctl.dlg.querySelector(`#ai-${id}`);
  const status = ctl.dlg.querySelector('#ai-status');
  const read = () => ({ url: q('url').value, key: q('key').value, draft: q('draft').value, review: q('review').value, backup: q('backup').value });
  const form = ctl.dlg.querySelector('form');
  ctl.dlg.querySelector('[data-x=close]').addEventListener('click', ctl.close);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveAI(read());
    ctl.close();
    if (onSaved) onSaved(); else rerender();
  });
  ctl.dlg.querySelector('[data-x=test]').addEventListener('click', async () => {
    saveAI(read());
    status.textContent = 'Testing…';
    status.dataset.kind = '';
    try {
      const s2 = getAI();
      const reply = await chat([{ role: 'user', content: 'Reply with the single word OK.' }], s2.draft, { maxTokens: 256 });
      status.textContent = `Connected. ${s2.draft} replied: ${reply.slice(0, 40)}`;
      status.dataset.kind = 'ok';
    } catch (e) {
      status.textContent = msgOf(e);
      status.dataset.kind = 'bad';
    }
  });
}

// ---- Help me with this ------------------------------------------------------------------

export function draftDialog(deck, slide) {
  const project = store.project(deck.projectId);
  const ctl = open('<form><h2>Suggestions</h2><div id="ai-body"></div></form>');
  const body = ctl.dlg.querySelector('#ai-body');
  let abort = null;
  ctl.onClose = () => { if (abort) abort.abort(); };

  async function run() {
    abort = new AbortController();
    body.innerHTML = `<p class="muted ai-wait">Thinking…</p><div class="modal-actions"><button type="button" class="btn" data-x="close">Cancel</button></div>`;
    body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
    try {
      const out = await askJSON(draftMessages(deck, project, slide), 'draft', { signal: abort.signal });
      if (ctl.closed) return;
      if (!validDraft(out, slide.sub.steps.length)) throw new AIError('The reply was not in the expected format.', 'format');
      show(out.steps.map((t) => t.trim()));
    } catch (e) {
      if (ctl.closed) return;
      body.innerHTML = `<p class="ai-status" data-kind="bad">${esc(msgOf(e))}</p><div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button><button type="button" class="btn primary" data-x="again">Try again</button></div>`;
      body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
      body.querySelector('[data-x=again]').addEventListener('click', run);
    }
  }

  function show(texts) {
    const rows = slide.sub.steps.map((step, k) => {
      const have = (deck.notes[`${slide.key}#${k}`] || '').trim();
      return `<div class="ai-row">
        <label class="ai-use"><input type="checkbox" data-k="${k}" ${have ? '' : 'checked'}><span>${esc(step)}</span></label>
        <textarea rows="3" data-t="${k}" aria-label="Suggestion for ${esc(step)}">${esc(texts[k])}</textarea>
        ${have ? '<p class="ai-warn">You already wrote something here. Tick the box to replace it.</p>' : ''}
      </div>`;
    }).join('');
    body.innerHTML = `<p class="muted ai-note">Edit anything, then choose what to use. Nothing is saved until you press Use.</p>${rows}
      <div class="modal-actions"><button type="button" class="btn" data-x="close">Cancel</button><button type="button" class="btn" data-x="again">Try again</button><button type="button" class="btn primary" data-x="use">Use selected</button></div>`;
    body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
    body.querySelector('[data-x=again]').addEventListener('click', run);
    body.querySelector('[data-x=use]').addEventListener('click', () => {
      body.querySelectorAll('input[data-k]').forEach((box) => {
        if (!box.checked) return;
        const k = box.dataset.k;
        deck.notes[`${slide.key}#${k}`] = body.querySelector(`textarea[data-t="${k}"]`).value.trim();
      });
      store.save(deck);
      ctl.close();
      rerender();
    });
  }
  run();
}

// ---- Review this stage ------------------------------------------------------------------

const VERDICT = { ready: 'Looks ready', almost: 'Almost there', not_yet: 'Not yet' };

export function reviewDialog(deck, stage) {
  const project = store.project(deck.projectId);
  const ctl = open('<form><h2>Review: ' + esc(stage.name) + '</h2><div id="ai-body"></div></form>');
  const body = ctl.dlg.querySelector('#ai-body');
  let abort = null;
  ctl.onClose = () => { if (abort) abort.abort(); };

  async function run() {
    abort = new AbortController();
    body.innerHTML = `<p class="muted ai-wait">Reading your ${esc(stage.name)} notes…</p><div class="modal-actions"><button type="button" class="btn" data-x="close">Cancel</button></div>`;
    body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
    try {
      const out = await askJSON(reviewMessages(deck, project, stage), 'review', { signal: abort.signal });
      if (ctl.closed) return;
      if (!validReview(out)) throw new AIError('The reply was not in the expected format.', 'format');
      const gaps = out.gaps.filter((g) => typeof g === 'string' && g.trim()).slice(0, 4);
      body.innerHTML = `<p><span class="ai-verdict" data-v="${out.verdict}">${VERDICT[out.verdict]}</span></p>
        <p>${esc(out.summary)}</p>
        ${gaps.length ? `<ul class="ai-gaps">${gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}
        <p class="muted ai-note">This is only a second opinion. You decide whether to continue.</p>
        <div class="modal-actions"><button type="button" class="btn" data-x="again">Review again</button><button type="button" class="btn primary" data-x="close">Close</button></div>`;
      body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
      body.querySelector('[data-x=again]').addEventListener('click', run);
    } catch (e) {
      if (ctl.closed) return;
      body.innerHTML = `<p class="ai-status" data-kind="bad">${esc(msgOf(e))}</p><div class="modal-actions"><button type="button" class="btn" data-x="close">Close</button><button type="button" class="btn primary" data-x="again">Try again</button></div>`;
      body.querySelector('[data-x=close]').addEventListener('click', ctl.close);
      body.querySelector('[data-x=again]').addEventListener('click', run);
    }
  }
  run();
}

export { DEFAULTS };
