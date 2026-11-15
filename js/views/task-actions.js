import { missingSelahs, finishTask } from '../task-status.js';
import { confirmBox } from '../util.js';
import { store } from '../store.js';

export async function finishInApp(deck, confirm = confirmBox) {
  const missing = missingSelahs(deck);
  const open = store.tasksAt('project', deck.id).filter((t) => !t.done).length;
  if (missing.length || open) {
    const yes = await confirm(missing.length ? 'Finish before all Selahs?' : 'Finish with open tasks?', `${missing.length ? `Not yet passed: ${missing.map((s) => s.name).join(', ')}.` : 'All Selahs passed.'}${open ? ` ${open} task${open === 1 ? '' : 's'} still open. They do not block Finish.` : ''}`, { ok: 'Finish anyway', danger: false });
    if (!yes) return false;
  }
  return !finishTask(deck, { force: true, reason: 'Finished early after confirmation in the app.' });
}
