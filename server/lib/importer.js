const XLSX = require('xlsx');

function cellStr(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number' && Number.isInteger(v)) return String(v);
  return String(v).trim();
}

function sheetToTable(ws) {
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: false });
  const hi = aoa.findIndex((r) => r.some((c) => cellStr(c) !== ''));
  if (hi < 0) return { headers: [], rows: [] };
  const seen = {};
  const headers = aoa[hi].map((h, i) => {
    let n = cellStr(h) || `Column ${i + 1}`;
    if (seen[n]) { seen[n] += 1; n = `${n} (${seen[n]})`; } else seen[n] = 1;
    return n;
  });
  const rows = aoa.slice(hi + 1)
    .filter((r) => r.some((c) => cellStr(c) !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, cellStr(r[i])])));
  return { headers, rows };
}

function parseWorkbook(buffer, filename = '') {
  const isCsv = /\.(csv|tsv|txt)$/i.test(filename);
  const wb = isCsv
    ? XLSX.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', cellDates: true, raw: true })
    : XLSX.read(buffer, { type: 'buffer', cellDates: true });
  return wb.SheetNames.map((name) => ({ name, ...sheetToTable(wb.Sheets[name]) }))
    .filter((s) => s.headers.length);
}

async function fetchGoogleSheet(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!m) throw Object.assign(new Error('That does not look like a Google Sheets link. Copy the link from the address bar of the sheet.'), { status: 400 });
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`, { redirect: 'follow' });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('text/html')) {
    throw Object.assign(new Error('Google Sheets did not share this file. Set sharing to "Anyone with the link can view" and try again.'), { status: 400 });
  }
  return parseWorkbook(Buffer.from(await res.arrayBuffer()), 'sheet.xlsx');
}

function guessMapping(headers) {
  const pick = (re, not) => headers.find((h) => re.test(h) && !(not && not.test(h))) || '';
  return {
    email: pick(/e-?mail/i),
    phone: pick(/phone|mobile|whats\s?app|cell|contact\s?(no|number)|tel/i, /review/i),
    // A person's name makes a natural greeting; fall back to the business name only when there is none.
    name: pick(/^(full\s?|first\s?|contact\s?|owner\s?|person\s?)?name$/i) || pick(/^(business\s?|company\s?)?name$|company|business/i),
  };
}

function toXlsxBuffer(rows, sheetName = 'Results') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName.slice(0, 31));
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { parseWorkbook, fetchGoogleSheet, guessMapping, toXlsxBuffer };
