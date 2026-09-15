import { api } from '../api.js';
import { esc, fmtNum, fmtDate, status, channelTag, icons } from '../ui.js';
import { emailReady, whatsappReady } from '../store.js';

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export async function dashboard(el) {
  const [s, camps, lists] = await Promise.all([api('/stats'), api('/campaigns'), api('/lists')]);
  const max = Math.max(1, ...s.days.map((d) => d.email + d.whatsapp));
  const hasSender = emailReady() || whatsappReady();
  const setup = [
    { done: lists.length > 0, title: 'Import your contacts', text: 'Upload Excel or CSV, or link a Google Sheet.', href: '#/contacts?import=1', cta: 'Import' },
    { done: hasSender, title: 'Connect a sender', text: 'Add a Gmail App Password or WhatsApp Cloud API details.', href: '#/settings', cta: 'Open settings' },
    { done: camps.length > 0, title: 'Launch your first campaign', text: 'Preview every message before anything is sent.', href: '#/compose', cta: 'Create' },
  ];
  const setupDone = setup.every((x) => x.done);

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><h1>${greeting()}</h1><p>${s.queued ? `${fmtNum(s.queued)} messages are waiting in campaigns you can resume.` : 'Here is how your outreach is going.'}</p></div>
      <div class="row">
        <a class="btn" href="#/compose?channel=whatsapp">${icons.whatsapp}WhatsApp campaign</a>
        <a class="btn primary" href="#/compose?channel=email">${icons.email}Email campaign</a>
      </div>
    </header>

    <section class="metrics" aria-label="Totals">
      <div class="metric lead"><b>${fmtNum(s.emailSent + s.whatsappSent)}</b><span>Messages sent</span></div>
      <div class="metric"><b>${fmtNum(s.contacts)}</b><span>Contacts in ${fmtNum(s.lists)} list${s.lists === 1 ? '' : 's'}</span></div>
      <div class="metric"><b>${fmtNum(s.failed)}</b><span>Failed, ready to retry</span></div>
      <div class="metric"><b>${fmtNum(s.unsubscribed)}</b><span>Unsubscribed</span></div>
    </section>

    <div class="overview-grid">
      <section class="panel">
        <div class="panel-head">
          <div><h2>Last 14 days</h2><p>${fmtNum(s.emailSent)} emails and ${fmtNum(s.whatsappSent)} WhatsApp messages in total</p></div>
          <div class="legend"><span><i style="background:var(--teal)"></i>Email</span><span><i style="background:#8FC3B8"></i>WhatsApp</span></div>
        </div>
        ${s.days.every((d) => !d.email && !d.whatsapp) ? '<div class="chart-empty">Sent messages will be charted here day by day.</div>' : ''}<div class="bars" ${s.days.every((d) => !d.email && !d.whatsapp) ? 'hidden' : ''}>${s.days.map((d) => `<div class="bar" data-tip="${new Date(d.day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}: ${d.email} email, ${d.whatsapp} WhatsApp">
          <div class="seg email" style="height:${(d.email / max) * 100}%"></div>
          <div class="seg wa" style="height:${(d.whatsapp / max) * 100}%"></div></div>`).join('')}</div>
        <div class="bar-axis"><span>${new Date(s.days[0].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><span>Today</span></div>
      </section>

      <section class="panel">
        ${setupDone ? `<div class="panel-head"><div><h2>Contact lists</h2><p>Your most recent imports</p></div><a class="btn sm" href="#/contacts">View all</a></div>
          <div class="list-items">${lists.slice(0, 5).map((l) => `<a class="list-item" href="#/contacts?list=${l.id}" style="text-decoration:none"><b>${esc(l.name)}</b><span>${fmtNum(l.count)} contacts, ${fmtNum(l.emails)} with email, ${fmtNum(l.phones)} with phone</span></a>`).join('')}</div>`
        : `<div class="panel-head"><div><h2>Get set up</h2><p>Three steps to your first send</p></div></div>
          <ol class="steps-list">${setup.map((x) => `<li class="${x.done ? 'done' : ''}"><div><h3>${x.title}</h3><p>${x.text}</p></div>${x.done ? '' : `<a class="btn sm" href="${x.href}">${x.cta}</a>`}</li>`).join('')}</ol>`}
      </section>
    </div>

    <section class="panel" style="margin-top:18px">
      <div class="panel-head"><div><h2>Recent campaigns</h2></div>${camps.length ? '<a class="btn sm" href="#/campaigns">View all</a>' : ''}</div>
      ${camps.length ? `<div class="table-wrap"><table><thead><tr><th>Campaign</th><th>Channel</th><th>Status</th><th>Progress</th><th>Created</th></tr></thead><tbody>
        ${camps.slice(0, 6).map((c) => `<tr class="clickable" data-href="#/campaigns/${c.id}">
          <td><b>${esc(c.name)}</b><span class="sub">${esc(c.listName)}</span></td>
          <td>${channelTag(c.channel)}</td><td>${status(c.status)}</td>
          <td class="num">${fmtNum(c.stats?.sent)} / ${fmtNum(c.stats?.total)}</td>
          <td class="muted">${fmtDate(c.createdAt)}</td></tr>`).join('')}
      </tbody></table></div>`
      : '<div class="empty"><h3>No campaigns yet</h3><p>Campaigns you create show up here with live progress.</p></div>'}
    </section>
  </div>`;
  el.querySelectorAll('tr[data-href]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.href; }; });
}
