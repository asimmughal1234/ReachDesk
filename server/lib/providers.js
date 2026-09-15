const nodemailer = require('nodemailer');

// Runtime credentials come from the request; .env values are optional defaults.
function smtpConfig(r = {}) {
  return {
    user: r.user || process.env.SMTP_USER || '',
    pass: String(r.pass || process.env.SMTP_PASS || '').replace(/\s+/g, ''),
    host: r.host || process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(r.port || process.env.SMTP_PORT || 465),
    fromName: r.fromName || process.env.SMTP_FROM_NAME || '',
    replyTo: r.replyTo || process.env.SMTP_REPLY_TO || '',
  };
}

function waConfig(r = {}) {
  return {
    token: r.token || process.env.WA_TOKEN || '',
    phoneNumberId: r.phoneNumberId || process.env.WA_PHONE_NUMBER_ID || '',
    version: r.version || process.env.WA_API_VERSION || 'v21.0',
  };
}

const jsonMode = () => process.env.MAIL_TRANSPORT === 'json';
const waDryRun = () => process.env.WA_DRY_RUN === '1';

function createTransport(cfg) {
  if (jsonMode()) return nodemailer.createTransport({ jsonTransport: true });
  if (!cfg.user || !cfg.pass) throw new Error('Add your sender email and app password in Settings before sending.');
  return nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass }, pool: true, maxConnections: 1,
  });
}

function friendlyError(e) {
  const msg = e?.message || String(e);
  if (e?.code === 'EAUTH' || /Invalid login|BadCredentials/i.test(msg)) {
    return 'The mail server rejected the login. For Gmail, turn on 2-Step Verification and use a 16-character App Password.';
  }
  if (e?.code === 'ECONNECTION' || e?.code === 'ETIMEDOUT') return `Could not reach the mail server (${msg}). Check host and port.`;
  if (/Daily user sending limit/i.test(msg)) return 'Gmail daily sending limit reached. Continue this campaign tomorrow.';
  return msg;
}

async function sendWhatsApp(cfg, to, payload) {
  if (waDryRun()) return `wamid.dryrun.${Date.now()}`;
  if (!cfg.token || !cfg.phoneNumberId) throw new Error('Add your WhatsApp Cloud API token and phone number ID in Settings.');
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.error_data?.details || j?.error?.message || `WhatsApp API error ${res.status}`);
  return j?.messages?.[0]?.id || '';
}

async function verifyWhatsApp(cfg) {
  if (waDryRun()) return { display_phone_number: 'dry-run', verified_name: 'Dry run' };
  if (!cfg.token || !cfg.phoneNumberId) throw new Error('Token and phone number ID are both required.');
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${cfg.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `WhatsApp API error ${res.status}`);
  return j;
}

module.exports = { smtpConfig, waConfig, createTransport, friendlyError, sendWhatsApp, verifyWhatsApp, jsonMode, waDryRun };
