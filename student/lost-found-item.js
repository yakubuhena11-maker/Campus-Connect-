import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const contentEl = document.querySelector('#lfi-content');
const msgEl = document.querySelector('#lf-message');
const itemId = new URLSearchParams(window.location.search).get('id');

let userId = null;

function showMessage(text, isError = true) {
  msgEl.textContent = text || '';
  msgEl.hidden = !text;
  msgEl.style.borderColor = isError ? 'var(--accent-strong)' : 'var(--line)';
  if (text) msgEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function badge(text) {
  return el('span', 'lf-badge', text);
}

function detailRow(label, value) {
  const row = el('div');
  row.append(el('dt', '', label), el('dd', '', value || '—'));
  return row;
}

async function loadPhoto(path, alt) {
  const bucket = supabase.storage.from('lost-found');
  const { data, error } = await bucket.createSignedUrl(path, 3600);
  const url = !error && data?.signedUrl ? data.signedUrl : bucket.getPublicUrl(path).data.publicUrl;
  const img = el('img', 'lfi-photo');
  img.alt = alt;
  img.src = url;
  return img;
}

function claimForm(item) {
  const form = el('form', 'lf-form');
  form.noValidate = true;

  const label = el('label', '', item.type === 'found' ? 'Why is this yours?' : 'Where and when did you find it?');
  const textarea = document.createElement('textarea');
  textarea.rows = 4;
  textarea.maxLength = 500;
  textarea.required = true;
  textarea.placeholder = item.type === 'found'
    ? 'Describe details only the owner would know'
    : 'Tell the owner where and when you found it';
  label.append(textarea);

  const button = el('button', 'button button-primary', item.type === 'found' ? 'This is mine' : 'I found it');
  button.type = 'submit';

  form.append(label, button);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const message = textarea.value.trim();
    if (message.length < 10) {
      showMessage('Please write at least 10 characters.');
      return;
    }
    button.disabled = true;
    button.textContent = 'Sending...';

    const { error } = await supabase.from('lost_found_claims').insert({
      item_id: item.id,
      claimant_id: userId,
      message,
      status: 'pending'
    });

    if (error) {
      const duplicate = error.code === '23505';
      showMessage(duplicate ? 'You have already sent a request for this item.' : error.message);
      button.disabled = false;
      button.textContent = item.type === 'found' ? 'This is mine' : 'I found it';
      return;
    }
    showMessage('Request sent. An admin will review it.', false);
    setTimeout(() => window.location.reload(), 1800);
  });

  return form;
}

async function render(item) {
  contentEl.replaceChildren();

  if (item.image_path) {
    try {
      contentEl.append(await loadPhoto(item.image_path, item.title));
    } catch {
      /* photo is optional, ignore errors */
    }
  }

  const badges = el('div', 'lf-badges');
  badges.append(badge(item.type));
  if (item.category) badges.append(badge(item.category));
  badges.append(badge(item.status));

  const details = el('dl', 'lfi-details');
  details.append(
    detailRow('Location', item.location),
    detailRow('Date', item.date_occurred),
    detailRow('Reported', new Date(item.created_at).toLocaleDateString())
  );

  contentEl.append(badges, el('h1', 'lfi-title', item.title), el('p', 'lfi-desc', item.description || ''), details);

  const isOwner = item.owner_id === userId;

  if (isOwner) {
    contentEl.append(el('p', 'lf-note', 'This is your report.'));
    const { data: claims } = await supabase
      .from('lost_found_claims')
      .select('id, message, status, created_at')
      .eq('item_id', item.id)
      .order('created_at', { ascending: false });
    if (claims?.length) {
      contentEl.append(el('h2', 'lfi-section-title', `Requests (${claims.length})`));
      claims.forEach((claim) => {
        const box = el('div', 'lfi-claim-item');
        box.append(el('p', '', claim.message), badge(claim.status));
        contentEl.append(box);
      });
    }
    return;
  }

  if (item.status === 'claimed') {
    contentEl.append(el('p', 'lf-note', 'This item has been claimed.'));
    return;
  }
  if (item.status !== 'approved') return;

  const { data: mine } = await supabase
    .from('lost_found_claims')
    .select('status, message')
    .eq('item_id', item.id)
    .eq('claimant_id', userId)
    .maybeSingle();

  if (mine) {
    contentEl.append(el('h2', 'lfi-section-title', 'Your request'));
    const box = el('div', 'lfi-claim-item');
    box.append(el('p', '', mine.message), badge(mine.status));
    contentEl.append(box);
    return;
  }

  contentEl.append(el('h2', 'lfi-section-title', item.type === 'found' ? 'Is this yours?' : 'Did you find this?'));
  contentEl.append(claimForm(item));
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

  if (!itemId) {
    showMessage('No item selected.');
    return;
  }

  const { data: item, error } = await supabase
    .from('lost_found_items')
    .select('id, owner_id, type, title, description, category, location, date_occurred, image_path, status, created_at')
    .eq('id', itemId)
    .maybeSingle();

  if (error) {
    showMessage(`Could not load this item: ${error.message}`);
    return;
  }
  if (!item) {
    showMessage('This item was not found, or it is not published yet.');
    return;
  }
  await render(item);
}

init();