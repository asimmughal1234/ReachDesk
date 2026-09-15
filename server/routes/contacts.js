const router = require('express').Router();
const multer = require('multer');
const db = require('../lib/db');
const { parseWorkbook, fetchGoogleSheet, guessMapping } = require('../lib/importer');
const { normalizePhone, extractEmail } = require('../lib/phone');
const { slug } = require('../lib/template');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const imports = new Map(); // parsed files waiting for column mapping

function stash(sheets, source) {
  for (const [k, v] of imports) if (Date.now() - v.at > 30 * 60 * 1000) imports.delete(k);
  if (!sheets.length) throw Object.assign(new Error('No rows found. Check that the first row has column headers.'), { status: 400 });
  const importId = db.id('imp');
  imports.set(importId, { sheets, source, at: Date.now() });
  return {
    importId,
    source,
    sheets: sheets.map((s) => ({
      name: s.name, headers: s.headers, rowCount: s.rows.length,
      sample: s.rows.slice(0, 5), suggested: guessMapping(s.headers),
    })),
  };
}

router.post('/imports/file', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an .xlsx, .xls or .csv file to import.' });
  if (!/\.(xlsx|xls|csv|tsv|txt)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Use an .xlsx, .xls or .csv file.' });
  }
  res.json(stash(parseWorkbook(req.file.buffer, req.file.originalname), req.file.originalname));
});

router.post('/imports/sheet', async (req, res) => {
  const sheets = await fetchGoogleSheet(req.body?.url || '');
  res.json(stash(sheets, 'Google Sheet'));
});

router.post('/imports/:importId/commit', (req, res) => {
  const entry = imports.get(req.params.importId);
  if (!entry) return res.status(410).json({ error: 'This import expired. Upload the file again.' });
  const { sheet, mapping = {}, listName, listId, countryCode = '92', tags = [] } = req.body || {};
  const table = entry.sheets.find((s) => s.name === sheet) || entry.sheets[0];
  if (!mapping.email && !mapping.phone) return res.status(400).json({ error: 'Map at least an email or a phone column.' });

  let list = listId && db.data.lists.find((l) => l.id === listId);
  if (!list) {
    list = { id: db.id('lst'), name: (listName || '').trim() || `${entry.source} (${table.name})`, source: entry.source, createdAt: db.now() };
    db.data.lists.push(list);
  }

  const existing = db.data.contacts.filter((c) => c.listId === list.id);
  const keys = new Set(existing.flatMap((c) => [c.email && `e:${c.email}`, c.phone && `p:${c.phone}`].filter(Boolean)));
  const result = { added: 0, duplicates: 0, invalid: 0 };

  for (const row of table.rows) {
    const email = mapping.email ? extractEmail(row[mapping.email]) : null;
    const phone = mapping.phone ? normalizePhone(row[mapping.phone], countryCode) : null;
    if (!email && !phone) { result.invalid += 1; continue; }
    if ((email && keys.has(`e:${email}`)) || (phone && keys.has(`p:${phone}`))) { result.duplicates += 1; continue; }
    if (email) keys.add(`e:${email}`);
    if (phone) keys.add(`p:${phone}`);
    const fields = {};
    for (const h of table.headers) fields[slug(h)] = row[h];
    db.data.contacts.push({
      id: db.id('ct'), listId: list.id, name: mapping.name ? row[mapping.name] : '',
      email, phone, fields, headers: table.headers, tags, createdAt: db.now(),
    });
    result.added += 1;
  }
  list.updatedAt = db.now();
  db.save();
  res.json({ list, ...result });
});

function listView(l) {
  const cs = db.data.contacts.filter((c) => c.listId === l.id);
  return { ...l, count: cs.length, emails: cs.filter((c) => c.email).length, phones: cs.filter((c) => c.phone).length };
}

router.get('/lists', (req, res) => {
  res.json(db.data.lists.map(listView).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

router.get('/lists/:id', (req, res) => {
  const l = db.data.lists.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'List not found.' });
  const cs = db.data.contacts.filter((c) => c.listId === l.id);
  const fields = new Set(['name', 'first_name', 'email', 'phone']);
  for (const c of cs.slice(0, 100)) Object.keys(c.fields || {}).forEach((k) => fields.add(k));
  res.json({ ...listView(l), fields: [...fields] });
});

router.get('/lists/:id/contacts', (req, res) => {
  const q = String(req.query.q || '').toLowerCase();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const suppressed = new Set(db.data.suppression.map((s) => s.value));
  let rows = db.data.contacts.filter((c) => c.listId === req.params.id);
  if (q) rows = rows.filter((c) => [c.name, c.email, c.phone, ...Object.values(c.fields || {})].some((v) => String(v || '').toLowerCase().includes(q)));
  res.json({
    total: rows.length,
    items: rows.slice(offset, offset + limit).map((c) => ({ ...c, unsubscribed: suppressed.has(c.email) || suppressed.has(c.phone) })),
  });
});

router.patch('/lists/:id', (req, res) => {
  const l = db.data.lists.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'List not found.' });
  if (req.body?.name) l.name = String(req.body.name).trim();
  db.save();
  res.json(listView(l));
});

router.delete('/lists/:id', (req, res) => {
  db.data.lists = db.data.lists.filter((l) => l.id !== req.params.id);
  db.data.contacts = db.data.contacts.filter((c) => c.listId !== req.params.id);
  db.save();
  res.json({ ok: true });
});

router.delete('/contacts/:id', (req, res) => {
  db.data.contacts = db.data.contacts.filter((c) => c.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});

module.exports = router;
