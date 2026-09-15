// Lightweight JSON document store with debounced, atomic writes.
// Good for a single-team deployment (tens of thousands of contacts).
// Swap this module for Postgres/SQLite when you need multi-instance scale.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DATA_FILE || path.join(__dirname, '..', '..', 'data', 'db.json');
const COLLECTIONS = ['lists', 'contacts', 'templates', 'campaigns', 'messages', 'suppression'];
let data = null;
let timer = null;

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const now = () => new Date().toISOString();

function load() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  data = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
  for (const c of COLLECTIONS) if (!Array.isArray(data[c])) data[c] = [];
  data.meta = data.meta || {};
  if (!data.meta.secret) data.meta.secret = crypto.randomBytes(24).toString('hex');
  if (!data.meta.seeded) { require('./seed')(data); data.meta.seeded = true; }
  // A restart interrupts any sending job; those campaigns become resumable.
  for (const c of data.campaigns) if (c.status === 'running' || c.status === 'paused') c.status = 'ready';
  flush();
  return data;
}

function save() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 250);
}

function flush() {
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
}

const dataDir = () => path.dirname(FILE);

module.exports = { load, save, flush, id, now, dataDir, get data() { return data; } };
