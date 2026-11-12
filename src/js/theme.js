// Shared theme picker for the public home and authentication navigation.
const THEMES = [
  { id: 'ocean', label: 'Ocean' },
  { id: 'light', label: 'Light' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'forest', label: 'Forest' }
];
const STORAGE_KEY = 'campusconnect-theme';

function initializeThemePicker() {
  const nav = document.querySelector('.site-header .nav');
  if (!nav || nav.querySelector('.theme-picker')) return;

  const picker = document.createElement('div');
  picker.className = 'theme-picker';
  picker.innerHTML = `
    <button class="theme-picker-trigger" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="theme-picker-menu">
      <span class="theme-picker-trigger-swatch" aria-hidden="true"></span>
      <span>Theme</span>
      <span class="theme-picker-chevron" aria-hidden="true">⌄</span>
    </button>
    <div class="theme-picker-menu" id="theme-picker-menu" role="group" aria-label="Choose a theme" hidden>
      ${THEMES.map(({ id, label }) => `
        <button class="theme-picker-option" type="button" data-theme-option="${id}" aria-pressed="false">
          <span class="theme-picker-swatch" aria-hidden="true"></span>
          <span>${label}</span>
          <span class="theme-picker-check" aria-hidden="true">✓</span>
        </button>`).join('')}
    </div>`;
  nav.append(picker);

  const trigger = picker.querySelector('.theme-picker-trigger');
  const menu = picker.querySelector('.theme-picker-menu');
  const options = [...picker.querySelectorAll('[data-theme-option]')];
  let activeTheme = 'ocean';

  function setTheme(theme, persist = true) {
    if (!THEMES.some((entry) => entry.id === theme)) return;
    activeTheme = theme;
    document.documentElement.dataset.theme = theme;
    options.forEach((option) => {
      const active = option.dataset.themeOption === theme;
      option.setAttribute('aria-pressed', String(active));
      if (active) option.setAttribute('aria-current', 'true');
      else option.removeAttribute('aria-current');
    });
    picker.querySelector('.theme-picker-trigger-swatch').dataset.theme = theme;
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* Storage may be unavailable. */ }
    }
  }

  function closeMenu(returnFocus = false) {
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (returnFocus) trigger.focus();
  }

  trigger.addEventListener('click', () => {
    const opening = menu.hidden;
    menu.hidden = !opening;
    trigger.setAttribute('aria-expanded', String(opening));
    if (opening) options.find((option) => option.dataset.themeOption === activeTheme)?.focus();
  });

  options.forEach((option) => option.addEventListener('click', () => {
    setTheme(option.dataset.themeOption);
    closeMenu(true);
  }));

  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    if (menu.hidden) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement);
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    options[nextIndex].focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!picker.contains(event.target) && !menu.hidden) closeMenu();
  });

  try {
    const savedTheme = localStorage.getItem(STORAGE_KEY);
    setTheme(savedTheme || 'ocean', false);
  } catch {
    setTheme('ocean', false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeThemePicker, { once: true });
} else {
  initializeThemePicker();
}
