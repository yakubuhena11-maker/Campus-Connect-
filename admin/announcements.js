import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const form = $('#announcement-form');
const notice = $('#notice');
const announcementList = $('#announcement-list');

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function announce(message, isError = false) {
  notice.textContent = message;
  notice.dataset.type = isError ? 'error' : 'success';
  notice.hidden = false;
}

async function requireAdmin() {
  if (!isSupabaseConfigured || !supabase) {
    announce('Supabase is not configured.', true);
    form.hidden = true;
    return false;
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) {
    window.location.replace('../auth.html#login');
    return false;
  }
  const { data: profile, error } = await supabase.from('profiles')
    .select('role, status').eq('id', session.user.id).maybeSingle();
  if (error || profile?.role !== 'admin' || profile?.status !== 'active') {
    announce('Only an active admin can send announcements.', true);
    form.hidden = true;
    return false;
  }
  return true;
}

async function loadAnnouncements() {
  const { data, error } = await supabase.from('notifications')
    .select('id, title, message, created_at').is('user_id', null)
    .eq('type', 'announcement').order('created_at', { ascending: false }).limit(50);
  if (error) {
    announcementList.innerHTML = `<p class="empty-state">Could not load announcements: ${escapeHTML(error.message)}</p>`;
    return;
  }
  announcementList.innerHTML = data?.length ? data.map((item) => `
    <article class="notification-card"><div class="notification-copy"><h3>${escapeHTML(item.title)}</h3>
      <p>${escapeHTML(item.message)}</p><time datetime="${escapeHTML(item.created_at)}">${escapeHTML(new Date(item.created_at).toLocaleString())}</time></div></article>`).join('')
    : '<p class="empty-state">No announcements have been sent yet.</p>';
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  const title = form.elements.title.value.trim();
  const message = form.elements.message.value.trim();
  if (!title || !message) {
    announce('Enter both a title and a message.', true);
    return;
  }
  button.disabled = true;
  try {
    // Database RLS independently verifies admin role and requires user_id IS NULL.
    const { error } = await supabase.from('notifications').insert({
      user_id: null, title, message, type: 'announcement'
    });
    if (error) throw error;
    form.reset();
    announce('Announcement sent to all students.');
    await loadAnnouncements();
  } catch (error) {
    announce(error.message || 'Could not send this announcement.', true);
  } finally {
    button.disabled = false;
  }
});

if (await requireAdmin()) await loadAnnouncements();
