import { missingSelahs, finishTask } from '../task-status.js';
import { confirmBox } from '../util.js';

export async function finishInApp(deck, confirm = confirmBox) {
  const missing = missingSelahs(deck);
  if (missing.length) {
    const yes = await confirm('Finish before all Selahs?', `Not yet passed: ${missing.map((s) => s.name).join(', ')}.`, { ok: 'Finish anyway', danger: false });
    if (!yes) return false;
  }
  return !finishTask(deck, { force: true, reason: 'Finished early after confirmation in the app.' });
}
