import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const nameElement = document.querySelector('#student-name');
const headerNameElement = document.querySelector('#header-student-name');
const avatarElement = document.querySelector('#student-avatar');
const adminLink = document.querySelector('#admin-panel-link');
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

    const fullName = session.user.user_metadata?.full_name?.trim() || 'student';
    nameElement.textContent = fullName;
    headerNameElement.textContent = fullName;
    avatarElement.textContent = getInitials(fullName);
    avatarElement.setAttribute('aria-label', `${getInitials(fullName)} profile initials`);

    const { data: profile, error: profileError } = await supabase.from('profiles')
      .select('role').eq('id', session.user.id).maybeSingle();
    if (profileError) {
      showStatus(`Could not load your profile: ${profileError.message}`);
      return;
    }
    adminLink.hidden = profile?.role !== 'admin';
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
    showStatus(`${feature.dataset.feature} — Coming soon.`);
  });
});

const dashboardLinks = [...document.querySelectorAll('[data-dashboard-link]')];
dashboardLinks.forEach((link) => {
  link.addEventListener('click', () => {
    dashboardLinks.forEach((item) => item.classList.toggle('is-active', item.dataset.dashboardLink === link.dataset.dashboardLink));
  });
});

initializeDashboard();
