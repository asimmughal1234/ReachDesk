const router = require('express').Router();
const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const db = require('../lib/db');
const jobs = require('../lib/jobs');
const providers = require('../lib/providers');
const { compose, suppressedSet, recipientFor, contactedSet } = require('../lib/compose');
const { buildVars, missingKeys } = require('../lib/template');
const { toXlsxBuffer } = require('../lib/importer');

const upload = multer({ dest: path.join(os.tmpdir(), 'reachdesk-uploads'), limits: { fileSize: 20 * 1024 * 1024, files: 5 } });

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const payloadOf = (req) => {
  if (typeof req.body?.payload !== 'string') return req.body || {};
  try { return JSON.parse(req.body.payload); } catch { throw bad('The campaign data could not be read. Reload the page and try again.'); }
};
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const findCampaign = (id) => {
  const c = db.data.campaigns.find((x) => x.id === id);
  if (!c) throw bad('Campaign not found.', 404);
  return c;
};
const cleanupUploads = (req) => (req.files || []).forEach((f) => fs.rm(f.path, { force: true }, () => {}));

// Turns the composer payload into a stored campaign snapshot (never includes credentials).
function snapshot(p, req) {
  const channel = p.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const list = db.data.lists.find((l) => l.id === p.listId);
  if (!list) throw bad('Choose a contact list.');
  const m = p.message || {};
  if (channel === 'email' && !String(m.subject || '').trim()) throw bad('Add a subject line.');
  const wa = { mode: 'links', templateName: '', language: 'en', params: [], ...(p.wa || {}) };
  if (channel === 'whatsapp' && wa.mode === 'cloud_template' && !wa.templateName) throw bad('Enter the approved WhatsApp template name.');
  if (!String(m.body || '').trim() && !(channel === 'whatsapp' && wa.mode === 'cloud_template')) throw bad('The message body is empty.');
  const d = p.delivery || {};
  return {
    name: String(p.name || '').trim() || `${list.name} (${new Date().toLocaleDateString('en-GB')})`,
    channel,
    listId: list.id,
    listName: list.name,
    senderName: String(p.senderName || p.runtime?.smtp?.fromName || '').trim(),
    baseUrl: baseUrl(req),
    message: {
      subject: String(m.subject || ''), body: String(m.body || ''),
      html: m.html === true, footer: Boolean(m.footer), footerText: String(m.footerText || ''),
    },
    wa: {
      mode: ['links', 'cloud_text', 'cloud_template'].includes(wa.mode) ? wa.mode : 'links',
      templateName: String(wa.templateName || '').trim(),
      language: String(wa.language || 'en').trim(),
      params: (Array.isArray(wa.params) ? wa.params : String(wa.params || '').split(',')).map((s) => String(s).trim()).filter(Boolean),
    },
    delivery: {
      limit: Math.max(0, Number(d.limit) || 0),
      delay: Math.max(0, Number(d.delay ?? 45)),
      jitter: Math.max(0, Number(d.jitter ?? 45)),
      skipContacted: d.skipContacted !== false,
    },
  };
}

function audience(c) {
  const contacts = db.data.contacts.filter((x) => x.listId === c.listId);
  const suppressed = suppressedSet();
  const contacted = c.delivery.skipContacted ? contactedSet(c.channel) : new Set();
  const out = { eligible: [], missing: 0, suppressed: 0, contacted: 0, total: contacts.length };
  for (const ct of contacts) {
    const to = recipientFor(c.channel, ct);
    if (!to) out.missing += 1;
    else if (suppressed.has(to)) out.suppressed += 1;
    else if (contacted.has(to)) out.contacted += 1;
    else out.eligible.push(ct);
  }
  return out;
}

router.get('/', (req, res) => {
  res.json(db.data.campaigns.map(jobs.publicCampaign).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
});

router.post('/preview', (req, res) => {
  const c = snapshot(req.body, req);
  const a = audience(c);
  const missing = new Set();
  for (const ct of a.eligible.slice(0, 300)) {
    const vars = buildVars(ct, { sender_name: c.senderName, unsubscribe_url: 'x', campaign_name: c.name });
    [c.message.subject, c.message.body, c.message.footer ? c.message.footerText : '', ...c.wa.params]
      .forEach((s) => missingKeys(s, vars).forEach((k) => missing.add(k)));
  }
  res.json({
    counts: { total: a.total, eligible: a.eligible.length, missing: a.missing, suppressed: a.suppressed, contacted: a.contacted },
    firstBatch: c.delivery.limit ? Math.min(c.delivery.limit, a.eligible.length) : a.eligible.length,
    missingPlaceholders: [...missing],
  });
});

router.post('/test', upload.array('attachments', 5), async (req, res) => {
  try {
    const p = payloadOf(req);
    const c = snapshot(p, req);
    const to = String(p.test?.to || '').trim();
    if (!to) throw bad(c.channel === 'email' ? 'Enter an email address for the test.' : 'Enter a WhatsApp number for the test.');
    const sample = audience(c).eligible[0] || db.data.contacts.find((x) => x.listId === c.listId) || {};
    const out = compose(c, sample);
    if (c.channel === 'email') {
      const smtp = providers.smtpConfig(p.runtime?.smtp);
      const t = providers.createTransport(smtp);
      try {
        await t.sendMail({
          from: smtp.fromName ? { name: smtp.fromName, address: smtp.user || 'test@example.com' } : smtp.user || 'test@example.com',
          to, replyTo: smtp.replyTo || undefined,
          subject: `[Test] ${out.subject}`, text: out.text, html: out.html,
          attachments: (req.files || []).map((f) => ({ filename: f.originalname, path: f.path })),
        });
      } finally { t.close?.(); }
    } else {
      if (c.wa.mode === 'links') throw bad('Click-to-chat mode opens WhatsApp on your device, so there is nothing to test-send. Use the preview instead.');
      const { normalizePhone } = require('../lib/phone');
      const num = normalizePhone(to, p.countryCode || '92');
      if (!num) throw bad('That WhatsApp number is not valid.');
      const payload = c.wa.mode === 'cloud_template'
        ? { type: 'template', template: { name: c.wa.templateName, language: { code: c.wa.language }, ...(out.params.length ? { components: [{ type: 'body', parameters: out.params.map((text) => ({ type: 'text', text })) }] } : {}) } }
        : { type: 'text', text: { body: out.text } };
      await providers.sendWhatsApp(providers.waConfig(p.runtime?.wa), num, payload);
    }
    res.json({ ok: true, to });
  } catch (e) {
    throw Object.assign(new Error(providers.friendlyError(e)), { status: e.status || 400 });
  } finally { cleanupUploads(req); }
});

router.post('/', upload.array('attachments', 5), (req, res) => {
  try {
    const p = payloadOf(req);
    const c = { id: db.id('cmp'), ...snapshot(p, req), status: 'ready', createdAt: db.now(), attachments: [] };
    const a = audience(c);
    if (!a.eligible.length) throw bad('No one in this list can receive this campaign. Check the counts in the preview.');

    if (req.files?.length) {
      const dir = path.join(db.dataDir(), 'attachments', c.id);
      fs.mkdirSync(dir, { recursive: true });
      for (const f of req.files) {
        const stored = `${Date.now()}_${f.originalname.replace(/[^\w.-]+/g, '_')}`;
        fs.copyFileSync(f.path, path.join(dir, stored));
        c.attachments.push({ name: f.originalname, stored, type: f.mimetype, size: f.size });
      }
    }

    db.data.campaigns.push(c);
    for (const ct of a.eligible) {
      db.data.messages.push({
        id: db.id('msg'), campaignId: c.id, contactId: ct.id, channel: c.channel,
        to: recipientFor(c.channel, ct), status: 'queued', attempts: 0, createdAt: db.now(),
      });
    }
    jobs.recount(c);
    if (p.startNow !== false && !(c.channel === 'whatsapp' && c.wa.mode === 'links')) {
      try { jobs.start(c, p.runtime); } catch (e) { c.lastError = e.message; }
    }
    db.save();
    res.json(jobs.publicCampaign(c));
  } finally { cleanupUploads(req); }
});

router.get('/:id', (req, res) => {
  const c = findCampaign(req.params.id);
  const status = req.query.status;
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;
  let msgs = db.data.messages.filter((m) => m.campaignId === c.id && (!status || m.status === status));
  const total = msgs.length;
  msgs = msgs.slice(offset, offset + limit).map((m) => {
    const ct = db.data.contacts.find((x) => x.id === m.contactId);
    const row = { ...m, name: ct?.name || '' };
    if (c.channel === 'whatsapp' && c.wa.mode === 'links' && m.status === 'queued' && ct) {
      row.link = `https://wa.me/${m.to}?text=${encodeURIComponent(compose(c, ct).text)}`;
    }
    return row;
  });
  res.json({ campaign: jobs.publicCampaign(c), messages: msgs, total });
});

router.get('/:id/events', (req, res) => {
  const c = findCampaign(req.params.id);
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ campaign: jobs.publicCampaign(c) });
  const key = `campaign:${c.id}`;
  jobs.bus.on(key, send);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); jobs.bus.off(key, send); });
});

router.post('/:id/run', (req, res) => {
  const c = findCampaign(req.params.id);
  if (c.status === 'cancelled') throw bad('This campaign was cancelled.');
  if (req.body?.limit !== undefined) c.delivery.limit = Math.max(0, Number(req.body.limit) || 0);
  try { jobs.start(c, req.body?.runtime); } catch (e) { throw bad(e.message); }
  res.json(jobs.publicCampaign(c));
});

for (const action of ['pause', 'resume', 'cancel']) {
  router.post(`/:id/${action}`, (req, res) => {
    const c = findCampaign(req.params.id);
    if (!jobs.control(c.id, action)) {
      if (action !== 'cancel') throw bad('This campaign is not sending right now.');
      for (const m of db.data.messages) if (m.campaignId === c.id && m.status === 'queued') Object.assign(m, { status: 'skipped', error: 'Campaign cancelled' });
      jobs.recount(c);
      c.status = 'cancelled';
      db.save();
    }
    setTimeout(() => res.json(jobs.publicCampaign(c)), 50);
  });
}

router.post('/:id/retry-failed', (req, res) => {
  const c = findCampaign(req.params.id);
  let n = 0;
  for (const m of db.data.messages) {
    if (m.campaignId === c.id && m.status === 'failed') { m.status = 'queued'; m.error = ''; n += 1; }
  }
  jobs.recount(c);
  if (n && !jobs.isActive(c.id)) c.status = 'ready';
  db.save();
  res.json({ requeued: n, campaign: jobs.publicCampaign(c) });
});

router.post('/:id/messages/:mid', (req, res) => {
  const c = findCampaign(req.params.id);
  const m = db.data.messages.find((x) => x.id === req.params.mid && x.campaignId === c.id);
  if (!m) throw bad('Message not found.', 404);
  const status = req.body?.status;
  if (!['sent', 'queued', 'skipped'].includes(status)) throw bad('Unknown status.');
  Object.assign(m, { status, sentAt: status === 'sent' ? db.now() : m.sentAt, error: status === 'skipped' ? 'Skipped by you' : '', updatedAt: db.now() });
  const s = jobs.recount(c);
  if (!jobs.isActive(c.id) && c.status !== 'cancelled') c.status = s.queued ? 'ready' : 'completed';
  db.save();
  jobs.bus.emit(`campaign:${c.id}`, { campaign: jobs.publicCampaign(c), message: m });
  res.json({ message: m, campaign: jobs.publicCampaign(c) });
});

router.get('/:id/export', (req, res) => {
  const c = findCampaign(req.params.id);
  const rows = db.data.messages.filter((m) => m.campaignId === c.id).map((m) => {
    const ct = db.data.contacts.find((x) => x.id === m.contactId);
    const original = ct?.headers ? Object.fromEntries(ct.headers.map((h) => [h, ct.fields[require('../lib/template').slug(h)] ?? ''])) : {};
    return {
      ...original,
      campaign_name: c.name,
      channel: c.channel,
      sent_to: m.to,
      [`${c.channel}_status`]: m.status,
      sent_at: m.sentAt || '',
      subject: m.subject || '',
      error: m.error || '',
      attempts: m.attempts || 0,
    };
  });
  const file = `${c.name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'campaign'}_results.xlsx`;
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${file}"` });
  res.send(toXlsxBuffer(rows));
});

router.delete('/:id', (req, res) => {
  const c = findCampaign(req.params.id);
  if (jobs.isActive(c.id)) throw bad('Stop this campaign before deleting it.');
  db.data.campaigns = db.data.campaigns.filter((x) => x.id !== c.id);
  db.data.messages = db.data.messages.filter((m) => m.campaignId !== c.id);
  fs.rm(path.join(db.dataDir(), 'attachments', c.id), { recursive: true, force: true }, () => {});
  db.save();
  res.json({ ok: true });
});

module.exports = router;
