// Mirrors server/lib/template.js so the preview updates while typing.
import { esc } from './ui.js';

const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^{}]*))?\}/g;
const SPIN = /\[\[([^\[\]]+)\]\]/g;

const COMPANY_KEYS = ['business_name', 'company', 'company_name', 'business', 'organization', 'organisation'];

function firstName(name, fields) {
  const n = name.trim();
  if (!n || COMPANY_KEYS.some((k) => String(fields[k] || '').trim().toLowerCase() === n.toLowerCase())) return '';
  const first = n.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function buildVars(contact = {}, extra = {}) {
  const name = contact.name || '';
  const fields = contact.fields || {};
  return { ...fields, name, first_name: firstName(name, fields), email: contact.email || '', phone: contact.phone || '', ...extra };
}

// Returns HTML: resolved values as text, unresolved placeholders highlighted.
export function renderHtml(str, vars, seed = 0) {
  let i = 0;
  const spun = String(str || '').replace(SPIN, (_, g) => { const o = g.split('|'); i += 1; return o[(seed + i) % o.length]; });
  let out = '';
  let last = 0;
  spun.replace(PLACEHOLDER, (m, key, fb, idx) => {
    out += esc(spun.slice(last, idx));
    const v = vars[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') out += esc(v);
    else if (fb !== undefined) out += esc(fb);
    else out += `<mark class="gap" title="No value for {${esc(key)}} in this row">{${esc(key)}}</mark>`;
    last = idx + m.length;
    return m;
  });
  return out + esc(spun.slice(last));
}

export function renderText(str, vars) {
  return String(str || '').replace(SPIN, (_, g) => g.split('|')[0])
    .replace(PLACEHOLDER, (m, key, fb) => { const v = vars[key]; return v !== undefined && String(v).trim() !== '' ? String(v) : fb ?? ''; });
}
