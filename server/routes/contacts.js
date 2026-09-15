const router = require('express').Router();
const multer = require('multer');
const db = require('../lib/db');
const { parseWorkbook, fetchGoogleSheet, guessMapping } = require('../lib/importer');
const { normalizePhone, extractEmail } = require('../lib/phone');
const { slug } = require('../lib/template');

// Vercel rejects request bodies over 4.5 MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });
const IMPORT_TTL_MS = 30 * 60 * 1000;

const LIST_VIEW = `select l.*, count(c.id)::int as count, count(c.email)::int as emails, count(c.phone)::int as phones
  from lists l left join contacts c on c.list_id = l.id`;
const listView = (r) => r && { ...db.rowTo.list(r), count: r.count, emails: r.emails, phones: r.phones };
const ownList = (req) => db.one('select * from lists where id = $1 and user_id = $2', [req.params.id, req.user.id]);
const notFound = (res) => res.status(404).json({ error: 'List not found.' });

// Parsed files wait in the database for the column mapping, since the next request
// may reach a different server instance.
async function stash(sheets, source, userId) {
  if (!sheets.length) throw Object.assign(new Error('No rows found. Check that the first row has column headers.'), { status: 400 });
  await db.q('delete from imports where created_at < $1', [Date.now() - IMPORT_TTL_MS]);
  const importId = db.id('imp');
  await db.q('insert into imports (id, user_id, source, sheets, created_at) values ($1, $2, $3, $4::text::jsonb, $5)', [importId, userId, source, db.json(sheets), Date.now()]);
  return {
    importId,
    source,
    sheets: sheets.map((s) => ({
      name: s.name, headers: s.headers, rowCount: s.rows.length,
      sample: s.rows.slice(0, 5), suggested: guessMapping(s.headers),
    })),
  };
}

router.post('/imports/file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose an .xlsx, .xls or .csv file to import.' });
  if (!/\.(xlsx|xls|csv|tsv|txt)$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Use an .xlsx, .xls or .csv file.' });
  }
  res.json(await stash(parseWorkbook(req.file.buffer, req.file.originalname), req.file.originalname, req.user.id));
});

router.post('/imports/sheet', async (req, res) => {
  const sheets = await fetchGoogleSheet(req.body?.url || '');
  res.json(await stash(sheets, 'Google Sheet', req.user.id));
});

router.post('/imports/:importId/commit', async (req, res) => {
  const entry = await db.one('select * from imports where id = $1 and user_id = $2 and created_at > $3', [req.params.importId, req.user.id, Date.now() - IMPORT_TTL_MS]);
  if (!entry) return res.status(410).json({ error: 'This import expired. Upload the file again.' });
  const { sheet, mapping = {}, listName, listId, countryCode = '92', tags = [] } = req.body || {};
  const table = entry.sheets.find((s) => s.name === sheet) || entry.sheets[0];
  if (!mapping.email && !mapping.phone) return res.status(400).json({ error: 'Map at least an email or a phone column.' });

  let list = listId ? db.rowTo.list(await db.one('select * from lists where id = $1 and user_id = $2', [listId, req.user.id])) : null;
  if (!list) {
    list = { id: db.id('lst'), userId: req.user.id, name: (listName || '').trim() || `${entry.source} (${table.name})`, source: entry.source, createdAt: db.now() };
    await db.insertMany('lists', db.COLS.lists, [db.toRow.list(list)]);
  }

  const existing = await db.q('select email, phone from contacts where list_id = $1', [list.id]);
  const keys = new Set(existing.flatMap((c) => [c.email && `e:${c.email}`, c.phone && `p:${c.phone}`].filter(Boolean)));
  const result = { added: 0, duplicates: 0, invalid: 0 };
  const rows = [];
  const base = Date.now();

  for (const row of table.rows) {
    const email = mapping.email ? extractEmail(row[mapping.email]) : null;
    const phone = mapping.phone ? normalizePhone(row[mapping.phone], countryCode) : null;
    if (!email && !phone) { result.invalid += 1; continue; }
    if ((email && keys.has(`e:${email}`)) || (phone && keys.has(`p:${phone}`))) { result.duplicates += 1; continue; }
    if (email) keys.add(`e:${email}`);
    if (phone) keys.add(`p:${phone}`);
    const fields = {};
    for (const h of table.headers) fields[slug(h)] = row[h];
    rows.push(db.toRow.contact({
      id: db.id('ct'), userId: req.user.id, listId: list.id, name: mapping.name ? row[mapping.name] : '',
      email, phone, fields, headers: table.headers, tags, createdAt: new Date(base + rows.length).toISOString(),
    }));
    result.added += 1;
  }
  await db.insertMany('contacts', db.COLS.contacts, rows);
  list.updatedAt = db.now();
  await db.q('update lists set updated_at = $2 where id = $1', [list.id, list.updatedAt]);
  res.json({ list, ...result });
});

router.get('/lists', async (req, res) => {
  const rows = await db.q(`${LIST_VIEW} where l.user_id = $1 group by l.id order by l.created_at desc`, [req.user.id]);
  res.json(rows.map(listView));
});

router.get('/lists/:id', async (req, res) => {
  const l = await db.one(`${LIST_VIEW} where l.id = $1 and l.user_id = $2 group by l.id`, [req.params.id, req.user.id]);
  if (!l) return notFound(res);
  const keys = await db.q('select distinct jsonb_object_keys(fields) as k from (select fields from contacts where list_id = $1 limit 100) t', [l.id]);
  res.json({ ...listView(l), fields: [...new Set(['name', 'first_name', 'email', 'phone', ...keys.map((r) => r.k)])] });
});

router.get('/lists/:id/contacts', async (req, res) => {
  const l = await ownList(req);
  if (!l) return notFound(res);
  const q = String(req.query.q || '').trim();
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const where = "c.list_id = $1 and ($2 = '' or c.name ilike $3 or c.email ilike $3 or c.phone ilike $3 or c.fields::text ilike $3)";
  const [{ n }] = await db.q(`select count(*)::int as n from contacts c where ${where}`, [l.id, q, like]);
  const rows = await db.q(`select c.*, exists(select 1 from suppression s where s.user_id = $4 and (s.value = c.email or s.value = c.phone)) as unsubscribed
    from contacts c where ${where} order by c.created_at, c.id limit $5 offset $6`, [l.id, q, like, req.user.id, limit, offset]);
  res.json({ total: n, items: rows.map((r) => ({ ...db.rowTo.contact(r), unsubscribed: Boolean(r.unsubscribed) })) });
});

router.patch('/lists/:id', async (req, res) => {
  const l = await ownList(req);
  if (!l) return notFound(res);
  if (req.body?.name) await db.q('update lists set name = $2 where id = $1', [l.id, String(req.body.name).trim()]);
  res.json(listView(await db.one(`${LIST_VIEW} where l.id = $1 group by l.id`, [l.id])));
});

router.delete('/lists/:id', async (req, res) => {
  const l = await ownList(req);
  if (!l) return notFound(res);
  await db.q('delete from lists where id = $1', [l.id]); // contacts go with it
  res.json({ ok: true });
});

router.delete('/contacts/:id', async (req, res) => {
  await db.q('delete from contacts where id = $1 and user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
