import { $, $$, esc, toast, busy } from './ui.js';
import { api, setToken, handleUnauthorized } from './api.js';
import { setServerStatus, setAccount, emailReady, whatsappReady, getSenders } from './store.js';
import { dashboard } from './views/dashboard.js';
import { contacts } from './views/contacts.js';
import { templates } from './views/templates.js';
import { compose } from './views/compose.js';
import { campaigns, campaignDetail } from './views/campaigns.js';
import { settings } from './views/settings.js';

const routes = { '': dashboard, compose, contacts, templates, campaigns, settings };
let cleanup = null;
let token = 0;

function parseHash() {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean);
  return { parts, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function render() {
  const { parts, query } = parseHash();
  const view = parts[0] === 'campaigns' && parts[1] ? campaignDetail : routes[parts[0] || ''];
  const nav = parts[0] || 'dashboard';
  $$('.rail nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  const el = $('#view');
  const mine = ++token;
  el.innerHTML = '<div class="page"><div class="skeleton"></div></div>';
  if (!view) { el.innerHTML = '<div class="page empty"><h3>This page does not exist</h3><a class="btn" href="#/">Go to overview</a></div>'; return; }
  try {
    const out = await view(el, { id: parts[1], query, isCurrent: () => mine === token });
    if (mine === token) cleanup = out; else if (typeof out === 'function') out();
    el.focus({ preventScroll: true });
  } catch (e) {
    if (mine !== token) return;
    el.innerHTML = `<div class="page empty"><h3>This page did not load</h3><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
  }
}

function senderNote() {
  const parts = [];
  const s = getSenders();
  parts.push(emailReady() ? `Email: <b>${esc(s.smtp.user || 'server default')}</b>` : 'Email sender not set');
  parts.push(whatsappReady() ? 'WhatsApp API: <b>connected</b>' : 'WhatsApp: click-to-chat only');
  $('#sender-note').innerHTML = parts.join('<br>');
}

function drawUser(user) {
  $('#rail-user').innerHTML = `<span title="${esc(user.email)}"><b>${esc(user.name || user.email)}</b></span>
    <button class="btn sm ghost" data-logout>Sign out</button>`;
  $('[data-logout]').onclick = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setToken('');
    location.hash = '#/';
    location.reload();
  };
}

function showAuth(mode, signupOpen) {
  const signup = mode === 'signup';
  document.body.innerHTML = `<div class="login"><form class="panel" novalidate>
    <div><h1>${signup ? 'Create your account' : 'Sign in to ReachDesk'}</h1>
      <p class="muted" style="margin-top:6px">${signup ? 'Your lists, templates and campaigns stay private to your account.' : 'Welcome back. Sign in to see your lists and campaigns.'}</p></div>
    ${signup ? '<label class="field">Your name<input type="text" name="name" autocomplete="name" required></label>' : ''}
    <label class="field">Email<input type="email" name="email" autocomplete="email" required></label>
    <label class="field">Password<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required>${signup ? '<span class="hint">At least 8 characters.</span>' : ''}</label>
    ${signup ? '<label class="field">Invite code<input type="text" name="invite" autocomplete="off" required><span class="hint">Ask your admin for this code.</span></label>' : ''}
    <button class="btn primary" type="submit" data-busy="${signup ? 'Creating account' : 'Signing in'}">${signup ? 'Create account' : 'Sign in'}</button>
    ${signupOpen ? `<p class="muted small auth-switch">${signup ? 'Already have an account?' : 'New to ReachDesk?'} <a href="#" data-switch>${signup ? 'Sign in' : 'Create an account'}</a></p>` : ''}
  </form></div><div id="toasts" aria-live="polite"></div>`;
  const form = $('form');
  const sw = $('[data-switch]');
  if (sw) sw.onclick = (e) => { e.preventDefault(); showAuth(signup ? 'login' : 'signup', signupOpen); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    try {
      await busy(btn, async () => {
        const { token: t } = await api(signup ? '/auth/signup' : '/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(form)) });
        setToken(t);
      });
      location.reload();
    } catch (err) { toast(err.message); }
  };
  setTimeout(() => $('input', form)?.focus(), 30);
}

async function boot() {
  let signupOpen = false;
  handleUnauthorized(() => { setToken(''); showAuth('login', signupOpen); });
  // Show the server's own reason (for example a missing database), not a generic message.
  const auth = await api('/auth/status').catch((e) => ({ failed: e.message }));
  if (auth.failed) {
    $('#view').innerHTML = `<div class="page empty"><h3>ReachDesk is not ready</h3><p>${esc(auth.failed)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
    return;
  }
  signupOpen = auth.signupOpen;
  if (!auth.ok) return showAuth(auth.setup && signupOpen ? 'signup' : 'login', signupOpen);
  setAccount(auth.user.id);
  drawUser(auth.user);
  api('/senders/status').then(setServerStatus).catch(() => {});
  window.addEventListener('senders-changed', senderNote);
  window.addEventListener('hashchange', render);
  senderNote();
  render();
}

boot();
