const router = require('express').Router();
const db = require('../lib/db');
const providers = require('../lib/providers');
const { normalizePhone, extractEmail } = require('../lib/phone');

router.get('/stats', (req, res) => {
  const msgs = db.data.messages;
  const count = (fn) => msgs.filter(fn).length;
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({
      day: d,
      email: count((m) => m.status === 'sent' && m.channel === 'email' && m.sentAt?.startsWith(d)),
      whatsapp: count((m) => m.status === 'sent' && m.channel === 'whatsapp' && m.sentAt?.startsWith(d)),
    });
  }
  res.json({
    contacts: db.data.contacts.length,
    lists: db.data.lists.length,
    campaigns: db.data.campaigns.length,
    emailSent: count((m) => m.channel === 'email' && m.status === 'sent'),
    whatsappSent: count((m) => m.channel === 'whatsapp' && m.status === 'sent'),
    failed: count((m) => m.status === 'failed'),
    queued: count((m) => m.status === 'queued'),
    unsubscribed: db.data.suppression.length,
    days,
  });
});

router.get('/suppression', (req, res) => res.json([...db.data.suppression].reverse()));

router.post('/suppression', (req, res) => {
  const raw = String(req.body?.value || '').trim();
  const value = extractEmail(raw) || normalizePhone(raw, req.body?.countryCode || '92');
  if (!value) return res.status(400).json({ error: 'Enter a valid email address or phone number.' });
  if (!db.data.suppression.some((s) => s.value === value)) {
    db.data.suppression.push({ value, reason: 'Added manually', at: db.now() });
    db.save();
  }
  res.json({ ok: true, value });
});

router.delete('/suppression/:value', (req, res) => {
  db.data.suppression = db.data.suppression.filter((s) => s.value !== req.params.value);
  db.save();
  res.json({ ok: true });
});

router.get('/senders/status', (req, res) => {
  res.json({
    emailFromEnv: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS) || providers.jsonMode(),
    whatsappFromEnv: Boolean(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID) || providers.waDryRun(),
    mailTestMode: providers.jsonMode(),
    waDryRun: providers.waDryRun(),
  });
});

router.post('/senders/verify-email', async (req, res) => {
  const t = providers.createTransport(providers.smtpConfig(req.body?.smtp));
  try {
    await t.verify();
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: providers.friendlyError(e) });
  } finally { t.close?.(); }
});

router.post('/senders/verify-whatsapp', async (req, res) => {
  try {
    res.json({ ok: true, info: await providers.verifyWhatsApp(providers.waConfig(req.body?.wa)) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
