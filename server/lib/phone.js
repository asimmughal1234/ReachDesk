// Normalizes phone numbers to WhatsApp's international digits-only format.
function normalizePhone(raw, countryCode = '92') {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  s = s.split(/[,;/]/)[0].trim(); // first number when a cell holds several
  const plus = s.startsWith('+');
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  const cc = String(countryCode || '').replace(/\D/g, '');
  if (!plus) {
    if (d.startsWith('00')) d = d.slice(2);
    else if (d.startsWith('0') && cc) d = cc + d.replace(/^0+/, '');
    else if (cc && d.length <= 10) d = cc + d;
  }
  if (d.length < 8 || d.length > 15) return null;
  return d;
}

const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
function extractEmail(raw) {
  const m = String(raw ?? '').match(EMAIL);
  return m ? m[0].toLowerCase() : null;
}

module.exports = { normalizePhone, extractEmail };
