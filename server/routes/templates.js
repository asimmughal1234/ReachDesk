const router = require('express').Router();
const db = require('../lib/db');

router.get('/', (req, res) => {
  const ch = req.query.channel;
  res.json(db.data.templates.filter((t) => !ch || t.channel === ch).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
});

function clean(b = {}) {
  const channel = b.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const name = String(b.name || '').trim();
  const body = String(b.body || '');
  if (!name) throw Object.assign(new Error('Give the template a name.'), { status: 400 });
  if (!body.trim()) throw Object.assign(new Error('The message body is empty.'), { status: 400 });
  return { channel, name, subject: channel === 'email' ? String(b.subject || '') : '', body };
}

router.post('/', (req, res) => {
  const t = { id: db.id('tpl'), ...clean(req.body), createdAt: db.now(), updatedAt: db.now() };
  db.data.templates.push(t);
  db.save();
  res.json(t);
});

router.put('/:id', (req, res) => {
  const t = db.data.templates.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Template not found.' });
  Object.assign(t, clean(req.body), { updatedAt: db.now() });
  db.save();
  res.json(t);
});

router.delete('/:id', (req, res) => {
  db.data.templates = db.data.templates.filter((t) => t.id !== req.params.id);
  db.save();
  res.json({ ok: true });
});

module.exports = router;
