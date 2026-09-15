// Campaign and template persistence shared by the routes and the sender.
const db = require('./db');

async function loadCampaign(id, userId) {
  return db.rowTo.campaign(await db.one('select * from campaigns where id = $1 and user_id = $2', [id, userId]));
}

async function insertCampaign(c) {
  await db.insertMany('campaigns', db.COLS.campaigns, [db.toRow.campaign(c)]);
}

// next_send_at is left alone here: the sender owns it, so two tabs can't send at once.
async function saveCampaign(c) {
  const { doc } = db.toRow.campaign(c);
  await db.q('update campaigns set status = $2, run_remaining = $3, doc = $4::text::jsonb where id = $1', [c.id, c.status, c.runRemaining ?? null, db.json(doc)]);
}

async function recount(c) {
  const rows = await db.q('select status, count(*)::int as n from messages where campaign_id = $1 group by status', [c.id]);
  const s = { total: 0, sent: 0, failed: 0, skipped: 0, queued: 0 };
  for (const r of rows) {
    const k = r.status === 'sending' ? 'queued' : r.status;
    s.total += r.n;
    s[k] = (s[k] || 0) + r.n;
  }
  c.stats = s;
  return s;
}

const publicCampaign = ({ runRemaining, nextSendAt, ...rest }) => rest;

// Listed newest first, so the first template in the list is the default on the campaign page.
async function addTemplates(userId, list) {
  const base = Date.now();
  await db.insertMany('templates', db.COLS.templates, list.map((t, i) => {
    const at = new Date(base - i).toISOString();
    return db.toRow.template({ ...t, id: db.id('tpl'), userId, createdAt: at, updatedAt: at });
  }));
}

module.exports = { loadCampaign, insertCampaign, saveCampaign, recount, publicCampaign, addTemplates };
