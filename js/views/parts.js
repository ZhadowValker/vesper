import { SLIDES } from '../framework.js';
import { esc } from '../util.js';

const CHEVRON = '<svg aria-hidden="true" class="crumb-sep" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';

// The name shown on the chip for a slide.
export function slideName(slide) {
  if (slide.type === 'cover') return 'Cover';
  if (slide.type === 'recap') return 'Recap';
  if (slide.type === 'selah') return 'Selah';
  return slide.sub.name;
}

// "Resume" button with the full path underneath: project, deck, chip.
// target 'tree' opens the deck's mind map; 'slide' opens the slide you were on.
export function resumeButton(deck, project, extraClass = '', target = 'slide') {
  const verb = deck.finished ? 'Open recap' : deck.reached === 0 ? 'Begin' : 'Resume';
  const path = [project ? project.name : '', deck.title, slideName(SLIDES[deck.slide])].filter(Boolean).map(esc).join(CHEVRON);
  return `<a class="btn primary resume ${extraClass}" href="${target === 'tree' ? `#/d/${deck.id}` : `#/d/${deck.id}/s/${deck.slide}`}"><span class="resume-v">${verb}</span><span class="resume-p">${path}</span></a>`;
}
