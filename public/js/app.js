import { $, $$, esc, toast } from './ui.js';
import { api, setToken, handleUnauthorized } from './api.js';
import { setServerStatus, emailReady, whatsappReady, getSenders } from './store.js';
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

function showLogin() {
  document.body.innerHTML = `<div class="login"><form class="panel">
    <div><h1>Sign in to ReachDesk</h1><p class="muted" style="margin-top:6px">Enter the workspace password set by your admin.</p></div>
    <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
    <button class="btn primary" type="submit">Sign in</button>
  </form></div>`;
  const form = $('form');
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const { token: t } = await api('/auth/login', { method: 'POST', body: { password: form.password.value } });
      setToken(t);
      location.reload();
    } catch (err) { toast(err.message); }
  };
}

async function boot() {
  handleUnauthorized(() => { setToken(''); showLogin(); });
  const auth = await api('/auth/status').catch(() => ({ ok: true }));
  if (!auth.ok) return showLogin();
  api('/senders/status').then(setServerStatus).catch(() => {});
  window.addEventListener('senders-changed', senderNote);
  window.addEventListener('hashchange', render);
  senderNote();
  render();
}

boot();
