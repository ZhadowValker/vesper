import { hubCall, syncReady } from './sync.js';
import { esc, confirmBox } from './util.js';

export const tokenManagerHTML = () => `<section data-token-manager class="stack tight" hidden>
  <h3>Named access tokens</h3><p class="sub">Give each device or connector its own token. Revoking it does not change your master key.</p>
  <label class="ai-f">Token label<input data-token-label maxlength="80" placeholder="Claude or Phone" autocomplete="off"></label>
  <button type="button" class="btn small" data-token-create>Create token</button>
  <p class="sub" data-token-status role="status"></p><div data-token-list class="stack tight"></div>
  <div data-token-once hidden><p>Copy this token now. It will never be shown again.</p>
    <input data-new-token readonly aria-label="New access token" autocomplete="off" spellcheck="false">
    <button type="button" class="btn small" data-token-copy>Copy token</button>
  </div></section>`;

export function bindTokenManager(root) {
  const section = root.querySelector('[data-token-manager]');
  const status = section.querySelector('[data-token-status]');
  let closed = false;
  const say = (text) => { if (!closed) status.textContent = text; };
  async function refresh() {
    const result = await hubCall('/me/tokens');
    if (closed) return;
    if (!result.ok) { say(result.data.error || 'Could not list access tokens.'); return; }
    section.querySelector('[data-token-list]').innerHTML = result.data.tokens.map((t) =>
      `<div class="card"><strong>${esc(t.label)}</strong><p class="sub">Created ${esc(new Date(t.created).toLocaleString())}<br>Last used ${t.lastUsed ? esc(new Date(t.lastUsed).toLocaleString()) : 'never'}${t.revoked ? '<br>Revoked' : ''}</p>${t.revoked ? '' : `<button type="button" class="btn small danger" data-token-revoke="${esc(t.id)}">Revoke</button>`}</div>`
    ).join('') || '<p class="sub">No named tokens yet.</p>';
  }
  if (syncReady()) hubCall('/me').then((r) => {
    if (closed || !r.ok || !r.data.manageTokens) return;
    section.hidden = false;
    return refresh();
  }).catch(() => say('Could not reach the hub.'));
  const click = async (e) => {
    const button = e.target.closest('[data-token-create],[data-token-copy],[data-token-revoke]');
    if (!button) return;
    button.disabled = true;
    try {
      if (button.hasAttribute('data-token-create')) {
        // Remove any previous disclosure before making another token.
        const input = section.querySelector('[data-new-token]');
        input.value = ''; section.querySelector('[data-token-once]').hidden = true;
        const result = await hubCall('/me/tokens', { method: 'POST', body: { label: section.querySelector('[data-token-label]').value } });
        if (!result.ok) { say(result.data.error || 'Could not create token.'); return; }
        if (closed) return;
        input.value = result.data.token;
        section.querySelector('[data-token-once]').hidden = false;
        say('Created. Copy the token before closing this screen.');
        await refresh();
      } else if (button.hasAttribute('data-token-copy')) {
        await navigator.clipboard.writeText(section.querySelector('[data-new-token]').value);
        say('Token copied. Keep it private.');
      } else {
        if (!(await confirmBox('Revoke this token?', 'Devices and connectors using it will lose access.', { ok: 'Revoke' }))) return;
        const result = await hubCall(`/me/tokens/${button.dataset.tokenRevoke}/revoke`, { method: 'POST', body: {} });
        if (!result.ok) { say(result.data.error || 'Could not revoke token.'); return; }
        section.querySelector('[data-new-token]').value = '';
        section.querySelector('[data-token-once]').hidden = true;
        say('Token revoked.');
        await refresh();
      }
    } catch (e) { say('Could not complete the request. Check the connection and try again.'); }
    finally { button.disabled = false; }
  };
  section.addEventListener('click', click);
  return () => {
    closed = true;
    section.querySelector('[data-new-token]').value = '';
    section.removeEventListener('click', click);
  };
}
