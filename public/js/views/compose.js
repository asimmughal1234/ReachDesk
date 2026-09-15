import { api } from '../api.js';
import { $, $$, esc, toast, busy, debounce, fmtNum, icons } from '../ui.js';
import { getSenders, getPrefs, emailReady, whatsappReady, runtime } from '../store.js';
import { buildVars, renderHtml } from '../render.js';
import { openImportModal, openManageLists } from './contacts.js';
import { openTemplateEditor } from './templates.js';

const REPLY_OPT_OUT = 'P.S. If this isn\'t relevant, just reply "no" and I won\'t email you again.';
const MAX_ATTACH = 4 * 1024 * 1024; // hosting limit on request size
const DEFAULT_FOOTER = {
  email: REPLY_OPT_OUT,
  whatsapp: 'Reply STOP to stop receiving messages.',
};
// Mirrors isPublicUrl in server/lib/compose.js.
const isPublicHost = (h) => h.includes('.') && !/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(h) && !/\.(local|localhost|internal)$/i.test(h);

export async function compose(el, { query }) {
  const [firstLists, allTemplates] = await Promise.all([api('/lists'), api('/templates')]);
  let lists = firstLists;
  let templates = allTemplates;
  const listOptions = () => (lists.length
    ? lists.map((l) => `<option value="${l.id}">${esc(l.name)} (${fmtNum(l.count)})</option>`).join('')
    : '<option value="">No lists yet</option>');
  const senders = getSenders();
  const st = {
    channel: query.channel === 'whatsapp' ? 'whatsapp' : 'email',
    listId: query.list || lists[0]?.id || '',
    name: '',
    senderName: senders.smtp.fromName || '',
    subject: '', body: '',
    html: false, footer: true, footerText: DEFAULT_FOOTER.email,
    waMode: 'links',
    loadedBody: '',
    templateName: '', language: 'en', params: '',
    limit: 50, delay: 45, jitter: 45, skipContacted: true,
    testTo: '', files: [],
    sample: [], idx: 0, fields: [], counts: null, missing: [],
  };

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><h1>New campaign</h1><p>Write once, personalize for every row, and check each message in the preview before it goes out.</p></div>
      <div class="segmented" data-channel role="tablist" aria-label="Channel">
        <button data-ch="email">${icons.email}Email</button>
        <button data-ch="whatsapp">${icons.whatsapp}WhatsApp</button>
      </div>
    </header>
    <div class="composer">
      <div>
        <section class="section">
          <div class="section-title"><span class="n">1</span><div><h2>Audience</h2><p>Who receives this campaign.</p></div></div>
          <div class="grid-2">
            <label class="field">Contact list
              <select data-k="listId">${listOptions()}</select>
            </label>
            <label class="field">Campaign name<input type="text" data-k="name" placeholder="For example: Dubai builders, September"></label>
          </div>
          <div class="spread">
            <div class="audience-counts" data-counts></div>
            <div class="row">
              <button class="btn sm ghost" data-manage-lists>Manage lists</button>
              <button class="btn sm ghost" data-import>${icons.upload}Import a list</button>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-title"><span class="n">2</span><div><h2>Message</h2><p>Click a field to insert it where your cursor is.</p></div></div>
          <div class="grid-2">
            <label class="field">Start from a template<select data-template></select></label>
            <label class="field">Your name<input type="text" data-k="senderName" placeholder="Used for {sender_name}"></label>
          </div>
          <div data-wa-mode class="stack">
            <label class="field">How to send
              <select data-k="waMode">
                <option value="links">Click-to-chat links (free, no setup)</option>
                <option value="cloud_template">Cloud API: approved template (first contact)</option>
                <option value="cloud_text">Cloud API: free text (replies within 24 hours)</option>
              </select>
              <span class="hint" data-mode-hint></span>
            </label>
            <div class="grid-3" data-tpl-fields>
              <label class="field">Template name<input type="text" data-k="templateName" placeholder="lead_intro"></label>
              <label class="field">Language code<input type="text" data-k="language" placeholder="en"></label>
              <label class="field">Template variables<input type="text" data-k="params" placeholder="{first_name}, {city}"><span class="hint">In order, for {{1}}, {{2}}…</span></label>
            </div>
          </div>
          <label class="field" data-subject>Subject<input type="text" data-k="subject" placeholder="AI automation for {business_name|your team}"></label>
          <label class="field"><span data-body-label>Message</span><textarea data-k="body" rows="13"></textarea></label>
          <div class="chips" data-chips></div>
          <div class="stack" data-email-only>
            <div>
              <div class="files" data-files></div>
              <label class="btn sm" style="margin-top:8px">${icons.plus}Attach files<input type="file" multiple hidden data-attach></label>
              <span class="muted small">&nbsp;Up to 5 files, 4 MB in total.</span>
            </div>
            <label class="check"><input type="checkbox" data-k="html"><span>Send an HTML version too<small>Leave off for first-contact emails. Plain text looks like a personal email; formatted mail is more likely to land in Promotions or Spam.</small></span></label>
          </div>
          <label class="check"><input type="checkbox" data-k="footer"><span data-footer-label>Add an unsubscribe footer</span></label>
          <label class="field" data-footer-text><input type="text" data-k="footerText"></label>
          <div class="row"><button class="btn sm ghost" data-save-tpl>Save message as template</button></div>
        </section>

        <section class="section">
          <div class="section-title"><span class="n">3</span><div><h2>Delivery</h2><p>Small, spaced batches protect your sender reputation.</p></div></div>
          <div class="grid-3">
            <label class="field">Send per batch<input type="number" min="0" data-k="limit"><span class="hint">0 sends everyone. Gmail allows about 500 a day.</span></label>
            <label class="field">Wait between messages<input type="number" min="0" data-k="delay"><span class="hint">Seconds</span></label>
            <label class="field">Random extra wait<input type="number" min="0" data-k="jitter"><span class="hint">Up to this many seconds, so timing looks natural</span></label>
          </div>
          <label class="check"><input type="checkbox" data-k="skipContacted"><span>Skip people already reached on this channel<small>Checks every earlier campaign, so nobody gets the same intro twice.</small></span></label>
          <div class="row" data-test-row style="align-items:flex-end">
            <label class="field" style="flex:1;min-width:220px"><span data-test-label>Send a test to</span><input type="text" data-k="testTo"></label>
            <button class="btn" data-test data-busy="Sending test">Send test</button>
          </div>
          <div data-sender-warning></div>
        </section>

        <div class="launch">
          <span class="muted small" data-launch-note></span>
          <button class="btn primary" data-launch data-busy="Creating campaign"></button>
        </div>
      </div>

      <aside class="preview" aria-label="Preview">
        <div class="preview-bar">
          <span class="who" data-who></span>
          <div class="stepper"><button data-prev aria-label="Previous recipient">‹</button><span data-pos></span><button data-next aria-label="Next recipient">›</button></div>
        </div>
        <div data-surface></div>
        <div data-warn></div>
      </aside>
    </div>
  </div>`;

  const q = (s) => $(s, el);
  const input = (k) => q(`[data-k="${k}"]`);

  // Two-way bind simple fields.
  for (const node of $$('[data-k]', el)) {
    const k = node.dataset.k;
    if (node.type === 'checkbox') node.checked = Boolean(st[k]);
    else node.value = st[k] ?? '';
    node.addEventListener('input', () => {
      st[k] = node.type === 'checkbox' ? node.checked : node.type === 'number' ? Number(node.value) : node.value;
      if (k === 'listId') loadList();
      if (k === 'waMode') syncChannel();
      if (k === 'footer') syncChannel();
      drawPreview();
      refreshCounts();
    });
  }

  function setChannel(ch) {
    const wasDefault = st.footerText === DEFAULT_FOOTER[st.channel];
    st.channel = ch;
    if (wasDefault || !st.footerText) { st.footerText = DEFAULT_FOOTER[ch]; input('footerText').value = st.footerText; }
    st.footer = ch === 'email' ? st.footer : false;
    input('footer').checked = st.footer;
    history.replaceState(null, '', `#/compose?channel=${ch}${st.listId ? `&list=${st.listId}` : ''}`);
    syncChannel();
    fillTemplates();
    if (!st.body.trim() || st.body === st.loadedBody) applyTemplate(templates.find((t) => t.channel === ch));
    drawChips();
    drawPreview();
    refreshCounts();
  }

  function syncChannel() {
    const email = st.channel === 'email';
    $$('[data-ch]', el).forEach((b) => b.classList.toggle('on', b.dataset.ch === st.channel));
    q('[data-subject]').hidden = !email;
    q('[data-email-only]').hidden = !email;
    q('[data-wa-mode]').hidden = email;
    q('[data-tpl-fields]').hidden = email || st.waMode !== 'cloud_template';
    q('[data-mode-hint]').textContent = {
      links: 'You open each chat in WhatsApp with the message filled in and press send yourself. Works with any WhatsApp account.',
      cloud_template: 'Sends automatically through Meta. First messages to a contact must use a template Meta has approved.',
      cloud_text: 'Sends automatically, but Meta only delivers free text to people who messaged you in the last 24 hours.',
    }[st.waMode];
    q('[data-body-label]').textContent = !email && st.waMode === 'cloud_template' ? 'Template text, for your preview only (Meta sends the approved version)' : 'Message';
    q('[data-footer-label]').innerHTML = email
      ? 'Add an opt-out line<small>Recommended. Gives people an easy way to say no instead of marking you as spam. When the app runs on a public address, a one-click unsubscribe header is added too.</small>'
      : 'Add an opt-out line';
    q('[data-footer-text]').hidden = !st.footer;
    q('[data-test-label]').textContent = email ? 'Send a test email to' : 'Send a test WhatsApp to';
    input('testTo').placeholder = email ? (getSenders().smtp.user || 'you@company.com') : '03001234567';
    q('[data-test-row]').hidden = !email && st.waMode === 'links';
    const ready = email ? emailReady() : st.waMode === 'links' || whatsappReady();
    q('[data-sender-warning]').innerHTML = ready ? '' : `<div class="notice warn">${email
      ? 'Add your Gmail address and App Password in <a href="#/settings">Settings</a> to send. You can still write and preview.'
      : 'Add your WhatsApp Cloud API token and phone number ID in <a href="#/settings">Settings</a>, or switch to click-to-chat links.'}</div>`;
    const btn = q('[data-launch]');
    btn.textContent = !email && st.waMode === 'links' ? 'Create chat list' : 'Create campaign and start sending';
    btn.dataset.busy = btn.textContent === 'Create chat list' ? 'Creating list' : 'Starting';
  }

  function fillTemplates() {
    const own = templates.filter((t) => t.channel === st.channel);
    q('[data-template]').innerHTML = `<option value="">Blank message</option>${own.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}`;
  }

  function applyTemplate(t) {
    q('[data-template]').value = t?.id || '';
    st.subject = t?.subject || '';
    st.body = t?.body || '';
    st.loadedBody = st.body;
    input('subject').value = st.subject;
    input('body').value = st.body;
  }
  q('[data-template]').onchange = (e) => {
    const t = templates.find((x) => x.id === e.target.value);
    if (!t) return;
    applyTemplate(t);
    drawPreview();
    refreshCounts();
  };

  async function loadList() {
    st.sample = []; st.idx = 0; st.fields = [];
    if (!st.listId) { drawChips(); drawPreview(); return; }
    const [info, rows] = await Promise.all([api(`/lists/${st.listId}`), api(`/lists/${st.listId}/contacts?limit=100`)]);
    st.fields = info.fields;
    st.sample = rows.items;
    drawChips();
    drawPreview();
  }

  function drawChips() {
    const keys = [...new Set([...st.fields, 'sender_name', ...(st.channel === 'email' ? ['unsubscribe_url'] : [])])];
    q('[data-chips]').innerHTML = keys.map((k) => `<button type="button" class="chip" data-chip="${esc(k)}">{${esc(k)}}</button>`).join('');
    $$('[data-chip]', el).forEach((c) => {
      c.onmousedown = (e) => e.preventDefault(); // keep focus in the field
      c.onclick = () => insertAtCursor(`{${c.dataset.chip}}`);
    });
  }

  let lastField = null;
  ['subject', 'body', 'footerText', 'params'].forEach((k) => input(k).addEventListener('focus', () => { lastField = input(k); }));
  function insertAtCursor(text) {
    const f = lastField || input('body');
    const s = f.selectionStart ?? f.value.length;
    f.setRangeText(text, s, f.selectionEnd ?? s, 'end');
    f.focus();
    f.dispatchEvent(new Event('input'));
  }

  const eligibleSample = () => st.sample.filter((c) => (st.channel === 'email' ? c.email : c.phone) && !c.unsubscribed);

  function drawPreview() {
    if (!q('[data-surface]')) return; // navigated away
    const people = eligibleSample();
    const n = people.length;
    if (st.idx >= n) st.idx = Math.max(0, n - 1);
    const c = people[st.idx] || {};
    const vars = buildVars(c, { sender_name: st.senderName, unsubscribe_url: `${location.origin}/u/preview`, campaign_name: st.name });
    const s = getSenders();
    q('[data-pos]').textContent = n ? `${st.idx + 1} of ${n}${st.sample.length >= 100 ? '+' : ''}` : '0 of 0';
    q('[data-prev]').disabled = st.idx <= 0;
    q('[data-next]').disabled = st.idx >= n - 1;
    q('[data-who]').textContent = n ? `Previewing ${c.name || (st.channel === 'email' ? c.email : `+${c.phone}`)}` : 'Pick a list to preview real rows';

    // Same rule as the server: a link back to this machine would be dead for the recipient.
    const footerText = st.channel === 'email' && !isPublicHost(location.hostname) && /\{\s*unsubscribe_url/.test(st.footerText) ? REPLY_OPT_OUT : st.footerText;
    const footer = st.footer && footerText ? renderHtml(footerText, vars) : '';
    if (st.channel === 'email') {
      const fromName = s.smtp.fromName || st.senderName || 'You';
      q('[data-surface]').innerHTML = `<article class="mail">
        <div class="mail-top">
          <div class="mail-subject">${renderHtml(st.subject, vars) || '<span class="muted">No subject yet</span>'}</div>
          <div class="mail-from"><div class="avatar">${esc(fromName[0]?.toUpperCase() || 'Y')}</div>
            <div><b>${esc(fromName)}</b> <span>&lt;${esc(s.smtp.user || 'your@gmail.com')}&gt;</span><br><span>to ${esc(c.email || 'recipient@example.com')}</span></div></div>
        </div>
        <div class="mail-body">${renderHtml(st.body, vars, st.idx) || '<span class="muted">Your message appears here.</span>'}${footer ? `<div class="mail-foot">${footer}</div>` : ''}</div>
        ${st.files.length ? `<div class="mail-files">${st.files.map((f) => `<span>📎 ${esc(f.name)}</span>`).join('')}</div>` : ''}
      </article>`;
    } else {
      const who = c.name || (c.phone ? `+${c.phone}` : 'Contact');
      const body = st.waMode === 'cloud_template' && !st.body.trim()
        ? `<span class="muted">Template “${esc(st.templateName || 'name')}” with variables: ${esc(st.params.split(',').map((p) => p.trim()).filter(Boolean).map((p) => renderHtml(p, vars).replace(/<[^>]+>/g, '')).join(', ') || 'none')}</span>`
        : renderHtml(st.body, vars, st.idx) || '<span class="muted">Your message appears here.</span>';
      q('[data-surface]').innerHTML = `<article class="chat">
        <div class="chat-top"><div class="avatar">${esc(who[0]?.toUpperCase() || 'C')}</div><div><b>${esc(who)}</b><span>${c.phone ? `+${esc(c.phone)}` : 'No number'}</span></div></div>
        <div class="chat-body"><div class="bubble">${st.waMode === 'cloud_template' ? `<span class="tpl-tag">Template: ${esc(st.templateName || '…')}</span>` : ''}${body}${footer ? `\n\n${footer}` : ''}<time>${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓</time></div></div>
      </article>`;
    }

    const warn = [];
    if (!st.senderName.trim() && /\{\s*sender_name\s*\}/.test(`${st.subject} ${st.body} ${st.footerText}`)) warn.push('Fill in <b>Your name</b> above. The message uses {sender_name}.');
    const missing = st.missing.filter((k) => k !== 'sender_name');
    if (missing.length) warn.push(`Some rows have no value for ${missing.map((k) => `<b>{${esc(k)}}</b>`).join(', ')}. Add a fallback like <b>{${esc(missing[0])}|there}</b>, or those spots will be blank.`);
    if (st.channel === 'email' && /\{unsubscribe_url\}/.test(st.body) === false && !st.footer) warn.push('No opt-out line. People who can\'t easily say no are more likely to mark you as spam.');
    if (st.channel === 'email' && Number(st.delay) < 30) warn.push('Emails sent less than 30 seconds apart look automated to Gmail. Wait 45 seconds or more between messages.');
    q('[data-warn]').innerHTML = warn.map((w) => `<div class="notice warn">${w}</div>`).join('');
  }

  q('[data-prev]').onclick = () => { st.idx -= 1; drawPreview(); };
  q('[data-next]').onclick = () => { st.idx += 1; drawPreview(); };

  const payload = () => ({
    name: st.name, channel: st.channel, listId: st.listId, senderName: st.senderName,
    message: { subject: st.subject, body: st.body, html: st.html, footer: st.footer, footerText: st.footerText },
    wa: { mode: st.waMode, templateName: st.templateName, language: st.language, params: st.params },
    delivery: { limit: st.limit, delay: st.delay, jitter: st.jitter, skipContacted: st.skipContacted },
    countryCode: getPrefs().countryCode,
  });

  const eta = (n) => {
    const mins = (Math.max(0, n - 1) * (Number(st.delay) + Number(st.jitter) / 2)) / 60;
    return mins < 1 ? 'under a minute' : mins < 90 ? `about ${Math.round(mins)} min` : `about ${(mins / 60).toFixed(1)} hours`;
  };
  const refreshCounts = debounce(async () => {
    const box = q('[data-counts]');
    if (!box) return;
    if (!st.listId) { box.innerHTML = '<span>Import a list to choose an audience.</span>'; q('[data-launch-note]').textContent = ''; return; }
    try {
      const r = await api('/campaigns/preview', { method: 'POST', body: { ...payload(), message: { ...payload().message, subject: st.subject || 'x', body: st.body || 'x' }, wa: { ...payload().wa, templateName: st.templateName || 'x' } } });
      st.counts = r.counts;
      st.missing = r.missingPlaceholders;
      const noun = st.channel === 'email' ? 'email address' : 'phone number';
      box.innerHTML = `<span class="go"><b>${fmtNum(r.counts.eligible)}</b> will receive it</span>
        ${r.counts.missing ? `<span><b>${fmtNum(r.counts.missing)}</b> have no ${noun}</span>` : ''}
        ${r.counts.contacted ? `<span><b>${fmtNum(r.counts.contacted)}</b> already reached</span>` : ''}
        ${r.counts.suppressed ? `<span><b>${fmtNum(r.counts.suppressed)}</b> unsubscribed</span>` : ''}`;
      const links = st.channel === 'whatsapp' && st.waMode === 'links';
      q('[data-launch-note]').textContent = !r.counts.eligible ? 'Nobody in this list can receive this campaign.'
        : links ? `Creates ${fmtNum(r.counts.eligible)} chat links you open one by one.`
        : `First batch: ${fmtNum(r.firstBatch)} of ${fmtNum(r.counts.eligible)}, ${eta(r.firstBatch)}.${r.firstBatch < r.counts.eligible ? ' Send the rest from the campaign page.' : ''}`;
      drawPreview();
    } catch (e) { box.textContent = e.message; }
  }, 350);

  // Attachments
  const drawFiles = () => {
    q('[data-files]').innerHTML = st.files.map((f, i) => `<span class="file-pill">${esc(f.name)} <span class="muted">${Math.ceil(f.size / 1024)} KB</span><button data-rmf="${i}" aria-label="Remove ${esc(f.name)}">×</button></span>`).join('');
    $$('[data-rmf]', el).forEach((b) => { b.onclick = () => { st.files.splice(Number(b.dataset.rmf), 1); drawFiles(); drawPreview(); }; });
  };
  q('[data-attach]').onchange = (e) => {
    const files = [...e.target.files];
    if (st.files.length + files.length > 5) toast('You can attach up to 5 files.');
    const next = [...st.files, ...files].slice(0, 5);
    if (next.reduce((n, f) => n + f.size, 0) > MAX_ATTACH) toast('Attachments can total 4 MB at most. Share a link to bigger files instead.');
    else st.files = next;
    e.target.value = '';
    drawFiles();
    drawPreview();
  };

  const formData = (extra = {}) => {
    const fd = new FormData();
    fd.append('payload', JSON.stringify({ ...payload(), runtime: runtime(), ...extra }));
    if (st.channel === 'email') st.files.forEach((f) => fd.append('attachments', f));
    return fd;
  };

  const testBtn = q('[data-test]');
  testBtn.onclick = () => busy(testBtn, async () => {
    try {
      const r = await api('/campaigns/test', { method: 'POST', form: formData({ test: { to: st.testTo || getSenders().smtp.user } }) });
      toast(`Test sent to ${r.to}. It uses the first contact's details.`, 'ok');
    } catch (e) { toast(e.message); }
  });

  const launch = q('[data-launch]');
  launch.onclick = () => busy(launch, async () => {
    try {
      const c = await api('/campaigns', { method: 'POST', form: formData() });
      if (c.lastError) toast(`Campaign created but not started: ${c.lastError}`);
      else toast(c.channel === 'whatsapp' && c.wa.mode === 'links' ? 'Chat list ready. Open each chat to send.' : 'Campaign started. Keep its page open while it sends.', 'ok');
      location.hash = `#/campaigns/${c.id}`;
    } catch (e) { toast(e.message); }
  });

  q('[data-save-tpl]').onclick = () => openTemplateEditor({ channel: st.channel, subject: st.subject, body: st.body }, async (t) => {
    templates = await api('/templates');
    fillTemplates();
    if (t) q('[data-template]').value = t.id;
  });

  q('[data-import]').onclick = () => openImportModal({ lists, onDone: (list) => { location.hash = `#/compose?channel=${st.channel}&list=${list.id}`; } });
  q('[data-manage-lists]').onclick = () => openManageLists({
    onChange: async () => {
      lists = await api('/lists');
      if (!q('[data-surface]')) return; // navigated away
      if (!lists.some((l) => l.id === st.listId)) st.listId = lists[0]?.id || '';
      input('listId').innerHTML = listOptions();
      input('listId').value = st.listId;
      await loadList();
      refreshCounts();
    },
  });
  $$('[data-ch]', el).forEach((b) => { b.onclick = () => setChannel(b.dataset.ch); });

  // Start with the first matching template so the page is never empty.
  input('listId').value = st.listId;
  input('footer').checked = st.footer = st.channel === 'email';
  input('footerText').value = st.footerText = DEFAULT_FOOTER[st.channel];
  syncChannel();
  fillTemplates();
  applyTemplate(templates.find((t) => t.channel === st.channel));
  await loadList();
  refreshCounts();
}
