// The page Google sends you back to after "Continue with Google".
import { completeSignIn, syncNow } from './sync.js';
import { store } from './store.js';
import { resolveAsk } from './data-owner.js';
import { confirmBox } from './util.js';
import { go } from './nav.js';

export function signinView(code) {
  const html = `<div class="page"><div class="card stack"><h2>Signing you in</h2><p class="muted ai-status" role="status">Just a moment...</p></div></div>`;
  function mount(root) {
    document.querySelectorAll('dialog[open]').forEach((d) => { d.close(); d.remove(); });
    const msg = root.querySelector('.ai-status');
    completeSignIn(code).then(async (r) => {
      if (r.claim === 'ask') {
        // Projects made before any sign-in: only attach them if the person says so. Cancel keeps them off this account.
        const yes = await confirmBox('Add the projects on this device?', 'There are projects on this device that are not linked to any account. Add them to ' + (r.email || 'this account') + '? If you cancel, they are set aside and this account starts empty.', { ok: 'Add them', danger: false });
        resolveAsk(store, r.id, !!yes);
      }
      msg.textContent = 'Signed in. Loading your projects...';
      await syncNow({ force: true });
      go('#/');
    }).catch((e) => {
      msg.dataset.kind = 'bad';
      msg.innerHTML = '';
      msg.append(e.message + ' ');
      const a = document.createElement('a');
      a.href = '#/'; a.textContent = 'Back to Vesper';
      msg.appendChild(a);
    });
  }
  return { html, mount };
}
