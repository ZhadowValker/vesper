const THEME_KEY = 'vesper.theme.v1';
const VALID_THEMES = new Set(['auto', 'dark', 'light']);

function normalizeTheme(value) {
  return VALID_THEMES.has(value) ? value : 'auto';
}

export function getThemePreference() {
  try {
    return normalizeTheme(globalThis.localStorage?.getItem(THEME_KEY));
  } catch {
    return 'auto';
  }
}

export function setThemePreference(value) {
  const preference = normalizeTheme(value);
  try {
    globalThis.localStorage?.setItem(THEME_KEY, preference);
  } catch {
    // Private browsing or a restricted storage context: keep the UI usable.
  }
  return preference;
}

export function resolveTheme(preference, systemLight) {
  const normalized = normalizeTheme(preference);
  return normalized === 'auto' ? (systemLight ? 'light' : 'dark') : normalized;
}

function systemPrefersLight() {
  try {
    return typeof globalThis.matchMedia === 'function'
      ? globalThis.matchMedia('(prefers-color-scheme: light)').matches
      : false;
  } catch {
    return false;
  }
}

function applyTheme(theme, root = globalThis.document?.documentElement) {
  if (!root) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const meta = globalThis.document?.querySelector?.('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'light' ? '#f4f1f8' : '#0e0b24';
}

export function initTheme() {
  const root = globalThis.document?.documentElement;
  const media = (() => {
    try {
      return typeof globalThis.matchMedia === 'function'
        ? globalThis.matchMedia('(prefers-color-scheme: light)')
        : null;
    } catch {
      return null;
    }
  })();

  const update = () => applyTheme(resolveTheme(getThemePreference(), media?.matches ?? false), root);
  update();
  if (media?.addEventListener) media.addEventListener('change', update);
  else if (media?.addListener) media.addListener(update);

  return () => {
    if (media?.removeEventListener) media.removeEventListener('change', update);
    else if (media?.removeListener) media.removeListener(update);
  };
}

export function themeControlHTML() {
  const preference = getThemePreference();
  return `<div class="task-controls row">
    <label class="theme-control">Appearance
      <select class="theme-select" data-theme-control aria-label="Color theme">
        <option value="auto"${preference === 'auto' ? ' selected' : ''}>Auto</option>
        <option value="dark"${preference === 'dark' ? ' selected' : ''}>Dark</option>
        <option value="light"${preference === 'light' ? ' selected' : ''}>Light</option>
      </select>
    </label>
  </div>`;
}

export function bindThemeControl(root) {
  if (!root?.addEventListener) return () => {};
  const select = root.matches?.('[data-theme-control]')
    ? root
    : root.querySelector?.('[data-theme-control]');
  if (!select) return () => {};

  select.value = getThemePreference();
  const onChange = () => {
    const preference = setThemePreference(select.value);
    applyTheme(resolveTheme(preference, systemPrefersLight()));
  };
  select.addEventListener('change', onChange);
  return () => select.removeEventListener('change', onChange);
}
