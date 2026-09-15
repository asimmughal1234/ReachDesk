const router = require('express').Router();
const db = require('../lib/db');

router.get('/', async (req, res) => {
  const ch = req.query.channel;
  const rows = await db.q(`select * from templates where user_id = $1 ${ch ? 'and channel = $2' : ''} order by updated_at desc`, ch ? [req.user.id, ch] : [req.user.id]);
  res.json(rows.map(db.rowTo.template));
});

function clean(b = {}) {
  const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const name = String(b.name || '').trim();
  const body = String(b.body || '');
  if (!name) throw Object.assign(new Error('Give the template a name.'), { status: 400 });
  if (!body.trim()) throw Object.assign(new Error('The message body is empty.'), { status: 400 });
  return { channel, name, subject: channel === 'email' ? String(b.subject || '') : '', body };
}

router.post('/', async (req, res) => {
  const t = { id: db.id('tpl'), userId: req.user.id, ...clean(req.body), createdAt: db.now(), updatedAt: db.now() };
  await db.insertMany('templates', db.COLS.templates, [db.toRow.template(t)]);
  res.json(t);
});

router.put('/:id', async (req, res) => {
  const b = clean(req.body);
  const row = await db.one(`update templates set channel = $3, name = $4, subject = $5, body = $6, updated_at = $7
    where id = $1 and user_id = $2 returning *`, [req.params.id, req.user.id, b.channel, b.name, b.subject, b.body, db.now()]);
  if (!row) return res.status(404).json({ error: 'Template not found.' });
  res.json(db.rowTo.template(row));
});

router.delete('/:id', async (req, res) => {
  await db.q('delete from templates where id = $1 and user_id = $2', [req.params.id, req.user.id]);
  res.json({ ok: true });
});

module.exports = router;
