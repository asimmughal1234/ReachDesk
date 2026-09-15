// Placeholder engine.
//   {field}            -> value from the contact row
//   {field|fallback}   -> fallback when the value is empty
//   [[Hi|Hello|Hey]]   -> spintax, one option picked per recipient
const PLACEHOLDER = /\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^{}]*))?\}/g;
const SPIN = /\[\[([^\[\]]+)\]\]/g;

function spin(str) {
  return str.replace(SPIN, (_, g) => {
    const opts = g.split('|');
    return opts[Math.floor(Math.random() * opts.length)];
  });
}

function render(str, vars) {
  if (!str) return '';
  return spin(String(str)).replace(PLACEHOLDER, (m, key, fallback) => {
    const v = vars[key];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v);
    return fallback !== undefined ? fallback : '';
  });
}

function missingKeys(str, vars) {
  const out = new Set();
  String(str || '').replace(PLACEHOLDER, (m, key, fallback) => {
    const v = vars[key];
    if (fallback === undefined && (v === undefined || v === null || String(v).trim() === '')) out.add(key);
    return m;
  });
  return [...out];
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'field';
}

const COMPANY_KEYS = ['business_name', 'company', 'company_name', 'business', 'organization', 'organisation'];

function firstName(name, fields) {
  const n = name.trim();
  // "Hi Emaar," reads like a bot when the name column holds a company, so leave it to the fallback.
  if (!n || COMPANY_KEYS.some((k) => String(fields[k] || '').trim().toLowerCase() === n.toLowerCase())) return '';
  const first = n.split(/\s+/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function buildVars(contact, extra = {}) {
  const name = contact?.name || '';
  const fields = contact?.fields || {};
  return {
    ...fields,
    name,
    first_name: firstName(name, fields),
    email: contact?.email || '',
    phone: contact?.phone || '',
    ...extra,
  };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Same bare markup Gmail writes for a typed message; styled layouts read as marketing mail.
function textToHtml(text) {
  const linked = esc(text).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  const paras = linked.split(/\n{2,}/).map((p) => `<div>${p.replace(/\n/g, '<br>')}</div>`);
  return `<div dir="ltr">${paras.join('<div><br></div>')}</div>`;
}

module.exports = { render, missingKeys, slug, buildVars, textToHtml, esc };
