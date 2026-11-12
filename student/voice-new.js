import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const form = document.querySelector('#voice-form');
const message = document.querySelector('#voice-message');
const submit = document.querySelector('#submit-post');
function showMessage(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
  message.hidden = !text;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');
  if (!form.reportValidity()) return;
  const formData = new FormData(form);
  const category = String(formData.get('category') || '');
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('message') || '').trim();
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
      is_anonymous: formData.get('is_anonymous') === 'on',
      status: 'received',
      is_hidden: false
    }).select('id').single();
    if (error) throw error;
    window.location.href = `voice-post.html?id=${encodeURIComponent(data.id)}`;
  } catch (error) {
    showMessage(error?.message || String(error), 'error');
    submit.disabled = false;
    submit.textContent = 'Post to Student Voice';
  }
});
