import { api } from '../api.js';
import { $, esc, toast, modal, busy, confirmDialog, fmtDate, channelTag, icons } from '../ui.js';

export async function templates(el) {
  let filter = '';
  const draw = async () => {
    const all = await api('/templates');
    const items = all.filter((t) => !filter || t.channel === filter);
    el.innerHTML = `<div class="page">
      <header class="page-head">
        <div><h1>Templates</h1><p>Reusable messages. Use <b>{column_name}</b> for personal details, <b>{name|there}</b> for a fallback, and <b>[[Hi|Hello]]</b> to vary wording per recipient.</p></div>
        <button class="btn primary" data-new>${icons.plus}New template</button>
      </header>
      <div class="spread" style="margin-bottom:16px">
        <div class="segmented">${[['', 'All'], ['email', 'Email'], ['whatsapp', 'WhatsApp']].map(([v, l]) => `<button data-f="${v}" class="${filter === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        <span class="muted small">${items.length} template${items.length === 1 ? '' : 's'}</span>
      </div>
      ${items.length ? `<div class="tpl-grid">${items.map((t) => `<button class="tpl" data-id="${t.id}">
        <div class="spread"><h3>${esc(t.name)}</h3>${channelTag(t.channel)}</div>
        ${t.subject ? `<div class="subj">${esc(t.subject)}</div>` : ''}
        <div class="body">${esc(t.body)}</div>
        <span class="muted small" style="margin-top:auto">Edited ${fmtDate(t.updatedAt)}</span>
      </button>`).join('')}</div>` : '<div class="panel empty"><h3>No templates here</h3><p>Save a message you send often and reuse it in any campaign.</p></div>'}
    </div>`;
    el.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => { filter = b.dataset.f; draw(); }; });
    $('[data-new]', el).onclick = () => openTemplateEditor({ channel: filter || 'email' }, draw);
    el.querySelectorAll('.tpl').forEach((b) => { b.onclick = () => openTemplateEditor(all.find((t) => t.id === b.dataset.id), draw); });
  };
  await draw();
}

export function openTemplateEditor(t = {}, onSaved) {
  const m = modal({
    title: t.id ? 'Edit template' : 'New template',
    wide: true,
    body: `<div class="grid-2">
        <label class="field">Name<input type="text" data-k="name" value="${esc(t.name || '')}" placeholder="For example: Clinic intro"></label>
        <label class="field">Channel<select data-k="channel"><option value="email" ${t.channel !== 'whatsapp' ? 'selected' : ''}>Email</option><option value="whatsapp" ${t.channel === 'whatsapp' ? 'selected' : ''}>WhatsApp</option></select></label>
      </div>
      <label class="field" data-subject>Subject<input type="text" data-k="subject" value="${esc(t.subject || '')}"></label>
      <label class="field">Message<textarea data-k="body" rows="12">${esc(t.body || '')}</textarea></label>`,
    footer: `${t.id ? '<button class="btn ghost quiet-danger" data-del style="margin-right:auto">Delete</button>' : ''}<button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-save data-busy="Saving">Save template</button>`,
  });
  const val = (k) => $(`[data-k="${k}"]`, m.el).value;
  const sync = () => { $('[data-subject]', m.el).hidden = val('channel') === 'whatsapp'; };
  $('[data-k="channel"]', m.el).onchange = sync;
  sync();
  $('[data-cancel]', m.el).onclick = m.close;
  const save = $('[data-save]', m.el);
  save.onclick = () => busy(save, async () => {
    try {
      const body = { name: val('name'), channel: val('channel'), subject: val('subject'), body: val('body') };
      const out = await api(t.id ? `/templates/${t.id}` : '/templates', { method: t.id ? 'PUT' : 'POST', body });
      m.close();
      toast('Template saved.', 'ok');
      onSaved?.(out);
    } catch (e) { toast(e.message); }
  });
  const del = $('[data-del]', m.el);
  if (del) del.onclick = async () => {
    if (!(await confirmDialog('Delete this template?', 'Campaigns already created keep their own copy of the message.', 'Delete template'))) return;
    await api(`/templates/${t.id}`, { method: 'DELETE' });
    m.close();
    onSaved?.();
  };
}
