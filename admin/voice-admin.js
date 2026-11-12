import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const $ = (selector) => document.querySelector(selector);
const voiceList = $('#voice-admin-list');
const notice = $('#admin-notice');
const state = { admin: null, posts: [], profiles: new Map(), busy: false, authorized: false, loaded: false };
const categories = { complaint: 'Complaint', problem: 'Problem', suggestion: 'Suggestion' };
const statuses = { received: 'Received', reviewing: 'Under review', resolved: 'Resolved' };

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function showNotice(text, type = 'info') {
  notice.textContent = text;
  notice.dataset.type = type;
  notice.hidden = !text;
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString();
}

async function writeVoiceAudit(action, post, details = {}) {
  const { error } = await supabase.from('audit_logs').insert({
    admin_id: state.admin.id,
    action,
    target_user_id: post.author_id,
    details: { post_id: post.id, post_title: post.title, ...details }
  });
  if (error) throw new Error(`Action saved, but audit logging failed: ${error.message}`);
}

function renderVoicePosts() {
  const status = $('#voice-status-filter').value;
  const category = $('#voice-category-filter').value;
  const filtered = state.posts.filter((post) => (status === 'all' || post.status === status)
    && (category === 'all' || post.category === category));
  $('#voice-result-count').textContent = `${filtered.length} of ${state.posts.length} posts`;
  if (!filtered.length) {
    voiceList.innerHTML = '<p class="empty-state">No Student Voice posts match these filters.</p>';
    return;
  }
  voiceList.innerHTML = filtered.map((post) => {
    const author = state.profiles.get(post.author_id) || {};
    const name = author.full_name || author.email || 'Name not provided';
    const isSelf = post.author_id === state.admin.id;
    const canMute = author.role !== 'admin' && author.status !== 'muted' && !isSelf;
    return `<article class="voice-admin-card" data-post-id="${escapeHTML(post.id)}">
      <div class="voice-admin-card-head"><div><span class="voice-admin-badge">${escapeHTML(categories[post.category] || post.category)}</span><span class="voice-admin-status" data-status="${escapeHTML(post.status)}">${escapeHTML(statuses[post.status] || post.status)}</span>${post.is_hidden ? '<span class="voice-admin-hidden">Hidden</span>' : ''}</div><time datetime="${escapeHTML(post.created_at)}">${escapeHTML(formatDate(post.created_at))}</time></div>
      <h3>${escapeHTML(post.title)}</h3><p class="voice-admin-message">${escapeHTML(post.message)}</p>
      <p class="voice-admin-author"><strong>Author:</strong> ${escapeHTML(name)}${post.is_anonymous ? ' <span>(posted anonymously to students)</span>' : ''} · <span>${escapeHTML(author.status || 'unknown status')}</span>${author.role === 'admin' ? ' · Admin' : ''}</p>
      <div class="voice-admin-actions">
        <label>Status<select data-voice-status="${escapeHTML(post.id)}"><option value="received" ${post.status === 'received' ? 'selected' : ''}>Received</option><option value="reviewing" ${post.status === 'reviewing' ? 'selected' : ''}>Under review</option><option value="resolved" ${post.status === 'resolved' ? 'selected' : ''}>Resolved</option></select></label>
        <label class="voice-note-label">Status note (optional)<input type="text" maxlength="500" data-voice-note="${escapeHTML(post.id)}" placeholder="Add context for students" /></label>
        <button class="button button-primary" type="button" data-voice-action="status" data-id="${escapeHTML(post.id)}">Update status</button>
        <label class="voice-reply-label">Admin reply<textarea rows="3" maxlength="4000" data-voice-reply="${escapeHTML(post.id)}" placeholder="Write a reply visible to students"></textarea></label>
        <button class="button button-outline" type="button" data-voice-action="reply" data-id="${escapeHTML(post.id)}">Add reply</button>
        <button class="button button-outline" type="button" data-voice-action="visibility" data-id="${escapeHTML(post.id)}">${post.is_hidden ? 'Unhide post' : 'Hide post'}</button>
        <button class="button button-outline" type="button" data-voice-action="mute" data-id="${escapeHTML(post.id)}" ${canMute ? '' : 'disabled'}>${author.status === 'muted' ? 'Author muted' : author.role === 'admin' ? 'Cannot mute admin' : isSelf ? 'Cannot mute yourself' : 'Mute author'}</button>
      </div>
    </article>`;
  }).join('');
}

async function loadVoicePosts() {
  if (!state.authorized || state.busy) return;
  state.loaded = true;
  voiceList.innerHTML = '<p class="loading">Loading Student Voice posts…</p>';
  const { data: posts, error } = await supabase.from('voice_posts_admin')
    .select('id,author_id,category,title,message,is_anonymous,status,is_hidden,created_at')
    .order('created_at', { ascending: false }).limit(500);
  if (error) {
    voiceList.innerHTML = `<p class="empty-state">Could not load Student Voice posts: ${escapeHTML(error.message)}</p>`;
    return;
  }
  state.posts = posts || [];
  const authorIds = [...new Set(state.posts.map((post) => post.author_id).filter(Boolean))];
  state.profiles = new Map();
  if (authorIds.length) {
    const { data: profiles, error: profileError } = await supabase.from('profiles')
      .select('id,full_name,email,status,role').in('id', authorIds);
    if (profileError) {
      voiceList.innerHTML = `<p class="empty-state">Could not load post authors: ${escapeHTML(profileError.message)}</p>`;
      return;
    }
    (profiles || []).forEach((profile) => state.profiles.set(profile.id, profile));
  }
  renderVoicePosts();
}

function setVoiceView() {
  document.querySelectorAll('.admin-view').forEach((view) => {
    const active = view.id === 'view-student-voice';
    view.classList.toggle('is-visible', active);
    view.hidden = !active;
  });
  document.querySelectorAll('[data-view]').forEach((button) => {
    const active = button.dataset.view === 'student-voice';
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  $('#page-title').textContent = 'Student Voice';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (!state.loaded) loadVoicePosts();
}

// The existing dashboard controller handles its established views. Capture this
// new view first so its independent moderation module can keep those flows intact.
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-view="student-voice"]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (state.authorized) setVoiceView();
}, true);

$('#voice-status-filter').addEventListener('change', renderVoicePosts);
$('#voice-category-filter').addEventListener('change', renderVoicePosts);
$('#refresh-voice').addEventListener('click', loadVoicePosts);

async function moderate(action, postId) {
  if (state.busy) return;
  const post = state.posts.find((item) => item.id === postId);
  if (!post) return;
  const author = state.profiles.get(post.author_id) || {};
  const card = voiceList.querySelector(`[data-post-id="${CSS.escape(postId)}"]`);
  if (!card) return;
  let changes;
  let auditAction;
  let auditDetails = {};
  let replyText = '';

  if (action === 'status') {
    const nextStatus = card.querySelector('[data-voice-status]').value;
    const note = card.querySelector('[data-voice-note]').value.trim();
    if (nextStatus === post.status && !note) return;
    if (!window.confirm(`Change “${post.title}” to ${statuses[nextStatus]}${note ? ` and add this note: “${note}”` : ''}?`)) return;
    changes = { status: nextStatus };
    auditAction = 'student_voice_status_changed';
    auditDetails = { previous_status: post.status, status: nextStatus, note: note || null };
  } else if (action === 'visibility') {
    const hidden = !post.is_hidden;
    if (!window.confirm(`${hidden ? 'Hide' : 'Unhide'} “${post.title}”${hidden ? ' from the student feed' : ' so students can see it'}?`)) return;
    changes = { is_hidden: hidden };
    auditAction = hidden ? 'student_voice_post_hidden' : 'student_voice_post_unhidden';
    auditDetails = { is_hidden: hidden };
  } else if (action === 'reply') {
    replyText = card.querySelector('[data-voice-reply]').value.trim();
    if (!replyText) {
      showNotice('Write a reply before submitting.', 'error');
      return;
    }
    if (replyText.length > 4000) {
      showNotice('Replies must be 4,000 characters or fewer.', 'error');
      return;
    }
    if (!window.confirm(`Add this reply to “${post.title}”?\n\n${replyText}`)) return;
    auditAction = 'student_voice_reply_added';
    auditDetails = { reply: replyText };
  } else if (action === 'mute') {
    if (!author.id || author.role === 'admin' || author.status === 'muted' || author.id === state.admin.id) return;
    if (!window.confirm(`Mute ${author.full_name || author.email || 'this author'}? They will no longer be able to post or vote.`)) return;
    auditAction = 'student_voice_author_muted';
    auditDetails = { author_status_before: author.status, author_status_after: 'muted' };
  } else return;

  state.busy = true;
  voiceList.querySelectorAll('button,select,input,textarea').forEach((control) => { control.disabled = true; });
  try {
    if (action === 'reply') {
      const { error } = await supabase.from('voice_replies').insert({ post_id: post.id, author_id: state.admin.id, message: replyText });
      if (error) throw error;
    } else if (action === 'mute') {
      const { data, error } = await supabase.from('profiles').update({ status: 'muted' }).eq('id', post.author_id).eq('status', 'active').select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('The author is no longer active. Refresh the post list and try again.');
    } else {
      const { data, error } = await supabase.from('voice_posts').update(changes).eq('id', post.id).select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('This post could not be updated. Refresh and try again.');
      if (action === 'status') {
        const note = auditDetails.note;
        const { data: history, error: historyError } = await supabase.from('voice_status_history')
          .select('id').eq('post_id', post.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (!historyError && history) {
          const { error: noteError } = await supabase.from('voice_status_history').update({ note }).eq('id', history.id);
          if (noteError) auditDetails.note_update_error = noteError.message;
        } else if (historyError) auditDetails.note_update_error = historyError.message;
      }
    }
    await writeVoiceAudit(auditAction, post, auditDetails);
    showNotice('Student Voice action completed and recorded in the audit log.');
    await Promise.all([loadVoicePosts(), document.querySelector('#view-audit').hidden ? Promise.resolve() : $('#refresh-audit').click()]);
  } catch (error) {
    showNotice(error.message || 'Could not complete the Student Voice action.', 'error');
    await loadVoicePosts();
  } finally {
    state.busy = false;
  }
}

voiceList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-voice-action]');
  if (button) moderate(button.dataset.voiceAction, button.dataset.id);
});

async function initializeVoiceAdmin() {
  if (!isSupabaseConfigured || !supabase) return;
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) return;
    const { data: profile, error } = await supabase.from('profiles').select('id,role,status').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    if (!profile || profile.role !== 'admin' || profile.status !== 'active') return;
    state.admin = profile;
    state.authorized = true;
    if (!$('#view-student-voice').hidden) loadVoicePosts();
  } catch (error) {
    showNotice(`Could not load Student Voice moderation: ${error.message || String(error)}`, 'error');
  }
}

initializeVoiceAdmin();
