// Unauthenticated routes: login and unsubscribe pages.
const router = require('express').Router();
const db = require('../lib/db');
const auth = require('../lib/auth');
const { esc } = require('../lib/template');

router.get('/api/auth/status', (req, res) => {
  res.json({ required: auth.required(), ok: !auth.required() || auth.safeEqual(auth.tokenFrom(req), auth.sessionToken()) });
});

router.post('/api/auth/login', (req, res) => {
  if (!auth.required()) return res.json({ token: '' });
  if (!auth.safeEqual(String(req.body?.password || ''), process.env.APP_PASSWORD)) {
    return res.status(401).json({ error: 'That password is not correct.' });
  }
  res.json({ token: auth.sessionToken() });
});

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F7F6;color:#1D2B29;font:16px/1.6 system-ui,sans-serif}
main{background:#fff;border:1px solid #dde5e3;border-radius:14px;padding:40px;max-width:420px;margin:20px}h1{font-size:22px;margin:0 0 8px}p{margin:0;color:#56655f}
button{margin-top:20px;background:#17806D;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:inherit;cursor:pointer}</style></head><body><main>${body}</main></body></html>`;

function unsubscribe(req) {
  const { cid, sig } = req.params;
  if (!auth.safeEqual(sig, auth.unsubSig(cid))) return null;
  const contact = db.data.contacts.find((c) => c.id === cid);
  if (!contact) return null;
  for (const value of [contact.email, contact.phone].filter(Boolean)) {
    if (!db.data.suppression.some((s) => s.value === value)) db.data.suppression.push({ value, reason: 'Unsubscribed via link', at: db.now() });
  }
  db.save();
  return contact;
}

router.get('/u/preview', (req, res) => res.send(page('Unsubscribe', '<h1>Unsubscribe link</h1><p>Recipients see a working link here. This one is a preview.</p>')));

router.get('/u/:cid/:sig', (req, res) => {
  const { cid, sig } = req.params;
  if (!auth.safeEqual(sig, auth.unsubSig(cid))) return res.status(404).send(page('Link not valid', '<h1>This link is not valid</h1><p>It may have been copied incompletely.</p>'));
  res.send(page('Unsubscribe', `<h1>Stop receiving these messages?</h1><p>You will not get further emails or WhatsApp messages from this sender.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`));
});

router.post('/u/:cid/:sig', (req, res) => {
  const c = unsubscribe(req);
  if (!c) return res.status(404).send(page('Link not valid', '<h1>This link is not valid</h1>'));
  res.send(page('Unsubscribed', '<h1>You are unsubscribed</h1><p>We will not contact you again.</p>'));
});

module.exports = router;
