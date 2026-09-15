export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'ok' ? 3200 : 6000);
}

export function modal({ title, body = '', footer = '', wide = false, onOpen }) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button class="x" aria-label="Close">×</button></header>
    <div class="modal-body">${body}</div>
    ${footer ? `<footer>${footer}</footer>` : ''}
  </div>`;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  $('.x', back).onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(back);
  const api = { el: back, close, body: $('.modal-body', back), footer: $('footer', back) };
  onOpen?.(api);
  setTimeout(() => $('input, select, textarea', back)?.focus(), 30);
  return api;
}

export function confirmDialog(title, text, action = 'Confirm') {
  return new Promise((resolve) => {
    const m = modal({
      title,
      body: `<p class="muted">${esc(text)}</p>`,
      footer: `<button class="btn ghost" data-no>Keep it</button><button class="btn primary" data-yes>${esc(action)}</button>`,
    });
    $('[data-no]', m.el).onclick = () => { m.close(); resolve(false); };
    $('[data-yes]', m.el).onclick = () => { m.close(); resolve(true); };
  });
}

export async function busy(btn, fn) {
  const html = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spin"></span>${esc(btn.dataset.busy || btn.textContent.trim())}`;
  try { return await fn(); } finally { btn.disabled = false; btn.innerHTML = html; }
}

export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const fmtNum = (n) => Number(n || 0).toLocaleString();

const STATUS_LABEL = { queued: 'Queued', sent: 'Sent', failed: 'Failed', skipped: 'Skipped', ready: 'Ready', running: 'Sending', paused: 'Paused', completed: 'Completed', cancelled: 'Cancelled' };
export const status = (s) => `<span class="status ${esc(s)}">${STATUS_LABEL[s] || esc(s)}</span>`;

export const icons = {
  email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24"><path d="M3.5 20.5 5 16a8 8 0 1 1 3 3z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v12m0 0-4-4m4 4 4-4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/></svg>',
};
export const channelTag = (ch) => `<span class="channel-tag">${icons[ch] || ''}${ch === 'whatsapp' ? 'WhatsApp' : 'Email'}</span>`;

export function debounce(fn, ms = 300) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
