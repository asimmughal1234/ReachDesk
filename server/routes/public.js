// Unauthenticated routes: accounts and unsubscribe pages.
const router = require('express').Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const store = require('../lib/store');
const seed = require('../lib/seed');
const { esc } = require('../lib/template');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slowDown = { error: 'Too many attempts. Wait 15 minutes and try again.' };
const taken = { error: 'An account with this email already exists. Sign in instead.' };

router.get('/api/auth/status', async (req, res) => {
  const user = await auth.userFrom(req);
  const { n } = await db.one('select count(*)::int as n from users');
  res.json({ ok: Boolean(user), user: auth.publicUser(user), signupOpen: Boolean(process.env.SIGNUP_CODE), setup: n === 0 });
});

router.post('/api/auth/signup', async (req, res) => {
  if (!process.env.SIGNUP_CODE) return res.status(403).json({ error: 'Sign-up is turned off. The admin needs to set SIGNUP_CODE on the server.' });
  if (await auth.tooManyFailures(req.ip)) return res.status(429).json(slowDown);
  const { name = '', email = '', password = '', invite = '' } = req.body || {};
  if (!auth.safeEqual(String(invite).trim(), process.env.SIGNUP_CODE)) {
    await auth.recordFailure(req.ip);
    return res.status(403).json({ error: 'That invite code is not correct.' });
  }
  const mail = String(email).trim().toLowerCase();
  if (!EMAIL.test(mail)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Use a password with at least 8 characters.' });
  if (await auth.findUserByEmail(mail)) return res.status(409).json(taken);

  const user = { id: db.id('usr'), name: String(name).trim().slice(0, 80), email: mail };
  const first = (await db.one('select count(*)::int as n from users')).n === 0;
  try {
    await db.q('insert into users (id, name, email, pass_hash, created_at) values ($1, $2, $3, $4, $5)',
      [user.id, user.name, mail, await auth.hashPassword(password), db.now()]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json(taken);
    throw e;
  }
  // The first account keeps everything saved before accounts existed; everyone gets the starter templates.
  if (first) await db.claimUnowned(user.id);
  if (!(await db.one('select 1 from templates where user_id = $1 limit 1', [user.id]))) await store.addTemplates(user.id, seed());
  res.json({ token: await auth.createSession(user.id), user: auth.publicUser(user) });
});

router.post('/api/auth/login', async (req, res) => {
  if (await auth.tooManyFailures(req.ip)) return res.status(429).json(slowDown);
  const user = await auth.findUserByEmail(String(req.body?.email || '').trim().toLowerCase());
  const ok = await auth.checkPassword(req.body?.password || '', user?.passHash);
  if (!user || !ok) {
    await auth.recordFailure(req.ip);
    return res.status(401).json({ error: 'That email or password is not correct.' });
  }
  res.json({ token: await auth.createSession(user.id), user: auth.publicUser(user) });
});

router.post('/api/auth/logout', async (req, res) => {
  await auth.endSession(req);
  res.json({ ok: true });
});

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F7F6;color:#1D2B29;font:16px/1.6 system-ui,sans-serif}
main{background:#fff;border:1px solid #dde5e3;border-radius:14px;padding:40px;max-width:420px;margin:20px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#56655f}
button{margin-top:20px;background:#17806D;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;

async function unsubscribe(req) {
  const { cid, sig } = req.params;
  if (!auth.safeEqual(sig, auth.unsubSig(cid))) return null;
  const contact = db.rowTo.contact(await db.one('select * from contacts where id = $1', [cid]));
  if (!contact) return null;
  for (const value of [contact.email, contact.phone].filter(Boolean)) {
    await db.q(`insert into suppression (id, user_id, value, reason, at) values ($1, $2, $3, 'Unsubscribed via link', $4)
      on conflict (user_id, value) do nothing`, [db.id('sup'), contact.userId, value, db.now()]);
  }
  return contact;
}

router.get('/u/preview', (req, res) => res.send(page('Unsubscribe', '<h1>Unsubscribe link</h1><p>Recipients see a working link here. This one is a preview.</p>')));

router.get('/u/:cid/:sig', (req, res) => {
  const { cid, sig } = req.params;
  if (!auth.safeEqual(sig, auth.unsubSig(cid))) return res.status(404).send(page('Link not valid', '<h1>This link is not valid</h1><p>It may have been copied incompletely.</p>'));
  res.send(page('Unsubscribe', `<h1>Stop receiving these messages?</h1><p>You will not get further emails or WhatsApp messages from this sender.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`));
});

router.post('/u/:cid/:sig', async (req, res) => {
  const c = await unsubscribe(req);
  if (!c) return res.status(404).send(page('Link not valid', '<h1>This link is not valid</h1>'));
  res.send(page('Unsubscribed', '<h1>You are unsubscribed</h1><p>We will not contact you again.</p>'));
});

module.exports = router;
