// Campus Connect client-side entry point.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js';

const menuToggle = document.querySelector('.menu-toggle');
const navLinks = document.querySelector('.nav-links');
const currentYear = document.querySelector('#current-year');

if (currentYear) currentYear.textContent = new Date().getFullYear();

menuToggle?.addEventListener('click', () => {
  const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!isExpanded));
  menuToggle.setAttribute('aria-label', isExpanded ? 'Open menu' : 'Close menu');
  navLinks?.classList.toggle('is-open', !isExpanded);
});

navLinks?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Open menu');
    navLinks.classList.remove('is-open');
  });
});

if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch((error) => {
      console.error('Service worker registration failed:', error);
    });
  });
}

// Configuration presence only; this does not verify connectivity or authentication.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
if (!isSupabaseConfigured) {
  console.info('Supabase is not configured yet. Add the project URL and publishable anon key in src/js/supabase-config.js.');
}
