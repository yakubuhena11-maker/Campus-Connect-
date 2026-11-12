import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const notice = $('#notice');
const navButtons = [...document.querySelectorAll('[data-view]')];
const views = [...document.querySelectorAll('.view')];
const state = { profile: null, profiles: [], selectedUser: null };
const themeSelect = $('#theme-select');
const validThemes = ['ocean', 'light', 'midnight', 'forest'];

function showNotice(message, type = 'info') {
  notice.textContent = message;
  notice.dataset.type = type;
  notice.hidden = false;
}
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function initials(name = '') {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || 'U';
}
function setView(view) {
  const selected = ['overview', 'users', 'reports', 'audit'].includes(view) ? view : 'overview';
  views.forEach((section) => {
    const active = section.id === `view-${selected}`;
    section.classList.toggle('is-visible', active);
    section.hidden = !active;
  });
  navButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.view === selected));
  $('#page-title').textContent = selected === 'audit' ? 'Audit log' : selected[0].toUpperCase() + selected.slice(1);
  if (selected === 'users') loadUsers();
  if (selected === 'reports') loadReports();
  if (selected === 'audit') loadAudit();
}
navButtons.forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelectorAll('[data-go]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.go)));

async function requireAdmin() {
  if (!isSupabaseConfigured || !supabase) {
    showNotice('Supabase is not configured. Admin access cannot be verified.', 'error');
    return false;
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    window.location.replace('../auth.html#login');
    return false;
  }
  const { data: profile, error } = await supabase.from('profiles')
    .select('id, full_name, email, role, status').eq('id', session.user.id).maybeSingle();
  if (error) {
    showNotice(`Could not verify admin profile: ${error.message}`, 'error');
    return false;
  }
  if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
    window.location.replace('../student/dashboard.html');
    return false;
  }
  state.profile = profile;
  $('#admin-name').textContent = profile.full_name || profile.email || 'Administrator';
  $('#admin-avatar').textContent = initials(profile.full_name || profile.email);
  return true;
}

async function logAction(action, targetUserId, details) {
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: state.profile.id, action, target_user_id: targetUserId, details
  });
  if (error) throw new Error(`The change was made, but its audit record could not be saved: ${error.message}`);
}

async function loadOverview() {
  const grid = $('#stats-grid');
  const { data, error } = await supabase.from('profiles').select('id, status, created_at');
  if (error) { grid.innerHTML = `<p class="empty-state">Could not load profile counts: ${escapeHTML(error.message)}</p>`; return; }
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const counts = {
    'Total users': data.length,
    Active: data.filter((row) => row.status === 'active').length,
    Muted: data.filter((row) => row.status === 'muted').length,
    Suspended: data.filter((row) => row.status === 'suspended').length,
    'New this week': data.filter((row) => new Date(row.created_at).getTime() >= weekStart).length
  };
  grid.innerHTML = Object.entries(counts).map(([label, count]) => `<article class="stat-card"><span>${escapeHTML(label)}</span><strong>${count}</strong><small>Live profile data</small></article>`).join('');
}
async function loadUsers() {
  const list = $('#users-list');
  list.innerHTML = '<p class="loading">Loading profiles…</p>';
  const { data, error } = await supabase.from('profiles')
    .select('id, full_name, matric_number, email, role, status, created_at').order('created_at', { ascending: false });
  if (error) { list.innerHTML = `<p class="empty-state">Could not load users: ${escapeHTML(error.message)}</p>`; return; }
  state.profiles = data || [];
  renderUsers();
}
function renderUsers() {
  const query = $('#user-search').value.trim().toLowerCase();
  const statusFilter = $('#status-filter').value;
  const roleFilter = $('#role-filter').value;
  const visible = state.profiles.filter((user) => {
    const textMatch = [user.full_name, user.email, user.matric_number].some((value) => String(value || '').toLowerCase().includes(query));
    return textMatch && (statusFilter === 'all' || user.status === statusFilter) && (roleFilter === 'all' || user.role === roleFilter);
  });
  $('#user-count').textContent = `${visible.length} of ${state.profiles.length}`;
  $('#users-list').innerHTML = visible.length ? visible.map((user) => `
    <button class="user-row" type="button" data-user-id="${escapeHTML(user.id)}">
      <span class="avatar">${escapeHTML(initials(user.full_name))}</span>
      <span class="user-row-main"><strong>${escapeHTML(user.full_name || 'Name not provided')}</strong><small>${escapeHTML(user.email || 'No email')} · ${escapeHTML(user.matric_number || 'No matric number')}</small></span>
      <span class="badges"><span class="badge">${escapeHTML(user.role)}</span><span class="badge" data-status="${escapeHTML(user.status)}">${escapeHTML(user.status)}</span></span>
    </button>`).join('') : '<p class="empty-state">No users match these filters.</p>';
}
$('#users-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-user-id]');
  if (row) openUser(row.dataset.userId);
});
function openUser(id) {
  const user = state.profiles.find((item) => item.id === id);
  if (!user) return;
  state.selectedUser = user;
  $('#profile-id').value = user.id;
  $('#profile-full-name').value = user.full_name || '';
  $('#profile-matric').value = user.matric_number || '';
  $('#profile-email').value = user.email || '';
  $('#profile-role').value = user.role;
  $('#detail-heading').textContent = user.full_name || user.email || 'User details';
  const actions = $('#user-actions');
  actions.replaceChildren();
  const mute = document.createElement('button');
  mute.className = 'button button-outline'; mute.type = 'button';
  mute.textContent = user.status === 'muted' ? 'Unmute user' : 'Mute user';
  mute.addEventListener('click', () => updateStatus(user.status === 'muted' ? 'active' : 'muted'));
  const suspend = document.createElement('button');
  suspend.className = 'button button-outline'; suspend.type = 'button';
  suspend.textContent = user.status === 'suspended' ? 'Unsuspend user' : 'Suspend user';
  suspend.addEventListener('click', () => updateStatus(user.status === 'suspended' ? 'active' : 'suspended'));
  actions.append(mute, suspend);
  if (user.id !== state.profile.id && user.role !== 'admin') {
    const remove = document.createElement('button');
    remove.className = 'button danger-button'; remove.type = 'button';
    remove.textContent = 'Delete user';
    remove.addEventListener('click', () => deleteUser(user));
    actions.append(remove);
  }
  $('#user-detail').hidden = false;
  $('#user-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#user-search').addEventListener('input', renderUsers);
$('#status-filter').addEventListener('change', renderUsers);
$('#role-filter').addEventListener('change', renderUsers);
$('#close-detail').addEventListener('click', () => { $('#user-detail').hidden = true; state.selectedUser = null; });

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const current = state.selectedUser;
  if (!current) return;
  const updated = {
    full_name: $('#profile-full-name').value.trim(),
    matric_number: $('#profile-matric').value.trim() || null,
    email: $('#profile-email').value.trim() || null,
    role: $('#profile-role').value
  };
  if (!window.confirm(`Save profile and role changes for ${current.full_name || current.email || 'this user'}?`)) return;
  const button = event.currentTarget.querySelector('[type="submit"]'); button.disabled = true;
  try {
    const { error } = await supabase.from('profiles').update(updated).eq('id', current.id);
    if (error) throw error;
    await logAction('profile_updated', current.id, { before: { full_name: current.full_name, matric_number: current.matric_number, email: current.email, role: current.role }, after: updated });
    showNotice('Profile changes saved and recorded in the audit log.');
    await loadUsers(); openUser(current.id);
  } catch (error) { showNotice(error.message, 'error'); }
  finally { button.disabled = false; }
});
async function updateStatus(status) {
  const user = state.selectedUser;
  if (!user) return;
  const verb = status === 'muted' ? 'mute' : status === 'suspended' ? 'suspend' : user.status === 'muted' ? 'unmute' : 'unsuspend';
  if (!window.confirm(`Are you sure you want to ${verb} ${user.full_name || user.email || 'this user'}?`)) return;
  try {
    const { error } = await supabase.from('profiles').update({ status }).eq('id', user.id);
    if (error) throw error;
    await logAction(`user_${status}`, user.id, { previous_status: user.status, status });
    showNotice(`User status changed to ${status} and recorded in the audit log.`);
    await loadUsers(); openUser(user.id);
  } catch (error) { showNotice(error.message, 'error'); }
}
async function deleteUser(user) {
  const name = user.full_name || user.email || 'this user';
  if (!window.confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
  if (!window.confirm(`Final confirmation: delete ${name} and their account data now?`)) return;
  const button = [...$('#user-actions').querySelectorAll('button')].find((item) => item.textContent === 'Delete user');
  if (button) { button.disabled = true; button.textContent = 'Deleting…'; }
  try {
    const { data, error } = await supabase.functions.invoke('delete-user', { body: { userId: user.id } });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'The deletion function did not confirm success.');
    state.profiles = state.profiles.filter((profile) => profile.id !== user.id);
    state.selectedUser = null;
    $('#user-detail').hidden = true;
    renderUsers();
    showNotice('User account deleted. The Edge Function recorded the action in the audit log.');
    await loadAudit();
  } catch (error) {
    showNotice(`Could not delete user: ${error.message}`, 'error');
    if (button) { button.disabled = false; button.textContent = 'Delete user'; }
  }
}

async function loadReports() {
  await Promise.all([
    loadRecords('lost_found_items', 'id, title, description, item_type, status, created_at', '#lost-found-list', 'No Lost and Found reports in the database.'),
    loadRecords('student_voice_posts', 'id, title, body, created_at', '#voice-list', 'No Student Voice posts in the database.')
  ]);
}
async function loadRecords(table, columns, selector, emptyMessage) {
  const container = $(selector); container.innerHTML = '<p class="loading">Loading records…</p>';
  const { data, error } = await supabase.from(table).select(columns).order('created_at', { ascending: false }).limit(50);
  if (error) { container.innerHTML = `<p class="empty-state">Could not load records: ${escapeHTML(error.message)}</p>`; return; }
  if (!data?.length) { container.innerHTML = `<p class="empty-state">${escapeHTML(emptyMessage)}</p>`; return; }
  container.innerHTML = data.map((record) => `<article class="record-card"><strong>${escapeHTML(record.title)}</strong><p>${escapeHTML(record.description || record.body || '')}</p><small>${escapeHTML(record.item_type || 'Student Voice')}${record.status ? ` · ${escapeHTML(record.status)}` : ''} · ${escapeHTML(new Date(record.created_at).toLocaleString())}</small></article>`).join('');
}
async function loadAudit() {
  const container = $('#audit-list'); container.innerHTML = '<p class="loading">Loading admin actions…</p>';
  const { data, error } = await supabase.from('audit_logs').select('id, admin_id, action, target_user_id, details, created_at').order('created_at', { ascending: false }).limit(100);
  if (error) { container.innerHTML = `<p class="empty-state">Could not load audit log: ${escapeHTML(error.message)}</p>`; return; }
  if (!data?.length) { container.innerHTML = '<p class="empty-state">No audit records are available.</p>'; return; }
  container.innerHTML = data.map((row) => `<article class="audit-row"><strong>${escapeHTML(row.action)}</strong><code>Admin ${escapeHTML(row.admin_id || 'unknown')}<br />Target ${escapeHTML(row.target_user_id || row.details?.target_user_id || 'none')}<br />${escapeHTML(JSON.stringify(row.details || {}))}</code><time datetime="${escapeHTML(row.created_at)}">${escapeHTML(new Date(row.created_at).toLocaleString())}</time></article>`).join('');
}
$('#refresh-audit').addEventListener('click', loadAudit);
document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', async () => {
  if (!window.confirm('Log out of Campus Connect?')) return;
  const { error } = await supabase.auth.signOut();
  if (error) showNotice(`Could not log out: ${error.message}`, 'error');
  else window.location.replace('../auth.html#login');
}));
themeSelect?.addEventListener('change', () => {
  if (!validThemes.includes(themeSelect.value)) return;
  document.documentElement.dataset.theme = themeSelect.value;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  try { localStorage.setItem('campusconnect-theme', themeSelect.value); } catch { /* Storage may be disabled. */ }
});
try {
  const theme = localStorage.getItem('campusconnect-theme');
  if (validThemes.includes(theme)) { document.documentElement.dataset.theme = theme; if (themeSelect) themeSelect.value = theme; }
} catch { /* Keep the default theme if storage is unavailable. */ }

if (await requireAdmin()) {
  await Promise.all([loadOverview(), loadAudit()]);
  setView('overview');
}
