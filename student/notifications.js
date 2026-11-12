import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const list = $('#notification-list');
const unreadCount = $('#unread-count');
const notice = $('#notice');
const MAX_ROWS = 500;
let userId = null;
let refreshTimer;

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.dataset.type = isError ? 'error' : 'success';
  notice.hidden = false;
}
function formatDate(value) {
  return new Date(value).toLocaleString();
}

async function getVisibleNotifications() {
  const { data: notifications, error } = await supabase.from('notifications')
    .select('id, user_id, title, message, type, read_at, created_at')
    .order('created_at', { ascending: false }).limit(MAX_ROWS);
  if (error) throw error;
  const broadcasts = (notifications || []).filter((row) => row.user_id === null);
  const broadcastIds = broadcasts.map((row) => row.id);
  let receipts = [];
  if (broadcastIds.length) {
    const result = await supabase.from('notification_reads')
      .select('notification_id, read_at').eq('user_id', userId).in('notification_id', broadcastIds);
    if (result.error) throw result.error;
    receipts = result.data || [];
  }
  const readAtById = new Map(receipts.map((receipt) => [receipt.notification_id, receipt.read_at]));
  return (notifications || []).map((row) => ({
    ...row,
    effective_read_at: row.user_id === null ? (readAtById.get(row.id) || null) : row.read_at
  }));
}

function renderNotifications(rows) {
  const unread = rows.filter((row) => !row.effective_read_at).length;
  unreadCount.textContent = unread > 99 ? '99+' : String(unread);
  unreadCount.setAttribute('aria-label', `${unread} unread notifications`);
  if (!rows.length) {
    list.innerHTML = '<p class="empty-state">You’re all caught up. New updates will appear here.</p>';
    return;
  }
  list.innerHTML = rows.map((row) => `
    <article class="notification-card${row.effective_read_at ? '' : ' is-unread'}">
      <div class="notification-copy"><span class="type-label">${escapeHTML(String(row.type || 'update').replaceAll('_', ' '))}</span>
        <h2>${escapeHTML(row.title)}</h2><p>${escapeHTML(row.message)}</p><time datetime="${escapeHTML(row.created_at)}">${escapeHTML(formatDate(row.created_at))}</time></div>
      ${row.effective_read_at ? '<span class="read-label">Read</span>' : `<button class="button mark-read" type="button" data-notification-id="${escapeHTML(row.id)}" data-broadcast="${row.user_id === null}">Mark as read</button>`}
    </article>`).join('');
}

async function refresh() {
  try {
    renderNotifications(await getVisibleNotifications());
  } catch (error) {
    list.innerHTML = `<p class="empty-state">Could not load notifications: ${escapeHTML(error.message)}</p>`;
  }
}

async function markRead(id, isBroadcast) {
  if (isBroadcast) {
    const { error } = await supabase.from('notification_reads').upsert({
      notification_id: id, user_id: userId
    }, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId).is('read_at', null);
    if (error) throw error;
  }
}

list.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-notification-id]');
  if (!button) return;
  button.disabled = true;
  try {
    await markRead(button.dataset.notificationId, button.dataset.broadcast === 'true');
    await refresh();
  } catch (error) {
    button.disabled = false;
    showNotice(error.message, true);
  }
});

$('#mark-all-read').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const rows = await getVisibleNotifications();
    const directIds = rows.filter((row) => row.user_id === userId && !row.read_at).map((row) => row.id);
    const broadcastIds = rows.filter((row) => row.user_id === null && !row.effective_read_at).map((row) => row.id);
    if (directIds.length) {
      const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() })
        .eq('user_id', userId).in('id', directIds).is('read_at', null);
      if (error) throw error;
    }
    if (broadcastIds.length) {
      const { error } = await supabase.from('notification_reads').upsert(
        broadcastIds.map((notification_id) => ({ notification_id, user_id: userId })),
        { onConflict: 'notification_id,user_id', ignoreDuplicates: true }
      );
      if (error) throw error;
    }
    await refresh();
    showNotice('All notifications marked as read.');
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function init() {
  if (!isSupabaseConfigured || !supabase) {
    showNotice('Supabase is not configured.', true);
    list.replaceChildren();
    return;
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) {
    window.location.replace('../auth.html#login');
    return;
  }
  userId = session.user.id;
  await refresh();

  // RLS limits events to this user's direct notifications and visible broadcasts.
  const channel = supabase.channel(`notifications-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refresh, 120);
    })
    .subscribe();
  window.addEventListener('pagehide', () => { supabase.removeChannel(channel); });
}

init();
