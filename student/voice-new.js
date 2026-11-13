import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const form = document.querySelector('#voice-form');
const message = document.querySelector('#voice-message');
const submit = document.querySelector('#submit-post');
const anonymousToggle = document.querySelector('#anonymous');

function showMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}

// Anonymous only makes sense for public posts: admins always see who sent a private post.
function syncAnonymous() {
  const isPrivate = form.querySelector('input[name="visibility"]:checked')?.value === 'private';
  if (anonymousToggle) {
    if (isPrivate) anonymousToggle.checked = false;
    anonymousToggle.disabled = isPrivate;
  }
}
form.querySelectorAll('input[name="visibility"]').forEach((radio) => radio.addEventListener('change', syncAnonymous));
syncAnonymous();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const category = String(formData.get('category') || '');
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('message') || '').trim();
  const visibility = String(formData.get('visibility') || 'public');
  if (title.length < 5 || title.length > 120) {
    showMessage('Title must be between 5 and 120 characters.', 'error');
    return;
  }
  if (body.length < 20 || body.length > 2000) {
    showMessage('Message must be between 20 and 2,000 characters.', 'error');
    return;
  }
  if (!['complaint', 'problem', 'suggestion'].includes(category)) {
    showMessage('Choose a valid category.', 'error');
    return;
  }
  if (!['public', 'private'].includes(visibility)) {
    showMessage('Choose who can see this post.', 'error');
    return;
  }
  if (!isSupabaseConfigured || !supabase) {
    showMessage('Supabase is not configured. Please contact your campus administrator.', 'error');
    return;
  }
  submit.disabled = true;
  submit.textContent = 'Submitting…';
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session) throw new Error('Your session has expired. Please sign in again.');
    const { data, error } = await supabase.from('voice_posts').insert({
      author_id: session.user.id,
      category,
      title,
      message: body,
      is_anonymous: visibility === 'public' && formData.get('is_anonymous') === 'on',
      visibility,
      status: 'received',
      is_hidden: false
    }).select('id').single();
    if (error) throw error;
    // Private posts are not in the community feed, so go back to the main page.
    window.location.href = visibility === 'private'
      ? 'voice.html'
      : `voice-post.html?id=${encodeURIComponent(data.id)}`;
  } catch (error) {
    showMessage(error?.message || String(error), 'error');
    submit.disabled = false;
    submit.textContent = 'Post to Student Voice';
  }
});