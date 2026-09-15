// In-process sending queue with pause / resume / cancel and live events.
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const db = require('./db');
const providers = require('./providers');
const { compose, suppressedSet } = require('./compose');

const bus = new EventEmitter();
bus.setMaxListeners(0);
const active = new Map();

const sleep = (ms, ctl) => new Promise((resolve) => {
  const t = setTimeout(resolve, ms);
  ctl.wake = () => { clearTimeout(t); resolve(); };
});

function recount(c) {
  const s = { total: 0, sent: 0, failed: 0, skipped: 0, queued: 0 };
  for (const m of db.data.messages) {
    if (m.campaignId !== c.id) continue;
    s.total += 1;
    s[m.status] = (s[m.status] || 0) + 1;
  }
  c.stats = s;
  return s;
}

function emit(c, message) {
  bus.emit(`campaign:${c.id}`, { campaign: publicCampaign(c), message });
}

function publicCampaign(c) {
  const ctl = active.get(c.id);
  return { ...c, status: ctl ? (ctl.paused ? 'paused' : 'running') : c.status };
}

function attachmentsFor(c) {
  return (c.attachments || []).map((a) => ({
    filename: a.name, path: path.join(db.dataDir(), 'attachments', c.id, a.stored), contentType: a.type,
  })).filter((a) => fs.existsSync(a.path));
}

function start(campaign, runtime = {}) {
  if (active.has(campaign.id)) throw new Error('This campaign is already sending.');
  if (campaign.channel === 'whatsapp' && campaign.wa.mode === 'links') {
    throw new Error('Click-to-chat campaigns are sent by hand from the campaign page.');
  }
  const smtp = providers.smtpConfig(runtime.smtp);
  const wa = providers.waConfig(runtime.wa);
  let transport = null;
  if (campaign.channel === 'email') transport = providers.createTransport(smtp); // throws early on missing creds
  else if (!providers.waDryRun() && (!wa.token || !wa.phoneNumberId)) {
    throw new Error('Add your WhatsApp Cloud API token and phone number ID in Settings before sending.');
  }
  if (campaign.channel === 'email') campaign.fromAddress = smtp.user;

  const ctl = { paused: false, cancelled: false, wake: null };
  active.set(campaign.id, ctl);
  campaign.status = 'running';
  campaign.lastRunAt = db.now();
  campaign.lastError = '';
  db.save();
  emit(campaign);
  loop(campaign, ctl, { transport, smtp, wa }).catch((e) => console.error('job crashed', e));
}

async function loop(c, ctl, { transport, smtp, wa }) {
  const d = c.delivery;
  const limit = Number(d.limit) > 0 ? Number(d.limit) : Infinity;
  const queue = db.data.messages.filter((m) => m.campaignId === c.id && m.status === 'queued').slice(0, limit);
  const attachments = c.channel === 'email' ? attachmentsFor(c) : [];
  const suppressed = suppressedSet();

  try {
    for (let i = 0; i < queue.length; i += 1) {
      while (ctl.paused && !ctl.cancelled) await sleep(1000, ctl);
      if (ctl.cancelled) break;
      const m = queue[i];
      if (m.status !== 'queued') continue;
      const contact = db.data.contacts.find((x) => x.id === m.contactId);

      if (!contact || suppressed.has(m.to)) {
        Object.assign(m, { status: 'skipped', error: contact ? 'Unsubscribed' : 'Contact was deleted', updatedAt: db.now() });
      } else {
        const out = compose(c, contact);
        m.attempts = (m.attempts || 0) + 1;
        try {
          if (c.channel === 'email') {
            const info = await transport.sendMail({
              from: smtp.fromName ? { name: smtp.fromName, address: smtp.user || 'test@example.com' } : (smtp.user || 'test@example.com'),
              to: m.to,
              replyTo: smtp.replyTo || undefined,
              subject: out.subject,
              text: out.text,
              html: out.html,
              attachments,
              headers: c.message.footer && out.unsubscribeUrl ? {
                'List-Unsubscribe': `<${out.unsubscribeUrl}>`,
                ...(out.unsubscribeUrl.startsWith('https:') ? { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : {}),
              } : undefined,
            });
            m.providerId = info.messageId || '';
            m.subject = out.subject;
          } else {
            const payload = c.wa.mode === 'cloud_template'
              ? { type: 'template', template: {
                  name: c.wa.templateName,
                  language: { code: c.wa.language || 'en' },
                  ...(out.params.length ? { components: [{ type: 'body', parameters: out.params.map((text) => ({ type: 'text', text })) }] } : {}),
                } }
              : { type: 'text', text: { preview_url: true, body: out.text } };
            m.providerId = await providers.sendWhatsApp(wa, m.to, payload);
          }
          Object.assign(m, { status: 'sent', error: '', sentAt: db.now(), preview: out.text.slice(0, 160), updatedAt: db.now() });
        } catch (e) {
          const friendly = providers.friendlyError(e);
          if (e?.code === 'EAUTH' || /Invalid login|token|OAuth/i.test(e?.message || '')) {
            // Credential problems affect every message: stop instead of failing the whole list.
            m.status = 'queued';
            c.lastError = friendly;
            recount(c); emit(c, m);
            break;
          }
          Object.assign(m, { status: 'failed', error: friendly, updatedAt: db.now() });
        }
      }
      recount(c);
      db.save();
      emit(c, m);

      if (i < queue.length - 1 && !ctl.cancelled) {
        const base = Math.max(0, Number(d.delay) || 0) * 1000;
        const jitter = Math.random() * Math.max(0, Number(d.jitter) || 0) * 1000;
        await sleep(base + jitter, ctl);
      }
    }
  } finally {
    if (transport?.close) transport.close();
    active.delete(c.id);
    if (ctl.cancelled) {
      for (const m of db.data.messages) {
        if (m.campaignId === c.id && m.status === 'queued') Object.assign(m, { status: 'skipped', error: 'Campaign cancelled' });
      }
    }
    const s = recount(c);
    c.status = ctl.cancelled ? 'cancelled' : s.queued > 0 ? 'ready' : 'completed';
    if (c.status === 'completed') c.finishedAt = db.now();
    db.save();
    emit(c);
  }
}

function control(id, action) {
  const ctl = active.get(id);
  if (!ctl) return false;
  if (action === 'pause') ctl.paused = true;
  if (action === 'resume') ctl.paused = false;
  if (action === 'cancel') { ctl.cancelled = true; ctl.wake?.(); }
  return true;
}

module.exports = { bus, start, control, recount, publicCampaign, isActive: (id) => active.has(id) };
