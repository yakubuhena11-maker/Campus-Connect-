import { supabase, isSupabaseConfigured } from '../src/js/supabase-client.js';

const nameElement = document.querySelector('#student-name');
const statusElement = document.querySelector('#dashboard-status');
const logoutButton = document.querySelector('#logout-button');

function showStatus(message) {
  statusElement.textContent = message;
  statusElement.hidden = false;
}

async function initializeDashboard() {
  if (!isSupabaseConfigured || !supabase) {
    window.location.replace('../auth.html#login');
    return;
  }

  try {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session) {
      window.location.replace('../auth.html#login');
      return;
    }

    const fullName = session.user.user_metadata?.full_name?.trim();
    nameElement.textContent = fullName || 'student';
  } catch {
    window.location.replace('../auth.html#login');
  }
}

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    window.location.replace('../auth.html#login');
  } catch (error) {
    showStatus(error.message || 'Could not log out. Please try again.');
    logoutButton.disabled = false;
  }
});

initializeDashboard();
