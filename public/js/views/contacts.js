import { api } from '../api.js';
import { $, $$, esc, toast, modal, busy, confirmDialog, fmtNum, fmtDate, debounce, icons } from '../ui.js';
import { getPrefs, setPrefs } from '../store.js';

export async function contacts(el, { query }) {
  let lists = await api('/lists');
  let current = query.list || lists[0]?.id || '';
  let search = '';
  let offset = 0;
  const PAGE = 50;

  el.innerHTML = `<div class="page">
    <header class="page-head">
      <div><h1>Contacts</h1><p>Import leads from Excel, CSV or Google Sheets. Duplicates and rows without an email or phone are skipped automatically.</p></div>
      <button class="btn primary" data-import>${icons.upload}Import contacts</button>
    </header>
    <div class="split">
      <section class="panel"><div class="panel-head"><h2>Lists</h2></div><div class="list-items" data-lists></div></section>
      <section class="panel" data-table></section>
    </div>
  </div>`;

  const drawLists = () => {
    $('[data-lists]', el).innerHTML = lists.length
      ? lists.map((l) => `<div class="list-row">
          <button class="list-item ${l.id === current ? 'on' : ''}" data-id="${l.id}"><b>${esc(l.name)}</b><span>${fmtNum(l.count)} contacts</span></button>
          <button class="icon-btn" data-del-list="${l.id}" title="Delete list" aria-label="Delete ${esc(l.name)}">${icons.trash}</button>
        </div>`).join('')
      : '<p class="muted small">No lists yet.</p>';
    $$('[data-lists] .list-item', el).forEach((b) => { b.onclick = () => { current = b.dataset.id; offset = 0; search = ''; drawLists(); drawTable(); }; });
    $$('[data-del-list]', el).forEach((b) => { b.onclick = () => deleteList(lists.find((l) => l.id === b.dataset.delList), refresh); });
  };

  async function drawTable() {
    const box = $('[data-table]', el);
    const list = lists.find((l) => l.id === current);
    if (!list) {
      box.innerHTML = `<div class="empty"><h3>Import your first list</h3><p>Any spreadsheet with a header row works. You choose which columns hold the name, email and phone.</p><button class="btn primary" data-import2>Import contacts</button></div>`;
      $('[data-import2]', box).onclick = () => openImport();
      return;
    }
    const data = await api(`/lists/${list.id}/contacts?q=${encodeURIComponent(search)}&limit=${PAGE}&offset=${offset}`);
    const extra = (data.items[0]?.headers || []).filter((h) => !/name|e-?mail|phone|mobile|whats/i.test(h)).slice(0, 3);
    box.innerHTML = `
      <div class="panel-head">
        <div><h2>${esc(list.name)}</h2><p>${fmtNum(list.count)} contacts, ${fmtNum(list.emails)} with email, ${fmtNum(list.phones)} with phone. Source: ${esc(list.source || 'import')}</p></div>
        <div class="row">
          <a class="btn sm" href="#/compose?list=${list.id}&channel=email">Email this list</a>
          <a class="btn sm" href="#/compose?list=${list.id}&channel=whatsapp">WhatsApp this list</a>
          <button class="btn sm ghost" data-rename>Rename</button>
          <button class="btn sm ghost quiet-danger" data-del>Delete</button>
        </div>
      </div>
      <input type="search" placeholder="Search name, email, phone or any column" value="${esc(search)}" data-search style="margin-bottom:16px">
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>WhatsApp</th>${extra.map((h) => `<th>${esc(h)}</th>`).join('')}<th></th></tr></thead><tbody>
      ${data.items.map((c) => `<tr>
        <td><b>${esc(c.name || '—')}</b>${c.unsubscribed ? '<span class="sub">Unsubscribed</span>' : ''}</td>
        <td>${esc(c.email || '—')}</td>
        <td class="num">${c.phone ? `+${esc(c.phone)}` : '—'}</td>
        ${extra.map((h) => `<td class="cell-trunc">${esc(c.fields[h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')] || '')}</td>`).join('')}
        <td><button class="btn sm ghost" data-rm="${c.id}" aria-label="Remove ${esc(c.name || c.email || c.phone)}">Remove</button></td>
      </tr>`).join('') || `<tr><td colspan="9" class="muted">No contacts match “${esc(search)}”.</td></tr>`}
      </tbody></table></div>
      ${data.total > PAGE ? `<div class="spread" style="margin-top:32px"><span class="muted small">${offset + 1}–${Math.min(offset + PAGE, data.total)} of ${fmtNum(data.total)}</span>
        <div class="row"><button class="btn sm" data-prev ${offset ? '' : 'disabled'}>Previous</button><button class="btn sm" data-next ${offset + PAGE < data.total ? '' : 'disabled'}>Next</button></div></div>` : ''}`;

    const s = $('[data-search]', box);
    s.oninput = debounce(() => { search = s.value; offset = 0; drawTable().then(() => { const n = $('[data-search]', box); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 300);
    $('[data-prev]', box) && ($('[data-prev]', box).onclick = () => { offset -= PAGE; drawTable(); });
    $('[data-next]', box) && ($('[data-next]', box).onclick = () => { offset += PAGE; drawTable(); });
    $$('[data-rm]', box).forEach((b) => { b.onclick = async () => { await api(`/contacts/${b.dataset.rm}`, { method: 'DELETE' }); await refresh(); }; });
    $('[data-del]', box).onclick = () => deleteList(list, async () => { current = ''; await refresh(); });
    $('[data-rename]', box).onclick = () => {
      const m = modal({ title: 'Rename list', body: `<label class="field">List name<input type="text" value="${esc(list.name)}"></label>`, footer: '<button class="btn primary" data-save>Save name</button>' });
      $('[data-save]', m.el).onclick = async () => { await api(`/lists/${list.id}`, { method: 'PATCH', body: { name: $('input', m.el).value } }); m.close(); refresh(); };
    };
  }

  async function refresh() {
    lists = await api('/lists');
    if (!lists.some((l) => l.id === current)) current = lists[0]?.id || '';
    drawLists();
    await drawTable();
  }

  function openImport() {
    openImportModal({ lists, onDone: (list) => { current = list.id; refresh(); } });
  }

  $('[data-import]', el).onclick = openImport;
  drawLists();
  await drawTable();
  if (query.import) openImport();
}

async function deleteList(list, after) {
  if (!list || !(await confirmDialog('Delete this list?', `“${list.name}” and its ${list.count} contacts will be removed. Past campaign results stay.`, 'Delete list'))) return;
  await api(`/lists/${list.id}`, { method: 'DELETE' });
  toast('List deleted.', 'ok');
  await after?.();
}

// Every uploaded file in one place, each with its own delete button.
export async function openManageLists({ onChange } = {}) {
  const m = modal({ title: 'Uploaded lists', wide: true, body: '<div data-history></div>' });
  const draw = async () => {
    const box = $('[data-history]', m.body);
    const lists = await api('/lists');
    box.innerHTML = lists.length
      ? `<div class="history-wrap"><table><thead><tr><th>List</th><th>Contacts</th><th>Imported</th><th></th></tr></thead><tbody>
        ${lists.map((l) => `<tr>
          <td><b>${esc(l.name)}</b><span class="sub">${esc(l.source || 'import')}</span></td>
          <td class="num">${fmtNum(l.count)}</td>
          <td>${esc(fmtDate(l.createdAt))}</td>
          <td class="actions"><button class="btn sm quiet-danger" data-del="${l.id}">${icons.trash}Delete</button></td>
        </tr>`).join('')}
        </tbody></table></div>`
      : '<p class="muted">No uploaded lists yet.</p>';
    $$('[data-del]', box).forEach((b) => {
      b.onclick = () => deleteList(lists.find((l) => l.id === b.dataset.del), async () => { await draw(); await onChange?.(); });
    });
  };
  await draw();
}

export function openImportModal({ lists, onDone }) {
  const m = modal({
    title: 'Import contacts',
    wide: true,
    body: `<div class="segmented" role="tablist"><button class="on" data-tab="file">Excel or CSV file</button><button data-tab="sheet">Google Sheet</button></div>
      <div data-pane="file">
        <label class="dropzone" data-drop>
          ${icons.upload}
          <strong>Drop a spreadsheet here, or click to choose</strong>
          <span class="muted small">.xlsx, .xls or .csv up to 15 MB. The first row should hold column names.</span>
          <input type="file" accept=".xlsx,.xls,.csv" hidden>
        </label>
      </div>
      <div data-pane="sheet" hidden>
        <label class="field">Google Sheet link
          <input type="url" placeholder="https://docs.google.com/spreadsheets/d/…" data-url>
          <span class="hint">In Google Sheets choose Share, then set General access to “Anyone with the link”. Every tab is imported so you can pick one next.</span>
        </label>
        <div><button class="btn primary" data-fetch data-busy="Reading sheet">Read sheet</button></div>
      </div>
      <div data-map></div>`,
  });
  const body = m.body;

  $$('[data-tab]', body).forEach((b) => {
    b.onclick = () => {
      $$('[data-tab]', body).forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-pane]', body).forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    };
  });

  const drop = $('[data-drop]', body);
  const input = $('input[type=file]', drop);
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    $('strong', drop).textContent = `Reading ${file.name}…`;
    try { showMapping(await api('/imports/file', { method: 'POST', form: fd })); }
    catch (e) { toast(e.message); }
    finally { $('strong', drop).textContent = 'Drop a spreadsheet here, or click to choose'; input.value = ''; }
  };
  input.onchange = () => upload(input.files[0]);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files[0]); };

  const fetchBtn = $('[data-fetch]', body);
  fetchBtn.onclick = () => busy(fetchBtn, async () => {
    try { showMapping(await api('/imports/sheet', { method: 'POST', body: { url: $('[data-url]', body).value } })); }
    catch (e) { toast(e.message); }
  });

  function showMapping(imp) {
    $$('[data-pane]', body).forEach((p) => { p.hidden = true; });
    $('.segmented', body).hidden = true;
    let sheet = imp.sheets[0];
    const box = $('[data-map]', body);
    const baseName = imp.source.replace(/\.[^.]+$/, '');

    const draw = () => {
      const opt = (sel) => `<option value="">Not in this file</option>${sheet.headers.map((h) => `<option ${h === sel ? 'selected' : ''}>${esc(h)}</option>`).join('')}`;
      box.innerHTML = `
        <div class="notice">Found <b>${fmtNum(sheet.rowCount)}</b> rows in <b>${esc(imp.source)}</b>${imp.sheets.length > 1 ? ` across ${imp.sheets.length} tabs` : ''}. Tell us which columns to use. Every other column is kept and can be used in messages.</div>
        ${imp.sheets.length > 1 ? `<label class="field">Tab<select data-sheet>${imp.sheets.map((s) => `<option ${s.name === sheet.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <div class="grid-3">
          <label class="field">Name column<select data-m="name">${opt(sheet.suggested.name)}</select></label>
          <label class="field">Email column<select data-m="email">${opt(sheet.suggested.email)}</select></label>
          <label class="field">Phone or WhatsApp column<select data-m="phone">${opt(sheet.suggested.phone)}</select></label>
        </div>
        <div class="grid-3">
          <label class="field">Add to<select data-target><option value="">A new list</option>${lists.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label>
          <label class="field" data-namefield>New list name<input type="text" data-listname value="${esc(imp.sheets.length > 1 ? `${baseName} (${sheet.name})` : baseName)}"></label>
          <label class="field">Default country code<input type="text" data-cc value="${esc(getPrefs().countryCode)}" inputmode="numeric"><span class="hint">Added to local numbers such as 0300…</span></label>
        </div>
        <div class="table-wrap" style="margin:0;border:1px solid var(--line);border-radius:10px"><table><thead><tr>${sheet.headers.slice(0, 6).map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
        <tbody>${sheet.sample.map((r) => `<tr>${sheet.headers.slice(0, 6).map((h) => `<td class="cell-trunc">${esc(r[h])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      const sel = $('[data-sheet]', box);
      if (sel) sel.onchange = () => { sheet = imp.sheets.find((s) => s.name === sel.value); draw(); };
      $('[data-target]', box).onchange = (e) => { $('[data-namefield]', box).hidden = Boolean(e.target.value); };
    };
    draw();

    const footer = document.createElement('footer');
    footer.innerHTML = '<button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-commit data-busy="Importing">Import contacts</button>';
    m.el.querySelector('.modal').append(footer);
    $('[data-cancel]', footer).onclick = m.close;
    const commit = $('[data-commit]', footer);
    commit.onclick = () => busy(commit, async () => {
      const mapping = Object.fromEntries($$('[data-m]', box).map((s) => [s.dataset.m, s.value]));
      const cc = $('[data-cc]', box).value.replace(/\D/g, '');
      setPrefs({ countryCode: cc || '92' });
      try {
        const r = await api(`/imports/${imp.importId}/commit`, { method: 'POST', body: {
          sheet: sheet.name, mapping, countryCode: cc, listId: $('[data-target]', box).value, listName: $('[data-listname]', box).value,
        } });
        m.close();
        toast(`Imported ${fmtNum(r.added)} contacts. Skipped ${fmtNum(r.duplicates)} duplicates and ${fmtNum(r.invalid)} rows without an email or phone.`, 'ok');
        onDone(r.list);
      } catch (e) { toast(e.message); }
    });
  }
}
