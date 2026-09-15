// Postgres storage. Uses Neon (or any Postgres) when DATABASE_URL is set; otherwise an
// embedded Postgres (PGlite) kept in data/pglite, so running locally needs no setup.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const LEGACY_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'db.json');
const OWNED = ['lists', 'contacts', 'templates', 'campaigns', 'messages', 'suppression'];

const SCHEMA = `
create table if not exists meta (key text primary key, value text not null);
create table if not exists users (id text primary key, name text not null default '', email text not null unique, pass_hash text not null, created_at text not null);
create table if not exists sessions (id text primary key, user_id text not null references users(id) on delete cascade, created_at text not null);
create table if not exists auth_failures (ip text primary key, n int not null, at double precision not null);
create table if not exists lists (id text primary key, user_id text, name text not null, source text, created_at text not null, updated_at text);
create index if not exists lists_user on lists(user_id);
create table if not exists contacts (id text primary key, user_id text, list_id text not null references lists(id) on delete cascade, name text not null default '', email text, phone text,
  fields jsonb not null default '{}', headers jsonb not null default '[]', tags jsonb not null default '[]', created_at text not null);
create index if not exists contacts_list on contacts(list_id);
create table if not exists templates (id text primary key, user_id text, channel text not null, name text not null, subject text not null default '', body text not null, created_at text not null, updated_at text not null);
create index if not exists templates_user on templates(user_id);
create table if not exists campaigns (id text primary key, user_id text, status text not null, run_remaining int, next_send_at double precision, doc jsonb not null, created_at text not null);
create index if not exists campaigns_user on campaigns(user_id);
create table if not exists messages (id text primary key, user_id text, campaign_id text not null references campaigns(id) on delete cascade, contact_id text, channel text not null,
  recipient text not null, status text not null, attempts int not null default 0, error text not null default '', provider_id text not null default '',
  subject text not null default '', preview text not null default '', sent_at text, claimed_at double precision, created_at text not null, updated_at text);
create index if not exists messages_campaign on messages(campaign_id, status);
create index if not exists messages_user on messages(user_id, channel, status);
create table if not exists suppression (id text primary key, user_id text, value text not null, reason text not null default '', at text not null, unique (user_id, value));
create table if not exists attachments (id text primary key, campaign_id text not null references campaigns(id) on delete cascade, name text not null, type text not null default '', size int not null default 0, data bytea not null);
create table if not exists imports (id text primary key, user_id text not null, source text not null, sheets jsonb not null, created_at double precision not null);
`;

// Column types for bulk inserts; keys match the table columns.
const COLS = {
  lists: { id: 'text', user_id: 'text', name: 'text', source: 'text', created_at: 'text', updated_at: 'text' },
  contacts: { id: 'text', user_id: 'text', list_id: 'text', name: 'text', email: 'text', phone: 'text', fields: 'jsonb', headers: 'jsonb', tags: 'jsonb', created_at: 'text' },
  templates: { id: 'text', user_id: 'text', channel: 'text', name: 'text', subject: 'text', body: 'text', created_at: 'text', updated_at: 'text' },
  campaigns: { id: 'text', user_id: 'text', status: 'text', run_remaining: 'int', next_send_at: 'double precision', doc: 'jsonb', created_at: 'text' },
  messages: { id: 'text', user_id: 'text', campaign_id: 'text', contact_id: 'text', channel: 'text', recipient: 'text', status: 'text', attempts: 'int', error: 'text',
    provider_id: 'text', subject: 'text', preview: 'text', sent_at: 'text', created_at: 'text', updated_at: 'text' },
  suppression: { id: 'text', user_id: 'text', value: 'text', reason: 'text', at: 'text' },
};

let client = null;
let readyPromise = null;
let secret = '';

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();
const json = (v) => JSON.stringify(v ?? null);

// App objects (camelCase) to table rows (snake_case), with every NOT NULL column filled.
const toRow = {
  list: (x) => ({ id: x.id, user_id: x.userId || null, name: String(x.name || ''), source: x.source || '', created_at: x.createdAt || now(), updated_at: x.updatedAt || null }),
  contact: (x) => ({ id: x.id, user_id: x.userId || null, list_id: x.listId, name: String(x.name ?? ''), email: x.email || null, phone: x.phone || null,
    fields: x.fields || {}, headers: x.headers || [], tags: x.tags || [], created_at: x.createdAt || now() }),
  template: (x) => ({ id: x.id, user_id: x.userId || null, channel: x.channel || 'email', name: x.name || 'Template', subject: x.subject || '', body: x.body || '',
    created_at: x.createdAt || now(), updated_at: x.updatedAt || x.createdAt || now() }),
  campaign: (x) => {
    const { id: cid, userId, status, runRemaining, nextSendAt, createdAt, ...doc } = x;
    return { id: cid, user_id: userId || null, status: status || 'ready', run_remaining: runRemaining ?? null, next_send_at: nextSendAt ?? null, doc, created_at: createdAt || now() };
  },
  message: (x) => ({ id: x.id, user_id: x.userId || null, campaign_id: x.campaignId, contact_id: x.contactId || null, channel: x.channel, recipient: x.to || '',
    status: x.status || 'queued', attempts: x.attempts || 0, error: x.error || '', provider_id: x.providerId || '', subject: x.subject || '', preview: x.preview || '',
    sent_at: x.sentAt || null, created_at: x.createdAt || now(), updated_at: x.updatedAt || null }),
  suppression: (x) => ({ id: x.id || id('sup'), user_id: x.userId || null, value: x.value, reason: x.reason || '', at: x.at || now() }),
};

const rowTo = {
  list: (r) => r && { id: r.id, userId: r.user_id, name: r.name, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at },
  contact: (r) => r && { id: r.id, userId: r.user_id, listId: r.list_id, name: r.name, email: r.email, phone: r.phone,
    fields: r.fields || {}, headers: r.headers || [], tags: r.tags || [], createdAt: r.created_at },
  template: (r) => r && { id: r.id, userId: r.user_id, channel: r.channel, name: r.name, subject: r.subject, body: r.body, createdAt: r.created_at, updatedAt: r.updated_at },
  campaign: (r) => r && { ...r.doc, id: r.id, userId: r.user_id, status: r.status, runRemaining: r.run_remaining, nextSendAt: r.next_send_at, createdAt: r.created_at },
  // "sending" is internal: the page shows it as still waiting.
  message: (r) => r && { id: r.id, userId: r.user_id, campaignId: r.campaign_id, contactId: r.contact_id, channel: r.channel, to: r.recipient,
    status: r.status === 'sending' ? 'queued' : r.status, attempts: r.attempts, error: r.error, providerId: r.provider_id, subject: r.subject,
    preview: r.preview, sentAt: r.sent_at, createdAt: r.created_at, updatedAt: r.updated_at },
};

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    pool.on('error', (e) => console.error('Database connection error:', e.message));
    return { query: async (text, params) => (await pool.query(text, params)).rows, exec: (sql) => pool.query(sql), close: () => pool.end() };
  }
  if (process.env.VERCEL) throw new Error('DATABASE_URL is not set. Add your Neon connection string in the Vercel project settings.');
  const { PGlite } = await import('@electric-sql/pglite');
  const dir = process.env.PGLITE_DIR || path.join(DATA_DIR, 'pglite');
  fs.mkdirSync(dir, { recursive: true });
  const local = new PGlite(dir);
  return { query: async (text, params) => (await local.query(text, params)).rows, exec: (sql) => local.exec(sql), close: () => local.close() };
}

// One statement for many rows, so large imports stay fast over the network.
async function insertMany(table, columns, rows, run = q) {
  const names = Object.keys(columns).join(', ');
  const defs = Object.entries(columns).map(([k, t]) => `${k} ${t}`).join(', ');
  for (let i = 0; i < rows.length; i += 500) {
    await run(`insert into ${table} (${names}) select ${names} from jsonb_to_recordset($1::text::jsonb) as x(${defs}) on conflict do nothing`,
      [JSON.stringify(rows.slice(i, i + 500))]);
  }
}

function legacySecret() {
  try { return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).meta?.secret || ''; } catch { return ''; }
}

// Copies data/db.json (the store before Postgres) into the database once, owned by nobody
// until the first account signs up and claims it.
async function importLegacy(run) {
  if ((await run("select value from meta where key = 'legacy_import'"))[0]) return;
  const [{ n }] = await run('select count(*)::int as n from users');
  if (n === 0 && fs.existsSync(LEGACY_FILE)) {
    const d = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
    const lists = d.lists || [];
    const listIds = new Set(lists.map((l) => l.id));
    const campaigns = (d.campaigns || []).map((c) => ({ ...c, status: ['running', 'paused'].includes(c.status) ? 'ready' : c.status }));
    const campaignIds = new Set(campaigns.map((c) => c.id));
    const put = (table, rows, map) => insertMany(table, COLS[table], rows.map((x) => map({ ...x, userId: null })), run);
    await put('lists', lists, toRow.list);
    await put('contacts', (d.contacts || []).filter((x) => listIds.has(x.listId)), toRow.contact);
    await put('templates', d.templates || [], toRow.template);
    await put('campaigns', campaigns, toRow.campaign);
    await put('messages', (d.messages || []).filter((m) => campaignIds.has(m.campaignId)), toRow.message);
    await put('suppression', (d.suppression || []).filter((s) => s.value), toRow.suppression);
    console.log(`Copied existing data from ${path.basename(LEGACY_FILE)} into the database.`);
  }
  await run("insert into meta (key, value) values ('legacy_import', $1) on conflict (key) do nothing", [now()]);
}

async function init() {
  client = await connect();
  const run = (text, params) => client.query(text, params);
  await client.exec(SCHEMA);
  const [row] = await run("select value from meta where key = 'secret'");
  if (row) secret = row.value;
  else {
    // Keep the old secret so unsubscribe links in emails already sent keep working.
    await run("insert into meta (key, value) values ('secret', $1) on conflict (key) do nothing", [legacySecret() || crypto.randomBytes(24).toString('hex')]);
    secret = (await run("select value from meta where key = 'secret'"))[0].value;
  }
  await importLegacy(run);
}

function ready() {
  if (!readyPromise) readyPromise = init().catch((e) => { readyPromise = null; throw e; });
  return readyPromise;
}

async function q(text, params = []) {
  await ready();
  return client.query(text, params);
}
const one = async (text, params) => (await q(text, params))[0] || null;

// Records saved before accounts existed go to whoever signs up first.
async function claimUnowned(userId) {
  for (const t of OWNED) await q(`update ${t} set user_id = $1 where user_id is null`, [userId]);
}

async function close() {
  if (client) await client.close();
}

module.exports = { ready, q, one, id, now, json, insertMany, COLS, toRow, rowTo, claimUnowned, getSecret: () => secret, close };
