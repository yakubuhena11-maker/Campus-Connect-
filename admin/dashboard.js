import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const notice = $('#admin-notice');
const navButtons = [...document.querySelectorAll('[data-view]')];
const views = [...document.querySelectorAll('.admin-view')];
const state = { admin: null, profiles: [], selectedUser: null, saving: false };

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
  const selected = ['overview', 'users', 'audit'].includes(view) ? view : 'overview';
  views.forEach((section) => {
    const active = section.id === `view-${selected}`;
    section.classList.toggle('is-visible', active);
    section.hidden = !active;
  });
  navButtons.forEach((button) => {
    const active = button.dataset.view === selected;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#page-title').textContent = selected === 'audit' ? 'Audit log' : selected[0].toUpperCase() + selected.slice(1);
  if (selected === 'overview') loadOverview();
  if (selected === 'users') loadUsers();
  if (selected === 'audit') loadAudit();
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
      .select('id, full_name, email, role, status')
      .eq('id', session.user.id)
      .maybeSingle();
    if (error) {
      showNotice(`Could not verify admin access: ${error.message}`, 'error');
      return false;
    }
    if (!profile || profile.role !== 'admin' || profile.status !== 'active') {
      window.location.replace('../student/dashboard.html');
      return false;
    }
    state.admin = profile;
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
    <button class="user-row" type="button" data-user-id="${escapeHTML(profile.id)}">
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
    </button>
  `).join('') : '<p class="empty-state">No users match these filters.</p>';
}

$('#users-list').addEventListener('click', (event) => {
  const row = event.target.closest('[data-user-id]');
  if (row) openUser(row.dataset.userId);
});
$('#user-search').addEventListener('input', renderUsers);
$('#status-filter').addEventListener('change', renderUsers);
$('#close-detail').addEventListener('click', () => {
  $('#user-detail').hidden = true;
  state.selectedUser = null;
});

function openUser(id) {
  const user = state.profiles.find((profile) => profile.id === id);
  if (!user) return;
  state.selectedUser = user;
  $('#detail-heading').textContent = user.full_name || 'User details';
  $('#detail-email').textContent = user.email || 'No email on file';
  $('#profile-full-name').value = user.full_name || '';
  $('#profile-matric').value = user.matric_number || '';
  $('#profile-role').value = user.role;
  const isSelf = user.id === state.admin.id;
  $('#profile-role').disabled = isSelf;
  $('#save-role').disabled = isSelf;
  $('#account-actions').replaceChildren();

  const addActionButton = (text, nextStatus, action) => {
    const button = document.createElement('button');
    button.className = 'button button-outline';
    button.type = 'button';
    button.textContent = text;
    button.disabled = isSelf;
    button.addEventListener('click', () => updateUser(user, { status: nextStatus }, action));
    $('#account-actions').append(button);
  };

  addActionButton(user.status === 'muted' ? 'Unmute user' : 'Mute user',
    user.status === 'muted' ? 'active' : 'muted',
    user.status === 'muted' ? 'user_unmuted' : 'user_muted');
  addActionButton(user.status === 'suspended' ? 'Unsuspend user' : 'Suspend user',
    user.status === 'suspended' ? 'active' : 'suspended',
    user.status === 'suspended' ? 'user_unsuspended' : 'user_suspended');

  $('#user-detail').hidden = false;
  $('#user-detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function writeAudit(action, targetUserId, details) {
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: state.admin.id,
    action,
    target_user_id: targetUserId,
    details
  });
  if (error) throw new Error(`Profile updated, but audit logging failed: ${error.message}`);
}

function setActionPending(pending) {
  state.saving = pending;
  $('#profile-form button[type="submit"]').disabled = pending;
  $('#save-role').disabled = pending || state.selectedUser?.id === state.admin.id;
  $('#account-actions').querySelectorAll('button').forEach((button) => {
    button.disabled = pending || state.selectedUser?.id === state.admin.id;
  });
}

async function updateUser(user, changes, action) {
  if (!user || state.saving || (user.id === state.admin.id && ('role' in changes || 'status' in changes))) return;
  const label = action.replaceAll('_', ' ');
  if (!window.confirm(`Confirm ${label} for ${user.full_name || user.email || 'this user'}?`)) return;

  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, user[key]]));
  setActionPending(true);
  try {
    const { error } = await supabase.from('profiles').update(changes).eq('id', user.id);
    if (error) throw error;
    await writeAudit(action, user.id, { before, after: changes });
    showNotice('Change saved and recorded in the audit log.');
    $('#user-detail').hidden = true;
    state.selectedUser = null;
    await Promise.all([loadUsers(), loadOverview(), loadAudit()]);
  } catch (error) {
    showNotice(error.message || 'Could not save this change.', 'error');
  } finally {
    setActionPending(false);
  }
}

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const user = state.selectedUser;
  if (!user) return;
  const changes = {
    full_name: $('#profile-full-name').value.trim(),
    matric_number: $('#profile-matric').value.trim() || null
  };
  if (!changes.full_name) {
    $('#profile-full-name').focus();
    return;
  }
  if (changes.full_name === user.full_name && changes.matric_number === user.matric_number) {
    showNotice('No profile details have changed.');
    return;
  }
  await updateUser(user, changes, 'profile_details_updated');
});

$('#save-role').addEventListener('click', async () => {
  const user = state.selectedUser;
  if (!user || user.id === state.admin.id) return;
  const role = $('#profile-role').value;
  if (!['student', 'admin'].includes(role) || role === user.role) return;
  await updateUser(user, { role }, 'user_role_changed');
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

async function loadAudit() {
  const list = $('#audit-list');
  list.innerHTML = '<p class="loading">Loading admin actions…</p>';
  const { data, error } = await supabase.from('audit_logs')
    .select('id, admin_id, action, target_user_id, details, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    list.innerHTML = `<p class="empty-state">Could not load audit log: ${escapeHTML(error.message)}</p>`;
    return;
  }
  if (!data?.length) {
    list.innerHTML = '<p class="empty-state">No admin actions have been recorded.</p>';
    return;
  }
  list.innerHTML = data.map((entry) => `
    <article class="audit-row">
      <strong>${escapeHTML((entry.action || 'action').replaceAll('_', ' '))}</strong>
      <p>Admin ${escapeHTML(entry.admin_id || 'unknown')} · Target ${escapeHTML(entry.target_user_id || 'none')}</p>
      <p>${escapeHTML(JSON.stringify(entry.details || {}))}</p>
      <time datetime="${escapeHTML(entry.created_at)}">${escapeHTML(formatDate(entry.created_at))}</time>
    </article>
  `).join('');
}

$('#refresh-audit').addEventListener('click', loadAudit);
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
  await Promise.all([loadOverview(), loadAudit()]);
  setView('overview');
}
