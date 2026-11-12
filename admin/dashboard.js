import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const notice = $('#admin-notice');
const navButtons = [...document.querySelectorAll('[data-view]')];
const views = [...document.querySelectorAll('.admin-view')];
const state = { profiles: [] };

function showNotice(message, type = 'info') {
  notice.textContent = message;
  notice.dataset.type = type;
  notice.hidden = false;
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function initials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase()).join('') || 'U';
}

function setView(view) {
  const selected = ['overview', 'users'].includes(view) ? view : 'overview';
  views.forEach((section) => {
    const active = section.id === `view-${selected}`;
    section.classList.toggle('is-visible', active);
    section.hidden = !active;
  });
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === selected));
  $('#page-title').textContent = selected[0].toUpperCase() + selected.slice(1);
  if (selected === 'overview') loadOverview();
  if (selected === 'users') loadUsers();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));

async function requireAdmin() {
  if (!isSupabaseConfigured || !supabase) {
    window.location.replace('../auth.html');
    return false;
  }
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session) {
      window.location.replace('../auth.html');
      return false;
    }
    const { data: profile, error } = await supabase.from('profiles')
      .select('id, full_name, email, role')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) {
      showNotice(`Could not verify admin access: ${error.message}`, 'error');
      return false;
    }
    if (!profile || profile.role !== 'admin') {
      window.location.replace('../student/dashboard.html');
      return false;
    }
    $('#admin-name').textContent = profile.full_name || profile.email || 'Administrator';
    $('#admin-avatar').textContent = initials(profile.full_name || profile.email || 'Admin');
    return true;
  } catch (error) {
    showNotice(error.message || 'Could not verify the current session.', 'error');
    return false;
  }
}

function renderOverview(profiles) {
  const totals = {
    'Total users': profiles.length,
    Active: profiles.filter((profile) => profile.status === 'active').length,
    Muted: profiles.filter((profile) => profile.status === 'muted').length,
    Suspended: profiles.filter((profile) => profile.status === 'suspended').length
  };
  $('#stats-grid').innerHTML = Object.entries(totals).map(([label, count]) => `
    <article class="stat-card"><span>${escapeHTML(label)}</span><strong>${count}</strong></article>
  `).join('');
}

async function loadOverview() {
  const grid = $('#stats-grid');
  grid.innerHTML = '<p class="loading">Loading profile totals…</p>';
  const { data, error } = await supabase.from('profiles').select('id, status');
  if (error) {
    grid.innerHTML = `<p class="empty-state">Could not load profile totals: ${escapeHTML(error.message)}</p>`;
    return;
  }
  renderOverview(data || []);
}

async function loadUsers() {
  const list = $('#users-list');
  list.innerHTML = '<p class="loading">Loading users…</p>';
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, matric_number, email, role, status')
    .order('full_name', { ascending: true });
  if (error) {
    list.innerHTML = `<p class="empty-state">Could not load users: ${escapeHTML(error.message)}</p>`;
    $('#user-count').textContent = '—';
    return;
  }
  state.profiles = data || [];
  renderUsers();
}

function renderUsers() {
  const query = $('#user-search').value.trim().toLocaleLowerCase();
  const status = $('#status-filter').value;
  const filtered = state.profiles.filter((profile) => {
    const searchable = [profile.full_name, profile.email, profile.matric_number]
      .some((value) => String(value || '').toLocaleLowerCase().includes(query));
    return searchable && (status === 'all' || profile.status === status);
  });
  $('#user-count').textContent = `${filtered.length} of ${state.profiles.length}`;
  $('#users-list').innerHTML = filtered.length ? filtered.map((profile) => `
    <article class="user-row">
      <span class="user-initials" aria-hidden="true">${escapeHTML(initials(profile.full_name || profile.email || 'User'))}</span>
      <span class="user-row-main">
        <strong>${escapeHTML(profile.full_name || 'Name not provided')}</strong>
        <small>${escapeHTML(profile.email || 'No email')}</small>
        <small>Matric: ${escapeHTML(profile.matric_number || 'Not provided')}</small>
      </span>
      <span class="user-badges">
        <span class="badge">${escapeHTML(profile.role || 'student')}</span>
        <span class="badge" data-status="${escapeHTML(profile.status || 'active')}">${escapeHTML(profile.status || 'active')}</span>
      </span>
    </article>
  `).join('') : '<p class="empty-state">No users match these filters.</p>';
}

$('#user-search').addEventListener('input', renderUsers);
$('#status-filter').addEventListener('change', renderUsers);

$('#logout-button').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    showNotice(`Could not log out: ${error.message}`, 'error');
    button.disabled = false;
    return;
  }
  window.location.replace('../auth.html');
});

if (await requireAdmin()) {
  await loadOverview();
  setView('overview');
}
