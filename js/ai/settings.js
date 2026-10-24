// AI settings live on this device only (not in the project data, not in Export backup).
const KEY = 'vesper.ai';
export const DEFAULTS = {
  url: 'https://integrate.api.nvidia.com/v1',
  key: '',
  draft: 'openai/gpt-oss-20b',
  review: '',
  backup: 'minimaxai/minimax-m3.1-flash',
};

export function getAI() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function saveAI(next) {
  const clean = {};
  for (const k of Object.keys(DEFAULTS)) clean[k] = String(next[k] ?? DEFAULTS[k]).trim();
  clean.url = clean.url.replace(/\/+$/, '');
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch (e) { /* storage blocked */ }
  return clean;
}

// The AI buttons only appear once an address, a key and a draft model are set.
export function aiReady() {
  const s = getAI();
  return !!(s.url && s.key && s.draft);
}
