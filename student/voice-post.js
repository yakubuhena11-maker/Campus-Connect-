import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const message = document.querySelector('#voice-message');
const postContent = document.querySelector('#post-content');
const timeline = document.querySelector('#voice-timeline');
const repliesContainer = document.querySelector('#voice-replies');
const categoryLabels = { complaint: 'Complaint', problem: 'Problem', suggestion: 'Suggestion' };
const statusLabels = { received: 'Received', reviewing: 'Under review', resolved: 'Resolved' };
function showMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatDate(value, withTime = false) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date);
}
async function loadPost() {
  if (!isSupabaseConfigured || !supabase) {
    showMessage('Supabase is not configured. Please contact your campus administrator.', 'error');
    postContent.innerHTML = '';
    return;
  }
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) showMessage(sessionError.message, 'error');
  if (!session) {
    showMessage('Please sign in to view this post.', 'error');
    postContent.innerHTML = '';
    return;
  }
  const postId = new URLSearchParams(window.location.search).get('id');
  if (!postId) {
    showMessage('This post link is missing its ID.', 'error');
    postContent.innerHTML = '';
    return;
  }
  const { data: post, error } = await supabase.from('voice_posts_public')
    .select('id,category,title,message,status,created_at,upvote_count,author_full_name').eq('id', postId).maybeSingle();
  if (error) {
    showMessage(error.message, 'error');
    postContent.innerHTML = '';
    return;
  }
  if (!post) {
    showMessage('This post is unavailable or has been removed.', 'error');
    postContent.innerHTML = '';
    return;
  }
  document.title = `${post.title} — Student Voice`;
  postContent.innerHTML = `<div class="post-meta-top"><span class="voice-badge">${escapeHTML(categoryLabels[post.category] || post.category)}</span><span class="voice-status">${escapeHTML(statusLabels[post.status] || post.status)}</span></div>
    <h1>${escapeHTML(post.title)}</h1><p class="post-byline">${escapeHTML(post.author_full_name || 'Anonymous')} · <time datetime="${escapeHTML(post.created_at)}">${escapeHTML(formatDate(post.created_at, true))}</time> · ${Number(post.upvote_count) || 0} upvotes</p>
    <p class="post-message">${escapeHTML(post.message)}</p>`;

  const [{ data: history, error: historyError }, { data: replies, error: replyError }] = await Promise.all([
    supabase.from('voice_status_history').select('status,note,created_at').eq('post_id', postId).order('created_at', { ascending: true }),
    supabase.from('voice_replies').select('message,created_at').eq('post_id', postId).order('created_at', { ascending: true })
  ]);
  if (historyError) showMessage(historyError.message, 'error');
  if (replyError) showMessage(replyError.message, 'error');
  timeline.innerHTML = historyError ? '' : (history || []).map((item) => `<li class="timeline-item"><span class="timeline-dot" aria-hidden="true"></span><div><strong>${escapeHTML(statusLabels[item.status] || item.status)}</strong><time datetime="${escapeHTML(item.created_at)}">${escapeHTML(formatDate(item.created_at, true))}</time>${item.note ? `<span class="timeline-note">${escapeHTML(item.note)}</span>` : ''}</div></li>`).join('');
  if (!historyError && !(history || []).length) timeline.innerHTML = '<li class="voice-empty">No status updates yet.</li>';
  repliesContainer.innerHTML = replyError ? '' : (replies || []).map((reply) => `<article class="voice-reply"><p>${escapeHTML(reply.message)}</p><time datetime="${escapeHTML(reply.created_at)}">${escapeHTML(formatDate(reply.created_at, true))}</time></article>`).join('');
  if (!replyError && !(replies || []).length) repliesContainer.innerHTML = '<div class="voice-empty">No replies yet. The campus team will post updates here.</div>';
}
loadPost();
