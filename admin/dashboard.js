import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const notice = $('#admin-notice');
const navButtons = [...document.querySelectorAll('[data-view]')];
const views = [...document.querySelectorAll('.admin-view')];
const state = {
  admin: null,
  profiles: [],
  selectedUser: null,
  saving: false,
  lostFoundBusy: false,
  lostFoundItems: [],
  lostFoundClaims: []
};

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
  const allowedViews = ['overview', 'users', 'audit', 'lost-found'];
  const selected = allowedViews.includes(view) ? view : 'overview';
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
  const title = selected === 'lost-found' ? 'Lost and Found' : selected === 'audit' ? 'Audit log' : selected;
  $('#page-title').textContent = title[0].toUpperCase() + title.slice(1);
  if (selected === 'overview') loadOverview();
  if (selected === 'users') loadUsers();
  if (selected === 'audit') loadAudit();
  if (selected === 'lost-found') loadLostFound();
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
  $('#delete-user').disabled = isSelf || user.role === 'admin' || !user.matric_number;
  $('#delete-user').title = !user.matric_number ? 'A matric number is required to confirm deletion.' : '';
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
  if (error) throw new Error(`Change saved, but audit logging failed: ${error.message}`);
}

function setActionPending(pending) {
  state.saving = pending;
  $('#profile-form button[type="submit"]').disabled = pending;
  $('#save-role').disabled = pending || state.selectedUser?.id === state.admin.id;
  $('#delete-user').disabled = pending || state.selectedUser?.id === state.admin.id
    || state.selectedUser?.role === 'admin' || !state.selectedUser?.matric_number;
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

async function deleteUser() {
  const user = state.selectedUser;
  if (!user || state.saving) return;
  if (user.id === state.admin.id || user.role === 'admin') {
    showNotice('You cannot delete your own account or another admin account.', 'error');
    return;
  }
  const matricNumber = String(user.matric_number || '').trim();
  if (!matricNumber) {
    showNotice('This user has no matric number, so deletion cannot be confirmed.', 'error');
    return;
  }
  if (!window.confirm(`Permanently delete ${user.full_name || user.email || 'this user'}? This cannot be undone.`)) return;
  const typedMatricNumber = window.prompt(`To confirm deletion, type this user's matric number exactly:\n\n${matricNumber}`);
  if (typedMatricNumber === null || typedMatricNumber.trim() !== matricNumber) {
    showNotice('Deletion cancelled: the matric number did not match.');
    return;
  }
  if (!window.confirm('Final confirmation: delete this account and its profile now?')) return;

  setActionPending(true);
  try {
    const { data, error } = await supabase.functions.invoke('delete-user', {
      body: { userId: user.id }
    });
    if (error) {
      let message = error.message || 'The deletion function returned an error.';
      try {
        const response = error.context instanceof Response ? await error.context.json() : null;
        if (response?.error) message = response.error;
      } catch {
        // Keep the Functions client's readable error message.
      }
      throw new Error(message);
    }
    if (!data?.success) throw new Error(data?.error || 'The account could not be deleted.');
    showNotice('User account deleted and recorded in the audit log.');
    $('#user-detail').hidden = true;
    state.selectedUser = null;
    await Promise.all([loadUsers(), loadOverview(), loadAudit()]);
  } catch (error) {
    showNotice(error.message || 'Could not delete this account.', 'error');
  } finally {
    setActionPending(false);
  }
}

$('#delete-user').addEventListener('click', deleteUser);

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

async function signedImageUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('lost-found').createSignedUrl(path, 3600);
  return error ? null : data?.signedUrl || null;
}

function itemDetails(item) {
  return `
    <p class="lost-found-meta">${escapeHTML(item.type)} · ${escapeHTML(item.category)} · ${escapeHTML(item.location)}</p>
    <p>${escapeHTML(item.description || 'No description provided.')}</p>
    <p class="lost-found-meta">Date: ${escapeHTML(item.date_occurred || 'Unknown')} · Posted ${escapeHTML(formatDate(item.created_at))}</p>
    <p class="lost-found-meta">Submitted by ${escapeHTML(item.owner?.full_name || item.owner?.email || 'Unknown user')}</p>
  `;
}

async function renderPendingItems(items) {
  const list = $('#pending-items-list');
  if (!items.length) {
    list.innerHTML = '<p class="empty-state">There are no pending lost or found items.</p>';
    return;
  }
  const cards = await Promise.all(items.map(async (item) => {
    const imageUrl = await signedImageUrl(item.image_path);
    const photo = imageUrl
      ? `<img class="lost-found-photo" src="${escapeHTML(imageUrl)}" alt="Photo for ${escapeHTML(item.title)}" loading="lazy" />`
      : '<div class="lost-found-photo-placeholder" role="img" aria-label="No photo available">No photo available</div>';
    return `
      <article class="lost-found-card">
        ${photo}
        <div class="lost-found-card-content">
          <span class="badge" data-status="pending">Pending ${escapeHTML(item.type)}</span>
          <h3>${escapeHTML(item.title)}</h3>
          ${itemDetails(item)}
          <div class="lost-found-actions">
            <button class="button button-primary" type="button" data-lf-action="approve-item" data-id="${escapeHTML(item.id)}">Approve</button>
            <button class="button button-outline" type="button" data-lf-action="reject-item" data-id="${escapeHTML(item.id)}">Reject</button>
          </div>
        </div>
      </article>
    `;
  }));
  list.innerHTML = cards.join('');
}

async function renderPendingClaims(claims) {
  const list = $('#pending-claims-list');
  if (!claims.length) {
    list.innerHTML = '<p class="empty-state">There are no pending claims.</p>';
    return;
  }
  const cards = await Promise.all(claims.map(async (claim) => {
    const item = claim.item || {};
    const imageUrl = await signedImageUrl(item.image_path);
    const photo = imageUrl
      ? `<img class="lost-found-photo" src="${escapeHTML(imageUrl)}" alt="Photo for ${escapeHTML(item.title || 'claimed item')}" loading="lazy" />`
      : '<div class="lost-found-photo-placeholder" role="img" aria-label="No photo available">No photo available</div>';
    return `
      <article class="lost-found-card claim-card">
        ${photo}
        <div class="lost-found-card-content">
          <span class="badge" data-status="pending">Pending claim</span>
          <h3>${escapeHTML(item.title || 'Item unavailable')}</h3>
          <p class="lost-found-meta">${escapeHTML(item.type || 'Item')} · ${escapeHTML(item.location || 'Location not provided')}</p>
          <p><strong>Claimant:</strong> ${escapeHTML(claim.claimant?.full_name || claim.claimant?.email || 'Unknown user')}</p>
          <p><strong>Message:</strong> ${escapeHTML(claim.message || 'No message provided.')}</p>
          <p class="lost-found-meta">Submitted ${escapeHTML(formatDate(claim.created_at))}</p>
          <div class="lost-found-actions">
            <button class="button button-primary" type="button" data-lf-action="approve-claim" data-id="${escapeHTML(claim.id)}">Approve</button>
            <button class="button button-outline" type="button" data-lf-action="reject-claim" data-id="${escapeHTML(claim.id)}">Reject</button>
          </div>
        </div>
      </article>
    `;
  }));
  list.innerHTML = cards.join('');
}

async function loadLostFound() {
  const itemsList = $('#pending-items-list');
  const claimsList = $('#pending-claims-list');
  itemsList.innerHTML = '<p class="loading">Loading pending items…</p>';
  claimsList.innerHTML = '<p class="loading">Loading pending claims…</p>';

  const [itemsResult, claimsResult] = await Promise.all([
    supabase.from('lost_found_items')
      .select('id, owner_id, type, title, description, category, location, date_occurred, image_path, status, created_at, owner:profiles!lost_found_items_owner_id_fkey(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
    supabase.from('lost_found_claims')
      .select('id, item_id, claimant_id, message, status, created_at, item:lost_found_items!lost_found_claims_item_id_fkey(id, title, type, owner_id, status, image_path, location), claimant:profiles!lost_found_claims_claimant_id_fkey(full_name, email)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
  ]);

  if (itemsResult.error) {
    itemsList.innerHTML = `<p class="empty-state">Could not load pending items: ${escapeHTML(itemsResult.error.message)}</p>`;
  } else {
    state.lostFoundItems = itemsResult.data || [];
    await renderPendingItems(state.lostFoundItems);
  }
  if (claimsResult.error) {
    claimsList.innerHTML = `<p class="empty-state">Could not load claims: ${escapeHTML(claimsResult.error.message)}</p>`;
  } else {
    state.lostFoundClaims = claimsResult.data || [];
    await renderPendingClaims(state.lostFoundClaims);
  }
}

async function reviewLostFound(action, id) {
  if (state.lostFoundBusy) return;
  const approving = action.startsWith('approve');
  const isClaim = action.endsWith('claim');
  const record = isClaim
    ? state.lostFoundClaims.find((claim) => claim.id === id)
    : state.lostFoundItems.find((item) => item.id === id);
  if (!record) return;
  const subject = isClaim ? `the claim for “${record.item?.title || 'this item'}”` : `“${record.title}”`;
  const decision = approving ? 'approved' : 'rejected';
  if (!window.confirm(`Are you sure you want to ${decision} ${subject}?`)) return;

  state.lostFoundBusy = true;
  $('#lost-found-view').querySelectorAll('button[data-lf-action]').forEach((button) => { button.disabled = true; });
  const actionName = `lost_found_${isClaim ? 'claim' : 'item'}_${decision}`;
  const targetUserId = isClaim ? record.claimant_id : record.owner_id;
  try {
    if (!isClaim) {
      const { data, error } = await supabase.from('lost_found_items')
        .update({ status: decision })
        .eq('id', record.id)
        .eq('status', 'pending')
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This item is no longer pending. Refresh and try again.');
    } else {
      const item = record.item;
      if (approving) {
        if (!item || item.status !== 'approved') throw new Error('Only claims on approved items can be approved.');
        const { data: itemUpdated, error: itemError } = await supabase.from('lost_found_items')
          .update({ status: 'claimed' })
          .eq('id', record.item_id)
          .eq('status', 'approved')
          .select('id').maybeSingle();
        if (itemError) throw itemError;
        if (!itemUpdated) throw new Error('This item is no longer available to claim. Refresh and try again.');
      }
      const { data, error } = await supabase.from('lost_found_claims')
        .update({ status: decision })
        .eq('id', record.id)
        .eq('status', 'pending')
        .select('id').maybeSingle();
      if (error || !data) {
        if (approving) {
          const { error: rollbackError } = await supabase.from('lost_found_items')
            .update({ status: 'approved' }).eq('id', record.item_id).eq('status', 'claimed');
          if (rollbackError) console.error('Could not restore item status after claim update failure:', rollbackError.message);
        }
        if (error) throw error;
        throw new Error('This claim is no longer pending. Refresh and try again.');
      }
    }

    await writeAudit(actionName, targetUserId, {
      item_id: isClaim ? record.item_id : record.id,
      item_title: isClaim ? record.item?.title : record.title,
      claim_id: isClaim ? record.id : null,
      decision,
      item_status_after: isClaim && approving ? 'claimed' : undefined
    });
    showNotice(`${isClaim ? 'Claim' : 'Item'} ${decision} and recorded in the audit log.`);
    await Promise.all([loadLostFound(), loadAudit()]);
  } catch (error) {
    showNotice(error.message || `Could not ${decision} this ${isClaim ? 'claim' : 'item'}.`, 'error');
    await loadLostFound();
  } finally {
    state.lostFoundBusy = false;
  }
}

$('#lost-found-view').addEventListener('click', (event) => {
  const button = event.target.closest('[data-lf-action]');
  if (button) reviewLostFound(button.dataset.lfAction, button.dataset.id);
});
$('#refresh-lost-found').addEventListener('click', loadLostFound);

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
