import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const form = document.querySelector('#lf-form');
const msgEl = document.querySelector('#lf-message');
const submitBtn = document.querySelector('#lf-submit');
const dateEl = document.querySelector('#lf-date');
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
let userId = null;

function showMessage(text, isError = true) {
  if (!msgEl) return;
  msgEl.textContent = text || '';
  msgEl.hidden = !text;
  msgEl.dataset.kind = isError ? 'error' : 'success';
  if (text) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function describeUploadError(error) {
  const message = error?.message || String(error || 'Unknown storage error');
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Photo upload could not reach Supabase Storage. Check your internet connection and Supabase project URL, then confirm migration 006b_storage_fix.sql has been run.';
  }
  if (/row-level security|permission|not authorized|unauthorized|403/i.test(message)) {
    return 'Supabase rejected the photo upload. Confirm the lost-found bucket policies are installed and that you are signed in.';
  }
  if (/bucket not found|not found/i.test(message)) {
    return 'The lost-found storage bucket is missing. Run database/migrations/006b_storage_fix.sql in the Supabase SQL Editor.';
  }
  if (/payload too large|file size|exceeded/i.test(message)) {
    return 'The photo exceeds the 3 MB storage limit. Choose a smaller image.';
  }
  return `Photo upload failed: ${message}`;
}

async function init() {
  if (!isSupabaseConfigured || !supabase) {
    showMessage('Supabase is not configured. Contact your campus administrator.');
    return;
  }
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    showMessage(`Could not check your sign-in: ${error.message}`);
    return;
  }
  if (!session) {
    window.location.replace('../auth.html#login');
    return;
  }
  userId = session.user.id;
  dateEl.max = new Date().toISOString().slice(0, 10);
}

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!userId) return showMessage('Your account is still loading. Wait a moment and try again.');

  const fd = new FormData(form);
  const type = fd.get('type');
  const title = String(fd.get('title') || '').trim();
  const description = String(fd.get('description') || '').trim();
  const category = fd.get('category');
  const location = String(fd.get('location') || '').trim();
  const date = fd.get('date_occurred');
  const photo = fd.get('photo');

  if (!type || !category) return showMessage('Please choose the item type and category.');
  if (title.length < 3) return showMessage('Please enter a title of at least 3 characters.');
  if (!description) return showMessage('Please add a description.');
  if (!location) return showMessage('Please enter the location.');
  if (!date) return showMessage('Please choose a date.');

  const hasPhoto = photo instanceof File && photo.size > 0;
  if (hasPhoto && !TYPES[photo.type]) return showMessage('Choose a JPEG, PNG or WebP image.');
  if (hasPhoto && photo.size > MAX_BYTES) return showMessage('The photo must be 3 MB or smaller.');

  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting…';
  showMessage('Submitting your report…', false);
  try {
    let imagePath = null;
    if (hasPhoto) {
      imagePath = `${userId}/${crypto.randomUUID()}.${TYPES[photo.type]}`;
      const { error: uploadError } = await supabase.storage.from('lost-found')
        .upload(imagePath, photo, { contentType: photo.type, upsert: false });
      if (uploadError) throw new Error(describeUploadError(uploadError));
    }

    const { error } = await supabase.from('lost_found_items').insert({
      owner_id: userId, type, title, description, category, location,
      date_occurred: date, image_path: imagePath, status: 'pending'
    });
    if (error) throw new Error(`Report could not be saved: ${error.message}`);

    form.reset();
    showMessage('Report submitted. An admin will review it before it is published.', false);
    setTimeout(() => window.location.assign('lost-found.html'), 2500);
  } catch (error) {
    showMessage(error.message || 'Could not submit the report. Check your connection and try again.');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit report';
  }
});

init().catch((error) => showMessage(`Could not initialize the report form: ${error.message || error}`));
