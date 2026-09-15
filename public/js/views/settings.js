import { api } from '../api.js';
import { $, $$, esc, toast, busy, fmtDate, icons } from '../ui.js';
import { getSenders, setSenders, getPrefs, setPrefs, getServerStatus } from '../store.js';

export async function settings(el) {
  const s = structuredClone(getSenders());
  const server = getServerStatus();
  const suppression = await api('/suppression');

  el.innerHTML = `<div class="page" style="max-width:860px">
    <header class="page-head"><div><h1>Settings</h1><p>Sender details stay in this browser tab and are sent only with each send request. The server never stores them.</p></div></header>

    <section class="panel">
      <div class="panel-head"><div><h2>${icons.email.replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-3px;margin-right:6px;fill:none;stroke:currentColor;stroke-width:1.8"')}Email sender</h2>
        <p>For Gmail, turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords.</p></div></div>
      ${server.mailTestMode ? '<div class="notice" style="margin-bottom:14px">Test mode is on for this server (MAIL_TRANSPORT=json). Emails are processed but not delivered.</div>' : server.emailFromEnv ? '<div class="notice" style="margin-bottom:14px">This server has a default sender configured. Fields left blank use it.</div>' : ''}
      <div class="stack">
        <div class="grid-2">
          <label class="field">Gmail address<input type="email" data-s="smtp.user" autocomplete="username"></label>
          <label class="field">App Password<input type="password" data-s="smtp.pass" autocomplete="current-password" placeholder="16 characters"></label>
          <label class="field">Sender name<input type="text" data-s="smtp.fromName" placeholder="Asim from VizenoraTech"></label>
          <label class="field">Reply-to address<span class="hint">Optional. Replies go here instead.</span><input type="email" data-s="smtp.replyTo"></label>
        </div>
        <details><summary class="small muted" style="cursor:pointer">Use a different mail server</summary>
          <div class="grid-2" style="margin-top:12px">
            <label class="field">SMTP host<input type="text" data-s="smtp.host"></label>
            <label class="field">SMTP port<input type="number" data-s="smtp.port"><span class="hint">465 for SSL, 587 for STARTTLS</span></label>
          </div>
        </details>
        <div class="row"><button class="btn" data-verify-email data-busy="Checking">Check connection</button></div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>${icons.whatsapp.replace('<svg', '<svg style="width:18px;height:18px;vertical-align:-3px;margin-right:6px;fill:none;stroke:currentColor;stroke-width:1.8"')}WhatsApp Cloud API</h2>
        <p>Optional. Without it you can still send with click-to-chat links. Get these values in Meta for Developers, under your app's WhatsApp, API Setup.</p></div></div>
      ${server.waDryRun ? '<div class="notice" style="margin-bottom:14px">Dry-run mode is on for this server (WA_DRY_RUN=1). WhatsApp messages are not delivered.</div>' : ''}
      <div class="stack">
        <div class="grid-2">
          <label class="field">Access token<input type="password" data-s="wa.token" placeholder="EAAG…"><span class="hint">Use a permanent System User token for production.</span></label>
          <label class="field">Phone number ID<input type="text" data-s="wa.phoneNumberId" inputmode="numeric"></label>
          <label class="field">Graph API version<input type="text" data-s="wa.version"></label>
          <label class="field">Default country code<input type="text" data-cc inputmode="numeric" value="${esc(getPrefs().countryCode)}"><span class="hint">Used for local numbers such as 0300 1234567</span></label>
        </div>
        <div class="row"><button class="btn" data-verify-wa data-busy="Checking">Check connection</button></div>
      </div>
    </section>

    <section class="panel">
      <label class="check"><input type="checkbox" data-remember ${s.remember ? 'checked' : ''}><span>Remember sender details on this device<small>Saves them in this browser's storage. Leave this off on shared computers.</small></span></label>
      <div class="row" style="margin-top:16px"><button class="btn primary" data-save>Save settings</button><button class="btn ghost" data-clear>Clear sender details</button></div>
    </section>

    <section class="panel">
      <div class="panel-head"><div><h2>Do-not-contact list</h2><p>People here are skipped in every campaign. Unsubscribe links add people automatically.</p></div></div>
      <div class="row" style="margin-bottom:16px"><input type="text" data-sup placeholder="Email or phone number" style="flex:1;min-width:220px"><button class="btn" data-sup-add>Add</button></div>
      ${suppression.length ? `<div class="table-wrap"><table><thead><tr><th>Contact</th><th>Reason</th><th>Added</th><th></th></tr></thead><tbody>
      ${suppression.map((x) => `<tr><td class="num">${/^\d+$/.test(x.value) ? `+${esc(x.value)}` : esc(x.value)}</td><td class="muted">${esc(x.reason)}</td><td class="muted small">${fmtDate(x.at)}</td><td><button class="btn sm ghost" data-unsup="${esc(x.value)}">Remove</button></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted small">Nobody has unsubscribed yet.</p>'}
    </section>
  </div>`;

  const get = (path) => path.split('.').reduce((o, k) => o?.[k], s);
  const set = (path, v) => { const [a, b] = path.split('.'); s[a][b] = v; };
  $$('[data-s]', el).forEach((i) => {
    i.value = get(i.dataset.s) ?? '';
    i.oninput = () => set(i.dataset.s, i.type === 'number' ? Number(i.value) : i.value.trim());
  });

  const save = (quiet) => {
    s.remember = $('[data-remember]', el).checked;
    setSenders(structuredClone(s));
    setPrefs({ countryCode: $('[data-cc]', el).value.replace(/\D/g, '') || '92' });
    if (!quiet) toast(s.remember ? 'Settings saved on this device.' : 'Settings saved for this session.', 'ok');
  };
  $('[data-save]', el).onclick = () => save();
  $('[data-clear]', el).onclick = () => {
    setSenders({ remember: false, smtp: { user: '', pass: '', fromName: '', replyTo: '', host: 'smtp.gmail.com', port: 465 }, wa: { token: '', phoneNumberId: '', version: 'v21.0' } });
    toast('Sender details cleared.', 'ok');
    settings(el);
  };

  const ve = $('[data-verify-email]', el);
  ve.onclick = () => busy(ve, async () => {
    try { await api('/senders/verify-email', { method: 'POST', body: { smtp: s.smtp } }); save(true); toast('Connected. Email sender is ready.', 'ok'); }
    catch (e) { toast(e.message); }
  });
  const vw = $('[data-verify-wa]', el);
  vw.onclick = () => busy(vw, async () => {
    try {
      const r = await api('/senders/verify-whatsapp', { method: 'POST', body: { wa: s.wa } });
      save(true);
      toast(`Connected to ${r.info.verified_name || 'WhatsApp'} ${r.info.display_phone_number || ''}.`, 'ok');
    } catch (e) { toast(e.message); }
  });

  $('[data-sup-add]', el).onclick = async () => {
    try { await api('/suppression', { method: 'POST', body: { value: $('[data-sup]', el).value, countryCode: getPrefs().countryCode } }); settings(el); }
    catch (e) { toast(e.message); }
  };
  $$('[data-unsup]', el).forEach((b) => { b.onclick = async () => { await api(`/suppression/${encodeURIComponent(b.dataset.unsup)}`, { method: 'DELETE' }); settings(el); }; });
}
