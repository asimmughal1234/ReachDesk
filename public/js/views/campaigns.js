import { api, withToken } from '../api.js';
import { $, $$, esc, toast, busy, confirmDialog, fmtDate, fmtNum, status, channelTag, icons } from '../ui.js';
import { runtime, emailReady, whatsappReady } from '../store.js';

export async function campaigns(el) {
  const items = await api('/campaigns');
  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><h1>Campaigns</h1><p>Every send, with its results. Open one to follow it live, resume it, or download the results sheet.</p></div>
      <a class="btn primary" href="#/compose">${icons.plus}New campaign</a>
    </header>
    <section class="panel">
      ${items.length ? `<div class="table-wrap" style="border-top:0;margin-top:-22px"><table><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Sent</th><th>Failed</th><th>Waiting</th><th>Created</th></tr></thead><tbody>
      ${items.map((c) => `<tr class="clickable" data-href="#/campaigns/${c.id}">
        <td><b>${esc(c.name)}</b><span class="sub">${esc(c.listName)}</span></td>
        <td>${channelTag(c.channel)}${c.channel === 'whatsapp' ? `<span class="sub">${c.wa.mode === 'links' ? 'Click-to-chat' : 'Cloud API'}</span>` : ''}</td>
        <td>${status(c.status)}</td>
        <td class="num">${fmtNum(c.stats?.sent)}</td>
        <td class="num">${fmtNum(c.stats?.failed)}</td>
        <td class="num">${fmtNum(c.stats?.queued)}</td>
        <td class="muted">${fmtDate(c.createdAt)}</td>
      </tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><h3>No campaigns yet</h3><p>Create one to reach a contact list by email or WhatsApp.</p><a class="btn primary" href="#/compose">Create campaign</a></div>'}
    </section>
  </div>`;
  $$('tr[data-href]', el).forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
}

export async function campaignDetail(el, { id }) {
  let filter = '';
  let offset = 0;
  const PAGE = 100;
  let data = await api(`/campaigns/${id}?limit=${PAGE}`);
  let c = data.campaign;
  const links = c.channel === 'whatsapp' && c.wa.mode === 'links';
  let nextAt = 0; // when this page will ask the server to send again
  const nextText = () => (nextAt
    ? `Next ${c.channel === 'email' ? 'email' : 'message'} in ${Math.max(0, Math.ceil((nextAt - Date.now()) / 1000))}s`
    : 'Sending…');

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div>
        <a href="#/campaigns" class="small" style="text-decoration:none">‹ All campaigns</a>
        <h1 style="margin-top:6px">${esc(c.name)}</h1>
        <p>${channelTag(c.channel)} to <a href="#/contacts?list=${c.listId}">${esc(c.listName)}</a>, created ${fmtDate(c.createdAt)}${c.channel === 'email' ? `. Subject: “${esc(c.message.subject)}”` : ''}</p>
      </div>
      <div class="row" data-actions></div>
    </header>
    <section class="panel" data-summary></section>
    <section class="panel" data-messages></section>
  </div>`;

  function drawSummary() {
    const s = c.stats || {};
    const pct = (n) => (s.total ? (n / s.total) * 100 : 0);
    const done = s.sent + s.failed + s.skipped;
    $('[data-summary]', el).innerHTML = `
      <div class="spread" style="margin-bottom:12px">
        <div class="row">${status(c.status)}<span class="muted small num">${fmtNum(done)} of ${fmtNum(s.total)} handled</span></div>
        <span class="muted small">${links ? 'Sent by hand from WhatsApp' : c.delivery.limit ? `Batches of ${fmtNum(c.delivery.limit)}` : 'Everyone in one run'}${links ? '' : `, ${c.delivery.delay}s apart${c.delivery.jitter ? ` plus up to ${c.delivery.jitter}s` : ''}`}</span>
      </div>
      <div class="progress" role="progressbar" aria-valuenow="${Math.round(pct(done))}" aria-valuemin="0" aria-valuemax="100">
        <i class="p-sent" style="width:${pct(s.sent)}%"></i><i class="p-failed" style="width:${pct(s.failed)}%"></i><i class="p-skipped" style="width:${pct(s.skipped)}%"></i>
      </div>
      ${c.status === 'running' && !links ? `<div class="notice" style="margin-top:14px"><b data-next-in>${nextText()}</b>. Sending runs from this page, so keep it open. Closing it pauses sending until you open it again.</div>` : ''}
      ${c.lastError ? `<div class="notice warn" style="margin-top:14px"><b>Sending stopped.</b> ${esc(c.lastError)} Fix it in <a href="#/settings">Settings</a>, then continue.</div>` : ''}
      ${links && s.queued ? '<div class="notice" style="margin-top:14px">Open each chat below. WhatsApp opens with the message filled in, you press send, and the row is marked as sent.</div>' : ''}
      <div class="kpis">
        <div><b>${fmtNum(s.total)}</b><span>Recipients</span></div>
        <div><b style="color:var(--teal)">${fmtNum(s.sent)}</b><span>Sent</span></div>
        <div><b>${fmtNum(s.failed)}</b><span>Failed</span></div>
        <div><b>${fmtNum(s.skipped)}</b><span>Skipped</span></div>
        <div><b>${fmtNum(s.queued)}</b><span>Waiting</span></div>
      </div>`;
  }

  function drawActions() {
    const s = c.stats || {};
    const a = [];
    if (c.status === 'running') a.push('<button class="btn" data-act="pause">Pause</button>');
    if (c.status === 'paused') a.push('<button class="btn primary" data-act="resume">Resume</button>');
    if (c.status === 'ready' && s.queued && !links) a.push(`<button class="btn primary" data-run data-busy="Starting">Send next ${c.delivery.limit ? fmtNum(Math.min(c.delivery.limit, s.queued)) : fmtNum(s.queued)}</button>`);
    if (s.failed && c.status !== 'running') a.push('<button class="btn" data-retry>Retry failed</button>');
    a.push(`<a class="btn" href="${withToken(`/api/campaigns/${c.id}/export`)}">${icons.download}Download results</a>`);
    if (['running', 'paused', 'ready'].includes(c.status) && s.queued) a.push('<button class="btn ghost" data-act="cancel">Cancel</button>');
    if (!['running', 'paused'].includes(c.status)) a.push('<button class="btn ghost" data-delete>Delete</button>');
    const box = $('[data-actions]', el);
    box.innerHTML = a.join('');

    $$('[data-act]', box).forEach((b) => {
      b.onclick = async () => {
        if (b.dataset.act === 'cancel' && !(await confirmDialog('Cancel this campaign?', 'Messages already sent stay sent. Everyone still waiting is skipped, and the campaign cannot be restarted.', 'Cancel campaign'))) return;
        try { c = await api(`/campaigns/${c.id}/${b.dataset.act}`, { method: 'POST' }); refresh(); } catch (e) { toast(e.message); }
      };
    });
    const run = $('[data-run]', box);
    if (run) run.onclick = () => busy(run, async () => {
      if (c.channel === 'email' ? !emailReady() : !whatsappReady()) { toast('Add your sender details in Settings first. They are not stored on the server.'); return; }
      try { c = await api(`/campaigns/${c.id}/run`, { method: 'POST', body: { runtime: runtime() } }); refresh(); } catch (e) { toast(e.message); }
    });
    const retry = $('[data-retry]', box);
    if (retry) retry.onclick = async () => {
      const r = await api(`/campaigns/${c.id}/retry-failed`, { method: 'POST' });
      c = r.campaign;
      toast(`${r.requeued} messages moved back to waiting. Choose “Send next” to retry them.`, 'ok');
      refresh();
    };
    const del = $('[data-delete]', box);
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('Delete this campaign?', 'Its results are removed too. Download them first if you need them.', 'Delete campaign'))) return;
      await api(`/campaigns/${c.id}`, { method: 'DELETE' });
      location.hash = '#/campaigns';
    };
  }

  function drawMessages() {
    const s = c.stats || {};
    const tabs = [['', 'All', s.total], ['queued', 'Waiting', s.queued], ['sent', 'Sent', s.sent], ['failed', 'Failed', s.failed], ['skipped', 'Skipped', s.skipped]];
    const box = $('[data-messages]', el);
    box.innerHTML = `
      <div class="panel-head"><h2>Recipients</h2>
        <div class="filters">${tabs.map(([v, l, n]) => `<button data-f="${v}" class="${filter === v ? 'on' : ''}">${l} <span class="muted num">${fmtNum(n)}</span></button>`).join('')}</div>
      </div>
      <div class="table-wrap"><table><thead><tr><th>Recipient</th><th>Status</th><th>${links ? 'Chat' : 'Details'}</th><th>Time</th></tr></thead><tbody>
      ${data.messages.map((m) => `<tr data-mid="${m.id}">
        <td><b>${esc(m.name || '—')}</b><span class="sub num">${c.channel === 'whatsapp' ? `+${esc(m.to)}` : esc(m.to)}</span></td>
        <td>${status(m.status)}</td>
        <td>${links && m.status === 'queued'
          ? `<div class="row"><a class="btn sm primary" href="${esc(m.link)}" target="_blank" rel="noopener" data-open="${m.id}">${icons.whatsapp}Open chat</a><button class="btn sm ghost" data-skip="${m.id}">Skip</button></div>`
          : links && m.status === 'sent' ? `<button class="btn sm ghost" data-undo="${m.id}">Mark as not sent</button>`
          : `<span class="cell-trunc" style="display:block" title="${esc(m.error || m.subject || '')}">${esc(m.error || m.subject || '')}</span>`}</td>
        <td class="muted small">${fmtDate(m.sentAt || m.updatedAt)}</td>
      </tr>`).join('') || '<tr><td colspan="4" class="muted">Nobody in this group.</td></tr>'}
      </tbody></table></div>
      ${data.total > PAGE ? `<div class="spread" style="margin-top:32px"><span class="muted small">${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${fmtNum(data.total)}</span>
      <div class="row"><button class="btn sm" data-prev ${offset ? '' : 'disabled'}>Previous</button><button class="btn sm" data-next ${offset + PAGE < data.total ? '' : 'disabled'}>Next</button></div></div>` : ''}`;

    $$('[data-f]', box).forEach((b) => { b.onclick = () => { filter = b.dataset.f; offset = 0; refresh(); }; });
    $('[data-prev]', box) && ($('[data-prev]', box).onclick = () => { offset -= PAGE; refresh(); });
    $('[data-next]', box) && ($('[data-next]', box).onclick = () => { offset += PAGE; refresh(); });
    const mark = async (mid, s) => { try { const r = await api(`/campaigns/${c.id}/messages/${mid}`, { method: 'POST', body: { status: s } }); c = r.campaign; refresh(); } catch (e) { toast(e.message); } };
    $$('[data-open]', box).forEach((a) => { a.addEventListener('click', () => setTimeout(() => mark(a.dataset.open, 'sent'), 300)); });
    $$('[data-skip]', box).forEach((b) => { b.onclick = () => mark(b.dataset.skip, 'skipped'); });
    $$('[data-undo]', box).forEach((b) => { b.onclick = () => mark(b.dataset.undo, 'queued'); });
  }

  async function refresh() {
    data = await api(`/campaigns/${id}?limit=${PAGE}&offset=${offset}${filter ? `&status=${filter}` : ''}`);
    c = data.campaign;
    drawSummary(); drawActions(); drawMessages();
    if (c.status === 'running') pump();
  }

  // Sending runs from this page: each request sends one message, then the page waits the
  // gap the server asks for. Leaving the page pauses sending until someone opens it again.
  let alive = true;
  let pumping = false;
  let pending = false;
  let timer = null;
  const wait = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  const refreshSoon = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; if (alive) refresh().catch(() => {}); }, 700);
  };
  async function pump() {
    if (pumping || links) return;
    pumping = true;
    try {
      while (alive && c.status === 'running') {
        let r;
        try {
          r = await api(`/campaigns/${c.id}/send-next`, { method: 'POST', body: { runtime: runtime() } });
        } catch (e) {
          if (!alive) break;
          toast(`${e.message} Trying again in 15 seconds.`);
          nextAt = Date.now() + 15000;
          await wait(15000);
          continue;
        }
        if (!alive) break;
        const changed = r.campaign.status !== c.status;
        c = r.campaign;
        nextAt = c.status === 'running' && r.waitMs ? Date.now() + r.waitMs : 0;
        drawSummary();
        if (changed) drawActions();
        if (r.message || changed) refreshSoon();
        if (c.status !== 'running') break;
        await wait(Math.max(500, r.waitMs || 0));
      }
    } finally {
      pumping = false;
      nextAt = 0;
      if (alive) drawSummary();
    }
  }

  const tick = setInterval(() => { const n = $('[data-next-in]', el); if (n) n.textContent = nextText(); }, 1000);
  drawSummary(); drawActions(); drawMessages();
  if (c.status === 'running') pump();
  return () => { alive = false; clearTimeout(timer); clearInterval(tick); };
}
