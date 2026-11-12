import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const nameElement = document.querySelector('#student-name');
const avatarElement = document.querySelector('#student-avatar');
const statusElement = document.querySelector('#dashboard-status');
const logoutButton = document.querySelector('#logout-button');

function getInitials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toLocaleUpperCase()).join('') || 'S';
}

function showStatus(message) {
  statusElement.textContent = message;
  statusElement.hidden = false;
}

async function initializeDashboard() {
  if (!isSupabaseConfigured || !supabase) {
    window.location.replace('../auth.html#login');
    return;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      window.location.replace('../auth.html#login');
      return;
    }

    const fullName = session.user.user_metadata?.full_name?.trim();
    nameElement.textContent = fullName || 'student';
    avatarElement.textContent = getInitials(fullName || 'student');
  } catch {
    window.location.replace('../auth.html#login');
  }
}

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.replace('../auth.html#login');
  } catch (error) {
    showStatus(error.message || 'Could not log out. Please try again.');
    logoutButton.disabled = false;
  }
});

document.querySelectorAll('[data-feature]').forEach((feature) => {
  feature.addEventListener('click', () => {
    const featureName = feature.dataset.feature;
    showStatus(`${featureName} — Coming soon.`);
  });
});

const mobileNav = document.querySelector('.mobile-bottom-nav');
mobileNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mobileNav.querySelectorAll('.mobile-nav-item').forEach((item) => item.classList.remove('is-active'));
    link.classList.add('is-active');
  });
});

initializeDashboard();
