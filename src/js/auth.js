// Campus Connect authentication page interactions.
import { supabase, isSupabaseConfigured } from './supabase-client.js';

const forms = {
  signup: document.querySelector('#signup-form'),
  login: document.querySelector('#login-form'),
  recovery: document.querySelector('#recovery-form')
};
const status = document.querySelector('#auth-status');
const panels = [...document.querySelectorAll('[data-auth-panel]')];
const modeLinks = [...document.querySelectorAll('[data-auth-mode]')];

function showStatus(message, type = 'info') {
  status.textContent = message;
  status.dataset.type = type;
  status.hidden = false;
}

function setMode(mode) {
  const selectedMode = forms[mode] ? mode : 'login';
  panels.forEach((panel) => { panel.hidden = panel.dataset.authPanel !== selectedMode; });
  modeLinks.forEach((link) => {
    const active = link.dataset.authMode === selectedMode;
    link.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.title = `${selectedMode === 'signup' ? 'Create account' : selectedMode === 'recovery' ? 'Reset password' : 'Log in'} — Campus Connect`;
  if (status) status.hidden = true;
}

function setBusy(form, busy, label) {
  const button = form.querySelector('[type="submit"]');
  button.disabled = busy;
  button.textContent = busy ? 'Please wait…' : label;
  form.setAttribute('aria-busy', String(busy));
}

function validateSignup(form) {
  const fullName = form.elements.fullName;
  const matriculationNumber = form.elements.matriculationNumber;
  const password = form.elements.password;
  const confirmation = form.elements.confirmPassword;

  fullName.setCustomValidity(fullName.value.trim().split(/\s+/).filter(Boolean).length < 2
    ? 'Enter your first and last name.' : '');
  matriculationNumber.setCustomValidity(/^[A-Za-z0-9/-]{3,30}$/.test(matriculationNumber.value.trim())
    ? '' : 'Use 3–30 letters, numbers, hyphens, or slashes.');
  password.setCustomValidity(password.value.length >= 8 ? '' : 'Use at least 8 characters.');
  confirmation.setCustomValidity(confirmation.value === password.value ? '' : 'Passwords do not match.');
  return form.reportValidity();
}

function universityEmailIsValid(value) {
  // No institution/domain was specified, so validate email syntax without guessing a domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

modeLinks.forEach((link) => link.addEventListener('click', (event) => {
  event.preventDefault();
  const mode = link.dataset.authMode;
  history.replaceState(null, '', `#${mode}`);
  setMode(mode);
}));

window.addEventListener('hashchange', () => setMode(location.hash.slice(1)));
setMode(location.hash.slice(1));

forms.signup.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = forms.signup;
  if (!validateSignup(form)) return;
  const email = form.elements.email.value.trim();
  if (!universityEmailIsValid(email)) {
    form.elements.email.setCustomValidity('Enter a valid university email address.');
    form.elements.email.reportValidity();
    return;
  }
  form.elements.email.setCustomValidity('');
  if (!isSupabaseConfigured || !supabase) {
    showStatus('Supabase is not configured with a valid project URL and publishable key. Registration is unavailable.', 'error');
    return;
  }

  setBusy(form, true, 'Create account');
  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password: form.elements.password.value,
      options: {
        data: {
          full_name: form.elements.fullName.value.trim(),
          matriculation_number: form.elements.matriculationNumber.value.trim()
        },
        emailRedirectTo: new URL('./auth.html#login', window.location.href).href
      }
    });
    if (error) throw error;
    showStatus(data.session
      ? 'Account created. You are signed in; authentication should still be verified in your Supabase project.'
      : 'Registration request submitted. Check your university inbox to confirm your email before logging in.', 'success');
    form.reset();
  } catch (error) {
    showStatus(error.message || 'Registration failed. Check your connection and Supabase Auth settings.', 'error');
  } finally {
    setBusy(form, false, 'Create account');
  }
});

forms.login.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = forms.login;
  if (!form.reportValidity()) return;
  if (!isSupabaseConfigured || !supabase) {
    showStatus('Supabase is not configured with a valid project URL and publishable key. Login is unavailable.', 'error');
    return;
  }

  setBusy(form, true, 'Log in');
  try {
    const { error } = await supabase.auth.signInWithPassword({
      email: form.elements.email.value.trim(),
      password: form.elements.password.value
    });
    if (error) throw error;
    window.location.replace('./student/dashboard.html');
  } catch (error) {
    showStatus(error.message || 'Login failed. Check your details and Supabase Auth settings.', 'error');
  } finally {
    setBusy(form, false, 'Log in');
  }
});

forms.recovery.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = forms.recovery;
  if (!form.reportValidity()) return;
  if (!isSupabaseConfigured || !supabase) {
    showStatus('Supabase is not configured with a valid project URL and publishable key. Password recovery is unavailable.', 'error');
    return;
  }

  setBusy(form, true, 'Send recovery email');
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(form.elements.email.value.trim(), {
      redirectTo: new URL('./auth.html#login', window.location.href).href
    });
    if (error) throw error;
    showStatus('If an account exists for that address, Supabase will send password recovery instructions. Check your inbox.', 'success');
    form.reset();
  } catch (error) {
    showStatus(error.message || 'Could not request password recovery. Try again later.', 'error');
  } finally {
    setBusy(form, false, 'Send recovery email');
  }
});
