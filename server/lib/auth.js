const crypto = require('crypto');
const db = require('./db');

const hmac = (v) => crypto.createHmac('sha256', db.data.meta.secret).update(v).digest('base64url');
const required = () => Boolean(process.env.APP_PASSWORD);
const sessionToken = () => hmac(`session:${process.env.APP_PASSWORD}`);

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function tokenFrom(req) {
  return (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
}

function requireAuth(req, res, next) {
  if (!required() || safeEqual(tokenFrom(req), sessionToken())) return next();
  res.status(401).json({ error: 'Sign in to continue.' });
}

const unsubSig = (contactId) => hmac(`unsub:${contactId}`).slice(0, 16);

module.exports = { required, sessionToken, safeEqual, tokenFrom, requireAuth, unsubSig };
