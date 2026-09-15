// Sends one message per request. The open campaign page calls this again after each wait,
// so sending works on serverless hosts (Vercel) where nothing runs between requests.
const db = require('./db');
const store = require('./store');
const providers = require('./providers');
const { compose } = require('./compose');

const LOCK_MS = 30 * 1000; // a send may take this long before another request may try
const STUCK_MS = 2 * 60 * 1000; // after this, a half-sent message goes back in the queue

function credentialProblem(c, runtime = {}) {
  if (c.channel === 'email') {
    if (providers.jsonMode()) return '';
    const s = providers.smtpConfig(runtime.smtp);
    return s.user && s.pass ? '' : 'Add your sender email and app password in Settings before sending.';
  }
  if (c.wa.mode === 'links' || providers.waDryRun()) return '';
  const w = providers.waConfig(runtime.wa);
  return w.token && w.phoneNumberId ? '' : 'Add your WhatsApp Cloud API token and phone number ID in Settings before sending.';
}

const gapMs = (d) => (Math.max(0, Number(d.delay) || 0) + Math.random() * Math.max(0, Number(d.jitter) || 0)) * 1000;

async function settle(c) {
  // Another tab may have paused or cancelled while this message was sending.
  const fresh = await db.one('select status from campaigns where id = $1', [c.id]);
  if (fresh && c.status === 'running' && fresh.status !== 'running') c.status = fresh.status;
  const s = await store.recount(c);
  if (c.status === 'running') {
    if (!s.queued) { c.status = 'completed'; c.finishedAt = db.now(); }
    else if (c.runRemaining === 0) c.status = 'ready';
  }
  await store.saveCampaign(c);
}

async function attachmentsFor(c) {
  const rows = await db.q('select name, type, data from attachments where campaign_id = $1', [c.id]);
  return rows.map((a) => ({ filename: a.name, content: Buffer.from(a.data), contentType: a.type || undefined }));
}

async function deliver(c, m, contact, runtime) {
  const out = compose(c, contact);
  const preview = out.text.slice(0, 160);
  if (c.channel === 'email') {
    const smtp = providers.smtpConfig(runtime.smtp);
    const transport = providers.createTransport(smtp);
    try {
      const info = await transport.sendMail({
        from: smtp.fromName ? { name: smtp.fromName, address: smtp.user || 'test@example.com' } : (smtp.user || 'test@example.com'),
        to: m.to,
        replyTo: smtp.replyTo || undefined,
        subject: out.subject,
        text: out.text,
        html: out.html,
        attachments: await attachmentsFor(c),
        headers: c.message.footer && out.unsubscribeUrl ? {
          'List-Unsubscribe': `<${out.unsubscribeUrl}>`,
          ...(out.unsubscribeUrl.startsWith('https:') ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
        } : undefined,
      });
      c.fromAddress = smtp.user;
      return { providerId: info.messageId || '', subject: out.subject, preview };
    } finally { transport.close?.(); }
  }
  const payload = c.wa.mode === 'cloud_template'
    ? { type: 'template', template: {
        name: c.wa.templateName,
        language: { code: c.wa.language || 'en' },
        ...(out.params.length ? { components: [{ type: 'body', parameters: out.params.map((text) => ({ type: 'text', text })) }] } : {}),
      } }
    : { type: 'text', text: { preview_url: true, body: out.text } };
  return { providerId: await providers.sendWhatsApp(providers.waConfig(runtime.wa), m.to, payload), subject: '', preview };
}

async function sendNext(c, runtime = {}) {
  const reply = (extra = {}) => ({ campaign: store.publicCampaign(c), done: c.status !== 'running', waitMs: 0, ...extra });
  if (c.status !== 'running') return reply();

  const problem = credentialProblem(c, runtime);
  if (problem) {
    c.status = 'ready';
    c.lastError = problem;
    await store.saveCampaign(c);
    return reply();
  }

  const t = Date.now();
  // Claim the send slot: one request per campaign at a time, and never before the planned time.
  const slot = await db.one(`update campaigns set next_send_at = $2 where id = $1 and status = 'running'
    and (next_send_at is null or next_send_at <= $3) returning id`, [c.id, t + LOCK_MS, t]);
  if (!slot) {
    const row = await db.one('select next_send_at from campaigns where id = $1', [c.id]);
    return reply({ done: false, waitMs: Math.max(1000, (row?.next_send_at || t) - t) });
  }
  const release = (at) => db.q('update campaigns set next_send_at = $2 where id = $1', [c.id, at]);
  await db.q("update messages set status = 'queued' where campaign_id = $1 and status = 'sending' and claimed_at < $2", [c.id, t - STUCK_MS]);

  if (c.runRemaining === 0) {
    await release(null);
    await settle(c);
    return reply();
  }

  const row = await db.one(`update messages set status = 'sending', claimed_at = $2, attempts = attempts + 1
    where id = (select id from messages where campaign_id = $1 and status = 'queued' order by created_at, id limit 1 for update skip locked)
    returning *`, [c.id, t]);
  if (!row) {
    await release(null);
    await settle(c);
    return reply({ waitMs: c.status === 'running' ? 5000 : 0 });
  }

  const m = db.rowTo.message(row);
  const contact = db.rowTo.contact(await db.one('select * from contacts where id = $1', [m.contactId]));
  const blocked = contact && await db.one('select 1 from suppression where user_id = $1 and value = $2', [c.userId, m.to]);
  let wait = gapMs(c.delivery);
  if (!contact || blocked) {
    await db.q("update messages set status = 'skipped', error = $2, updated_at = $3 where id = $1", [m.id, contact ? 'Unsubscribed' : 'Contact was deleted', db.now()]);
    wait = 0;
  } else {
    try {
      const r = await deliver(c, m, contact, runtime);
      await db.q(`update messages set status = 'sent', error = '', sent_at = $2, updated_at = $2, provider_id = $3, subject = $4, preview = $5
        where id = $1`, [m.id, db.now(), r.providerId, r.subject, r.preview]);
    } catch (e) {
      const friendly = providers.friendlyError(e);
      if (e?.code === 'EAUTH' || /Invalid login|token|OAuth/i.test(e?.message || '')) {
        // A login problem affects every message: stop instead of failing the whole list.
        await db.q("update messages set status = 'queued', attempts = greatest(attempts - 1, 0) where id = $1", [m.id]);
        c.status = 'ready';
        c.lastError = friendly;
        await release(null);
        await settle(c);
        return reply();
      }
      await db.q("update messages set status = 'failed', error = $2, updated_at = $3 where id = $1", [m.id, friendly, db.now()]);
    }
  }

  if (c.runRemaining != null) c.runRemaining = Math.max(0, c.runRemaining - 1);
  await release(Date.now() + wait);
  await settle(c);
  const message = db.rowTo.message(await db.one('select * from messages where id = $1', [m.id]));
  return reply({ message, waitMs: c.status === 'running' ? wait : 0 });
}

module.exports = { sendNext, credentialProblem };
