import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const form = document.querySelector('#lf-form');
const msgEl = document.querySelector('#lf-message');
const submitBtn = document.querySelector('#lf-submit');
const dateEl = document.querySelector('#lf-date');

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

let userId = null;

function showMessage(text, isError = true) {
  msgEl.textContent = text || '';
  msgEl.hidden = !text;
  msgEl.style.borderColor = isError ? 'var(--accent-strong)' : 'var(--line)';
  if (text) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function init() {
  if (!isSupabaseConfigured || !supabase) {
    window.location.replace('../auth.html#login');
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace('../auth.html#login');
    return;
  }
  userId = session.user.id;
  dateEl.max = new Date().toISOString().slice(0, 10);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage('');

  const fd = new FormData(form);
  const type = fd.get('type');
  const title = String(fd.get('title') || '').trim();
  const description = String(fd.get('description') || '').trim();
  const category = fd.get('category');
  const location = String(fd.get('location') || '').trim();
  const date = fd.get('date_occurred');
  const photo = fd.get('photo');

  if (!type || !category) return showMessage('Please choose the type and the category.');
  if (title.length < 3) return showMessage('Please enter a title of at least 3 characters.');
  if (!description) return showMessage('Please add a description.');
  if (!location) return showMessage('Please enter the location.');
  if (!date) return showMessage('Please choose a date.');

  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto) {
    if (!TYPES[photo.type]) return showMessage('The photo must be a JPEG, PNG or WebP image.');
    if (photo.size > MAX_BYTES) return showMessage('The photo must be 3 MB or smaller.');
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';

  try {
    let imagePath = null;
    if (hasPhoto) {
      imagePath = `${userId}/${crypto.randomUUID()}.${TYPES[photo.type]}`;
      const { error: uploadError } = await supabase.storage
        .from('lost-found')
        .upload(imagePath, photo, { contentType: photo.type, upsert: false });
      if (uploadError) throw new Error(`Photo upload failed: ${uploadError.message}`);
    }

    const { error } = await supabase.from('lost_found_items').insert({
      owner_id: userId,
      type,
      title,
      description,
      category,
      location,
      date_occurred: date,
      image_path: imagePath,
      status: 'pending'
    });
    if (error) throw new Error(error.message);

    form.reset();
    showMessage('Report submitted. An admin will review it before it is published.', false);
    setTimeout(() => window.location.assign('lost-found.html'), 2500);
  } catch (error) {
    showMessage(error.message || 'Something went wrong. Please try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit report';
  }
});

init();