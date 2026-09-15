const router = require('express').Router();
const multer = require('multer');
const db = require('../lib/db');
const store = require('../lib/store');
const sender = require('../lib/sender');
const providers = require('../lib/providers');
const { compose, suppressedSet, recipientFor, contactedSet } = require('../lib/compose');
const { buildVars, missingKeys, slug } = require('../lib/template');
const { toXlsxBuffer } = require('../lib/importer');

// Vercel rejects request bodies over 4.5 MB, so attachments share a 4 MB budget.
const MAX_ATTACH = 4 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACH, files: 5 } });

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const payloadOf = (req) => {
  if (typeof req.body?.payload !== 'string') return req.body || {};
  try { return JSON.parse(req.body.payload); } catch { throw bad('The campaign data could not be read. Reload the page and try again.'); }
};
const baseUrl = (req) => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
const findCampaign = async (id, req) => {
  const c = await store.loadCampaign(id, req.user.id);
  if (!c) throw bad('Campaign not found.', 404);
  return c;
};
const checkAttachments = (req) => {
  if ((req.files || []).reduce((n, f) => n + f.size, 0) > MAX_ATTACH) throw bad('Attachments can total 4 MB at most.', 413);
};

// Turns the composer payload into a stored campaign snapshot (never includes credentials).
async function snapshot(p, req) {
  const channel = p.channel === 'whatsapp' ? 'whatsapp' : 'email';
  const list = db.rowTo.list(await db.one('select * from lists where id = $1 and user_id = $2', [p.listId, req.user.id]));
  if (!list) throw bad('Choose a contact list.');
  const m = p.message || {};
  if (channel === 'email' && !String(m.subject || '').trim()) throw bad('Add a subject line.');
  const wa = { mode: 'links', templateName: '', language: 'en', params: [], ...(p.wa || {}) };
  if (channel === 'whatsapp' && wa.mode === 'cloud_template' && !wa.templateName) throw bad('Enter the approved WhatsApp template name.');
  if (!String(m.body || '').trim() && !(channel === 'whatsapp' && wa.mode === 'cloud_template')) throw bad('The message body is empty.');
  const d = p.delivery || {};
  return {
    userId: req.user.id,
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

async function audience(c) {
  const contacts = (await db.q('select * from contacts where list_id = $1 order by created_at, id', [c.listId])).map(db.rowTo.contact);
  const suppressed = await suppressedSet(c.userId);
  const contacted = c.delivery.skipContacted ? await contactedSet(c.channel, c.userId) : new Set();
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

async function contactsById(ids) {
  if (!ids.length) return new Map();
  const rows = await db.q('select * from contacts where id in (select jsonb_array_elements_text($1::text::jsonb))', [db.json(ids)]);
  return new Map(rows.map((r) => [r.id, db.rowTo.contact(r)]));
}

router.get('/', async (req, res) => {
  const rows = await db.q('select * from campaigns where user_id = $1 order by created_at desc', [req.user.id]);
  res.json(rows.map((r) => store.publicCampaign(db.rowTo.campaign(r))));
});

router.post('/preview', async (req, res) => {
  const c = await snapshot(req.body, req);
  const a = await audience(c);
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
    checkAttachments(req);
    const p = payloadOf(req);
    const c = await snapshot(p, req);
    const to = String(p.test?.to || '').trim();
    if (!to) throw bad(c.channel === 'email' ? 'Enter an email address for the test.' : 'Enter a WhatsApp number for the test.');
    const sample = (await audience(c)).eligible[0]
      || db.rowTo.contact(await db.one('select * from contacts where list_id = $1 order by created_at limit 1', [c.listId])) || {};
    const out = compose(c, sample);
    if (c.channel === 'email') {
      const smtp = providers.smtpConfig(p.runtime?.smtp);
      const t = providers.createTransport(smtp);
      try {
        await t.sendMail({
          from: smtp.fromName ? { name: smtp.fromName, address: smtp.user || 'test@example.com' } : smtp.user || 'test@example.com',
          to, replyTo: smtp.replyTo || undefined,
          subject: `[Test] ${out.subject}`, text: out.text, html: out.html,
          attachments: (req.files || []).map((f) => ({ filename: f.originalname, content: f.buffer, contentType: f.mimetype })),
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
  }
});

router.post('/', upload.array('attachments', 5), async (req, res) => {
  checkAttachments(req);
  const p = payloadOf(req);
  const c = { id: db.id('cmp'), ...(await snapshot(p, req)), status: 'ready', createdAt: db.now(), attachments: [], runRemaining: null };
  const a = await audience(c);
  if (!a.eligible.length) throw bad('No one in this list can receive this campaign. Check the counts in the preview.');

  const links = c.channel === 'whatsapp' && c.wa.mode === 'links';
  if (p.startNow !== false && !links) {
    const problem = sender.credentialProblem(c, p.runtime);
    if (problem) c.lastError = problem;
    else Object.assign(c, { status: 'running', runRemaining: c.delivery.limit || null, lastRunAt: db.now() });
  }
  c.attachments = (req.files || []).map((f) => ({ id: db.id('att'), name: f.originalname, type: f.mimetype, size: f.size }));
  await store.insertCampaign(c);
  for (const [i, f] of (req.files || []).entries()) {
    const att = c.attachments[i];
    await db.q('insert into attachments (id, campaign_id, name, type, size, data) values ($1, $2, $3, $4, $5, $6)', [att.id, c.id, att.name, att.type, att.size, f.buffer]);
  }
  // Timestamps a millisecond apart keep the list order as the send order.
  const base = Date.now();
  await db.insertMany('messages', db.COLS.messages, a.eligible.map((ct, i) => db.toRow.message({
    id: db.id('msg'), userId: c.userId, campaignId: c.id, contactId: ct.id, channel: c.channel,
    to: recipientFor(c.channel, ct), status: 'queued', createdAt: new Date(base + i).toISOString(),
  })));
  await store.recount(c);
  await store.saveCampaign(c);
  res.json(store.publicCampaign(c));
});

router.get('/:id', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  const status = String(req.query.status || '');
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const where = "m.campaign_id = $1 and ($2 = '' or m.status = $2 or ($2 = 'queued' and m.status = 'sending'))";
  const [{ n }] = await db.q(`select count(*)::int as n from messages m where ${where}`, [c.id, status]);
  const rows = await db.q(`select m.*, ct.name as contact_name from messages m left join contacts ct on ct.id = m.contact_id
    where ${where} order by m.created_at, m.id limit $3 offset $4`, [c.id, status, limit, offset]);
  const links = c.channel === 'whatsapp' && c.wa.mode === 'links';
  const contacts = links ? await contactsById(rows.filter((r) => r.status === 'queued').map((r) => r.contact_id)) : new Map();
  const messages = rows.map((r) => {
    const m = { ...db.rowTo.message(r), name: r.contact_name || '' };
    const ct = contacts.get(r.contact_id);
    if (links && m.status === 'queued' && ct) m.link = `https://wa.me/${m.to}?text=${encodeURIComponent(compose(c, ct).text)}`;
    return m;
  });
  res.json({ campaign: store.publicCampaign(c), messages, total: n });
});

router.post('/:id/run', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  if (c.status === 'cancelled') throw bad('This campaign was cancelled.');
  if (c.status === 'running') throw bad('This campaign is already sending.');
  if (c.channel === 'whatsapp' && c.wa.mode === 'links') throw bad('Click-to-chat campaigns are sent by hand from the campaign page.');
  if (req.body?.limit !== undefined) c.delivery.limit = Math.max(0, Number(req.body.limit) || 0);
  const problem = sender.credentialProblem(c, req.body?.runtime);
  if (problem) throw bad(problem);
  Object.assign(c, { status: 'running', runRemaining: c.delivery.limit || null, lastRunAt: db.now(), lastError: '' });
  await store.saveCampaign(c);
  await db.q('update campaigns set next_send_at = null where id = $1', [c.id]);
  res.json(store.publicCampaign(c));
});

router.post('/:id/send-next', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  res.json(await sender.sendNext(c, req.body?.runtime || {}));
});

router.post('/:id/pause', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  if (c.status !== 'running') throw bad('This campaign is not sending right now.');
  c.status = 'paused';
  await store.saveCampaign(c);
  res.json(store.publicCampaign(c));
});

router.post('/:id/resume', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  if (c.status !== 'paused') throw bad('This campaign is not paused.');
  c.status = 'running';
  await store.saveCampaign(c);
  res.json(store.publicCampaign(c));
});

router.post('/:id/cancel', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  if (c.status !== 'cancelled') {
    await db.q("update messages set status = 'skipped', error = 'Campaign cancelled', updated_at = $2 where campaign_id = $1 and status in ('queued', 'sending')", [c.id, db.now()]);
    c.status = 'cancelled';
    await store.recount(c);
    await store.saveCampaign(c);
  }
  res.json(store.publicCampaign(c));
});

router.post('/:id/retry-failed', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  const rows = await db.q("update messages set status = 'queued', error = '' where campaign_id = $1 and status = 'failed' returning id", [c.id]);
  if (rows.length && c.status !== 'running') c.status = 'ready';
  await store.recount(c);
  await store.saveCampaign(c);
  res.json({ requeued: rows.length, campaign: store.publicCampaign(c) });
});

router.post('/:id/messages/:mid', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  const status = req.body?.status;
  if (!['sent', 'queued', 'skipped'].includes(status)) throw bad('Unknown status.');
  const row = await db.one(`update messages set status = $3,
      sent_at = case when $3 = 'sent' then $4 else sent_at end,
      error = case when $3 = 'skipped' then 'Skipped by you' else '' end,
      updated_at = $4
    where id = $1 and campaign_id = $2 returning *`, [req.params.mid, c.id, status, db.now()]);
  if (!row) throw bad('Message not found.', 404);
  const s = await store.recount(c);
  if (c.status !== 'running' && c.status !== 'cancelled') c.status = s.queued ? 'ready' : 'completed';
  await store.saveCampaign(c);
  res.json({ message: db.rowTo.message(row), campaign: store.publicCampaign(c) });
});

router.get('/:id/export', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  const rows = await db.q(`select m.*, ct.headers, ct.fields from messages m left join contacts ct on ct.id = m.contact_id
    where m.campaign_id = $1 order by m.created_at, m.id`, [c.id]);
  const out = rows.map((r) => {
    const m = db.rowTo.message(r);
    const original = r.headers ? Object.fromEntries(r.headers.map((h) => [h, r.fields?.[slug(h)] ?? ''])) : {};
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
  res.send(toXlsxBuffer(out));
});

router.delete('/:id', async (req, res) => {
  const c = await findCampaign(req.params.id, req);
  if (c.status === 'running') throw bad('Pause this campaign before deleting it.');
  await db.q('delete from campaigns where id = $1', [c.id]); // messages and attachments go with it
  res.json({ ok: true });
});

module.exports = router;
