// Accounts, sessions, sign-in throttling and signed unsubscribe links.
const crypto = require('crypto');
const { promisify } = require('util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 864e5;
const FAIL_WINDOW = 15 * 60 * 1000;
// Checked when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = `scrypt$${'0'.repeat(32)}$${'0'.repeat(128)}`;

const hmac = (v) => crypto.createHmac('sha256', db.getSecret()).update(v).digest('base64url');
const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const sessionCutoff = () => new Date(Date.now() - SESSION_MS).toISOString();
const toUser = (r) => r && { id: r.id, name: r.name, email: r.email, passHash: r.pass_hash };

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function tokenFrom(req) {
  return (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [, salt, hash] = String(stored || DUMMY_HASH).split('$');
  const key = await scrypt(String(password), Buffer.from(salt, 'hex'), 64);
  const expected = Buffer.from(hash, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const findUserByEmail = async (email) => toUser(await db.one('select * from users where email = $1', [email]));

// Only a hash of the token is stored, so a leaked database can't be used to sign in.
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.q('delete from sessions where created_at < $1', [sessionCutoff()]);
  await db.q('insert into sessions (id, user_id, created_at) values ($1, $2, $3)', [sha(token), userId, db.now()]);
  return token;
}

async function userFrom(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  return toUser(await db.one('select u.* from sessions s join users u on u.id = s.user_id where s.id = $1 and s.created_at > $2', [sha(token), sessionCutoff()]));
}

async function endSession(req) {
  await db.q('delete from sessions where id = $1', [sha(tokenFrom(req))]);
}

async function requireAuth(req, res, next) {
  const user = await userFrom(req);
  if (!user) return res.status(401).json({ error: 'Sign in to continue.' });
  req.user = user;
  next();
}

// Failed sign-ins are counted in the database so the limit holds across serverless instances.
async function tooManyFailures(ip) {
  const r = await db.one('select n, at from auth_failures where ip = $1', [ip || '']);
  return Boolean(r && Date.now() - r.at < FAIL_WINDOW && r.n >= 10);
}

async function recordFailure(ip) {
  await db.q(`insert into auth_failures (ip, n, at) values ($1, 1, $2)
    on conflict (ip) do update set
      n = case when $2 - auth_failures.at > $3 then 1 else auth_failures.n + 1 end,
      at = case when $2 - auth_failures.at > $3 then $2 else auth_failures.at end`, [ip || '', Date.now(), FAIL_WINDOW]);
}

const publicUser = (u) => (u ? { id: u.id, name: u.name, email: u.email } : null);
const unsubSig = (contactId) => hmac(`unsub:${contactId}`).slice(0, 16);

module.exports = {
  safeEqual, tokenFrom, hashPassword, checkPassword, findUserByEmail, createSession, userFrom, endSession,
  requireAuth, tooManyFailures, recordFailure, publicUser, unsubSig,
};
