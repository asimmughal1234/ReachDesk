const router = require('express').Router();
const db = require('../lib/db');
const providers = require('../lib/providers');
const { normalizePhone, extractEmail } = require('../lib/phone');

router.get('/stats', async (req, res) => {
  const uid = req.user.id;
  const since = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
  const [t] = await db.q(`select
      (select count(*)::int from contacts where user_id = $1) as contacts,
      (select count(*)::int from lists where user_id = $1) as lists,
      (select count(*)::int from campaigns where user_id = $1) as campaigns,
      (select count(*)::int from suppression where user_id = $1) as unsubscribed,
      count(*) filter (where channel = 'email' and status = 'sent')::int as email_sent,
      count(*) filter (where channel = 'whatsapp' and status = 'sent')::int as whatsapp_sent,
      count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status in ('queued', 'sending'))::int as queued
    from messages where user_id = $1`, [uid]);
  const perDay = await db.q(`select substr(sent_at, 1, 10) as day, channel, count(*)::int as n from messages
    where user_id = $1 and status = 'sent' and sent_at >= $2 group by 1, 2`, [uid, since]);
  const sentOn = (day, channel) => perDay.find((r) => r.day === day && r.channel === channel)?.n || 0;
  const days = [];
  for (let i = 13; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({ day: d, email: sentOn(d, 'email'), whatsapp: sentOn(d, 'whatsapp') });
  }
  res.json({
    contacts: t.contacts,
    lists: t.lists,
    campaigns: t.campaigns,
    emailSent: t.email_sent,
    whatsappSent: t.whatsapp_sent,
    failed: t.failed,
    queued: t.queued,
    unsubscribed: t.unsubscribed,
    days,
  });
});

router.get('/suppression', async (req, res) => {
  res.json(await db.q('select value, reason, at from suppression where user_id = $1 order by at desc', [req.user.id]));
});

router.post('/suppression', async (req, res) => {
  const raw = String(req.body?.value || '').trim();
  const value = extractEmail(raw) || normalizePhone(raw, req.body?.countryCode || '92');
  if (!value) return res.status(400).json({ error: 'Enter a valid email address or phone number.' });
  await db.q(`insert into suppression (id, user_id, value, reason, at) values ($1, $2, $3, 'Added manually', $4)
    on conflict (user_id, value) do nothing`, [db.id('sup'), req.user.id, value, db.now()]);
  res.json({ ok: true, value });
});

router.delete('/suppression/:value', async (req, res) => {
  await db.q('delete from suppression where user_id = $1 and value = $2', [req.user.id, req.params.value]);
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
