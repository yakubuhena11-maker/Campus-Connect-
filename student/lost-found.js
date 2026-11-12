import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const listEl = document.querySelector('#lf-list');
const msgEl = document.querySelector('#lf-message');
const searchEl = document.querySelector('#lf-search');
const typeEl = document.querySelector('#lf-type');
const tabButtons = [...document.querySelectorAll('[data-tab]')];

let items = [];
let userId = null;
let tab = 'all';

function showMessage(text) {
  msgEl.textContent = text || '';
  msgEl.hidden = !text;
}

async function photoUrl(path) {
  const bucket = supabase.storage.from('lost-found');
  const { data, error } = await bucket.createSignedUrl(path, 3600);
  if (!error && data?.signedUrl) return data.signedUrl;
  return bucket.getPublicUrl(path).data.publicUrl;
}

function makeBadge(text) {
  const badge = document.createElement('span');
  badge.className = 'lf-badge';
  badge.textContent = text;
  return badge;
}

function makeCard(item) {
  const card = document.createElement('a');
  card.className = 'lf-card';
  card.href = `lost-found-item.html?id=${encodeURIComponent(item.id)}`;

  const photo = document.createElement('div');
  photo.className = 'lf-photo';
  photo.textContent = '⌕';
  card.append(photo);

  if (item.image_path) {
    photoUrl(item.image_path).then((url) => {
      const img = document.createElement('img');
      img.className = 'lf-photo';
      img.alt = item.title;
      img.loading = 'lazy';
      img.src = url;
      img.addEventListener('load', () => photo.replaceWith(img));
    }).catch(() => {});
  }

  const body = document.createElement('div');
  body.className = 'lf-card-body';

  const badges = document.createElement('div');
  badges.className = 'lf-badges';
  badges.append(makeBadge(item.type));
  if (item.category) badges.append(makeBadge(item.category));
  if (tab === 'mine') badges.append(makeBadge(item.status));

  const title = document.createElement('h2');
  title.className = 'lf-card-title';
  title.textContent = item.title;

  const meta = document.createElement('p');
  meta.className = 'lf-meta';
  meta.textContent = [item.location, item.date_occurred].filter(Boolean).join(' · ');

  body.append(badges, title, meta);
  card.append(body);
  return card;
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const type = typeEl.value;
  const shown = items.filter((item) => {
    if (tab === 'mine' ? item.owner_id !== userId : item.status !== 'approved') return false;
    if (type && item.type !== type) return false;
    const text = `${item.title} ${item.description ?? ''} ${item.location ?? ''} ${item.category ?? ''}`.toLowerCase();
    return !query || text.includes(query);
  });

  listEl.replaceChildren();
  if (!shown.length) {
    const empty = document.createElement('p');
    empty.className = 'lf-empty';
    empty.textContent = tab === 'mine' ? 'You have not reported any items yet.' : 'No items found.';
    listEl.append(empty);
    return;
  }
  shown.forEach((item) => listEl.append(makeCard(item)));
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

  const { data, error } = await supabase
    .from('lost_found_items')
    .select('id, owner_id, type, title, description, category, location, date_occurred, image_path, status, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    showMessage(`Could not load items: ${error.message}`);
    return;
  }
  items = data || [];
  render();
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    tab = button.dataset.tab;
    tabButtons.forEach((b) => b.classList.toggle('is-active', b === button));
    render();
  });
});
searchEl.addEventListener('input', render);
typeEl.addEventListener('change', render);

init();