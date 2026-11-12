import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const feed = document.querySelector('#voice-feed');
const message = document.querySelector('#voice-message');
const search = document.querySelector('#voice-search');
const categoryFilter = document.querySelector('#category-filter');
const statusFilter = document.querySelector('#status-filter');
const communityTab = document.querySelector('#tab-community');
const mineTab = document.querySelector('#tab-mine');
let currentUser = null;
let activeTab = 'community';
let posts = [];
let votes = new Set();
const categories = { complaint: 'Complaint', problem: 'Problem', suggestion: 'Suggestion' };
const statuses = { received: 'Received', reviewing: 'Under review', resolved: 'Resolved' };

function showMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}
function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}
function render() {
  const term = search.value.trim().toLocaleLowerCase();
  const category = categoryFilter.value;
  const status = statusFilter.value;
  const visible = posts.filter((post) => (!category || post.category === category)
    && (!status || post.status === status)
    && (!term || `${post.title} ${post.message} ${post.author_full_name || ''}`.toLocaleLowerCase().includes(term)));
  if (!visible.length) {
    feed.innerHTML = `<div class="voice-empty"><strong>${activeTab === 'mine' ? 'No posts yet' : 'No posts match'}</strong>${activeTab === 'mine' ? 'Your submissions will appear here.' : 'Try a different search or filter.'}</div>`;
    return;
  }
  feed.innerHTML = visible.map((post) => {
    const title = escapeHTML(post.title);
    const preview = escapeHTML(post.message.length > 230 ? `${post.message.slice(0, 230).trimEnd()}…` : post.message);
    const author = activeTab === 'mine' ? 'You' : (post.author_full_name || 'Anonymous');
    const voted = votes.has(post.id);
    const count = Number(post.upvote_count) || 0;
    return `<article class="voice-card">
      <div class="voice-card-top"><span class="voice-badge">${escapeHTML(categories[post.category] || post.category)}</span><span class="voice-status">${escapeHTML(statuses[post.status] || post.status)}</span></div>
      <h2 class="voice-card-title"><a href="voice-post.html?id=${encodeURIComponent(post.id)}">${title}</a></h2>
      <p class="voice-card-preview">${preview}</p>
      <div class="voice-card-meta"><span class="voice-card-author">${escapeHTML(author)} · <time datetime="${escapeHTML(post.created_at)}">${escapeHTML(formatDate(post.created_at))}</time></span>
      <button class="voice-upvote" type="button" data-vote="${escapeHTML(post.id)}" aria-pressed="${voted}" aria-label="${voted ? 'Remove upvote' : 'Upvote'} — ${count} votes"><span aria-hidden="true">▲</span><span>${count}</span></button></div>
    </article>`;
  }).join('');
}
async function loadPosts() {
  showMessage('');
  feed.innerHTML = '<div class="voice-empty">Loading posts…</div>';
  const table = activeTab === 'mine' ? 'voice_posts_mine' : 'voice_posts_public';
  const fields = activeTab === 'mine' ? 'id,category,title,message,is_anonymous,status,created_at' : 'id,category,title,message,status,created_at,upvote_count,author_full_name';
  const { data, error } = await supabase.from(table).select(fields).order('created_at', { ascending: false });
  if (error) {
    posts = [];
    feed.innerHTML = '';
    showMessage(error.message, 'error');
    return;
  }
  posts = data || [];
  if (activeTab === 'mine') posts = posts.map((post) => ({ ...post, upvote_count: 0, author_full_name: 'You' }));
  const ids = posts.map((post) => post.id);
  votes = new Set();
  if (activeTab === 'community' && ids.length) {
    const { data: userVotes, error: voteError } = await supabase.from('voice_votes').select('post_id').eq('user_id', currentUser.id).in('post_id', ids);
    if (voteError) showMessage(voteError.message, 'error');
    else votes = new Set((userVotes || []).map((vote) => vote.post_id));
  }
  render();
}
async function toggleVote(button) {
  const postId = button.dataset.vote;
  const wasVoted = votes.has(postId);
  button.disabled = true;
  const result = wasVoted
    ? await supabase.from('voice_votes').delete().eq('post_id', postId).eq('user_id', currentUser.id)
    : await supabase.from('voice_votes').insert({ post_id: postId, user_id: currentUser.id });
  button.disabled = false;
  if (result.error) {
    showMessage(result.error.message, 'error');
    return;
  }
  await loadPosts();
}
feed.addEventListener('click', (event) => {
  const button = event.target.closest('[data-vote]');
  if (button) toggleVote(button);
});
[search, categoryFilter, statusFilter].forEach((input) => input.addEventListener('input', render));
function setTab(tab) {
  activeTab = tab;
  communityTab.classList.toggle('is-active', tab === 'community');
  mineTab.classList.toggle('is-active', tab === 'mine');
  communityTab.setAttribute('aria-selected', String(tab === 'community'));
  mineTab.setAttribute('aria-selected', String(tab === 'mine'));
  categoryFilter.value = '';
  statusFilter.value = '';
  search.value = '';
  loadPosts();
}
communityTab.addEventListener('click', () => setTab('community'));
mineTab.addEventListener('click', () => setTab('mine'));
async function initialize() {
  if (!isSupabaseConfigured || !supabase) {
    showMessage('Supabase is not configured. Please contact your campus administrator.', 'error');
    return;
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) showMessage(error.message, 'error');
  if (!session) {
    showMessage('Please sign in to view Student Voice.', 'error');
    return;
  }
  currentUser = session.user;
  await loadPosts();
}
initialize();
