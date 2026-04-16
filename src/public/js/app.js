/* SQLite Dashboard – Frontend Application
 * Single-file vanilla-JS SPA, no build step required.
 */
'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  databases: [],
  currentDb: null,
  tables: [],
  currentTable: null,
  currentTab: 'data',   // 'data' | 'insert' | 'schema' | 'sql'

  // Data panel
  rows: [],
  columns: [],
  total: 0,
  page: 1,
  pageSize: 50,
  totalPages: 1,
  sortBy: null,
  sortOrder: 'ASC',
  search: '',
  selectedCell: null,
  editingCell: null,

  // Schema panel
  schema: null,

  // SQL panel
  sqlResult: null,
};

// ─── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const api = {
  getDatabases: () => apiFetch('/api/databases'),
  getTables: (db) => apiFetch(`/api/databases/${encodeURIComponent(db)}/tables`),
  getSchema: (db, table) =>
    apiFetch(`/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}/schema`),
  getRows: (db, table, params) => {
    const qs = new URLSearchParams(params).toString();
    return apiFetch(
      `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}/rows?${qs}`
    );
  },
  insertRow: (db, table, data) =>
    apiFetch(`/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}/rows`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateRow: (db, table, rowid, data) =>
    apiFetch(
      `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}/rows/${rowid}`,
      { method: 'PATCH', body: JSON.stringify(data) }
    ),
  deleteRow: (db, table, rowid) =>
    apiFetch(
      `/api/databases/${encodeURIComponent(db)}/${encodeURIComponent(table)}/rows/${rowid}`,
      { method: 'DELETE' }
    ),
  query: (db, sql) =>
    apiFetch(`/api/databases/${encodeURIComponent(db)}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql }),
    }),
};

// ─── Toast notifications ───────────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── Modal helpers ─────────────────────────────────────────────────────────────
function showConfirmModal({ title, message, onConfirm }) {
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h3>${escHtml(title)}</h3>
      <p>${escHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn btn-secondary" id="modal-cancel">Cancel</button>
        <button class="btn btn-danger" id="modal-confirm">Delete</button>
      </div>
    </div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('#modal-cancel').addEventListener('click', () => backdrop.remove());
  backdrop.querySelector('#modal-confirm').addEventListener('click', () => {
    backdrop.remove();
    onConfirm();
  });
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
}

// ─── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatCellValue(val) {
  if (val === null || val === undefined) return '<span class="td-null">NULL</span>';
  if (typeof val === 'number') return `<span class="td-number">${escHtml(String(val))}</span>`;
  const str = String(val);
  return `<span class="td-text">${escHtml(str.length > 120 ? str.slice(0, 120) + '…' : str)}</span>`;
}

function escSelector(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getCellElement(rowid, col) {
  const table = document.getElementById('data-table');
  if (!table) return null;
  const row = table.querySelector(`tbody tr[data-rowid="${escSelector(rowid)}"]`);
  if (!row) return null;
  return row.querySelector(`td[data-col="${escSelector(col)}"]`);
}

function getSchemaColumn(col) {
  return state.schema?.columns?.find((c) => c.name === col) || null;
}

function getSchemaType(col) {
  return (getSchemaColumn(col)?.type || '').toUpperCase();
}

function isBooleanColumn(col, val) {
  return typeof val === 'boolean' || /BOOL/.test(getSchemaType(col));
}

function isNumberColumn(col, val) {
  return typeof val === 'number' || /(INT|REAL|FLOA|DOUB|NUM|DEC)/.test(getSchemaType(col));
}

function updateCellSelection() {
  const table = document.getElementById('data-table');
  if (!table) return;
  table.querySelectorAll('td.td-selected').forEach((td) => td.classList.remove('td-selected'));
  if (!state.selectedCell) return;
  const td = getCellElement(state.selectedCell.rowid, state.selectedCell.col);
  if (td) td.classList.add('td-selected');
}

function selectCell(td) {
  const row = td?.closest('tr');
  if (!row || !td.dataset.col) return;
  state.selectedCell = { rowid: row.dataset.rowid, col: td.dataset.col };
  updateCellSelection();
}

function buildCellEditor(col, val) {
  if (isBooleanColumn(col, val)) {
    const select = document.createElement('select');
    const allowNull = getSchemaColumn(col)?.notnull !== 1;
    select.className = 'inline-cell-select';
    if (allowNull) select.add(new Option('NULL', ''));
    select.add(new Option('true', '1'));
    select.add(new Option('false', '0'));
    const normalized =
      val === null || val === undefined
        ? ''
        : val === true || val === 1 || String(val).toLowerCase() === 'true'
          ? '1'
          : '0';
    select.value = normalized;
    return { input: select, kind: 'boolean' };
  }

  if (isNumberColumn(col, val)) {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = /INT/.test(getSchemaType(col)) ? '1' : 'any';
    input.className = 'inline-cell-input';
    input.value = val === null || val === undefined ? '' : String(val);
    return { input, kind: 'number' };
  }

  const textarea = document.createElement('textarea');
  textarea.className = 'inline-cell-textarea';
  textarea.rows = 5;
  textarea.value = val === null || val === undefined ? '' : String(val);
  return { input: textarea, kind: 'string' };
}

function parseEditorValue(col, kind, input) {
  const raw = input.value;

  if (kind === 'boolean') {
    if (raw === '') return null;
    return raw === '1' ? 1 : 0;
  }

  if (kind === 'number') {
    if (raw.trim() === '') return null;
    const isInt = /INT/.test(getSchemaType(col));
    const parsed = isInt ? parseInt(raw, 10) : Number(raw);
    if (Number.isNaN(parsed)) throw new Error('Please enter a valid number');
    return parsed;
  }

  return raw;
}

// ─── Sidebar: database selector ────────────────────────────────────────────────
async function loadDatabases() {
  try {
    const data = await api.getDatabases();
    state.databases = data.databases;
    const selector = document.getElementById('db-selector');
    selector.innerHTML = data.databases
      .map((name) => `<option value="${escHtml(name)}">${escHtml(name)}</option>`)
      .join('');
    if (data.databases.length > 0) {
      await selectDatabase(data.databases[0]);
    }
  } catch (err) {
    toast('Failed to load databases: ' + err.message, 'error');
  }
}

async function selectDatabase(name) {
  state.currentDb = name;
  state.currentTable = null;
  state.rows = [];
  state.columns = [];
  updateBreadcrumb();
  showWelcome();
  await loadTables(name);
}

async function loadTables(dbName) {
  const listEl = document.getElementById('table-list');
  listEl.innerHTML = '<div class="loading-state"><div class="spinner"></div> Loading…</div>';
  try {
    const data = await api.getTables(dbName);
    state.tables = data.tables;
    renderTableList(data.tables, document.getElementById('table-search').value);
  } catch (err) {
    listEl.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderTableList(tables, filter = '') {
  const listEl = document.getElementById('table-list');
  const lc = filter.toLowerCase();
  const filtered = filter ? tables.filter((t) => t.name.toLowerCase().includes(lc)) : tables;

  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state"><span class="empty-icon">🗄️</span><p>No tables found</p></div>';
    return;
  }

  const tableItems = filtered.filter((t) => t.type === 'table');
  const viewItems = filtered.filter((t) => t.type === 'view');

  let html = '';
  if (tableItems.length > 0) {
    html += '<div class="table-list-section">';
    html += '<div class="table-list-section-label">Tables</div>';
    html += tableItems.map((t) => renderTableItem(t)).join('');
    html += '</div>';
  }
  if (viewItems.length > 0) {
    html += '<div class="table-list-section">';
    html += '<div class="table-list-section-label">Views</div>';
    html += viewItems.map((t) => renderTableItem(t)).join('');
    html += '</div>';
  }
  listEl.innerHTML = html;

  listEl.querySelectorAll('.table-item').forEach((el) => {
    el.addEventListener('click', () => {
      const name = el.dataset.name;
      selectTable(name);
    });
  });
}

function renderTableItem(t) {
  const isActive = t.name === state.currentTable;
  const icon = t.type === 'table' ? '▤' : '◫';
  return `<div class="table-item${isActive ? ' active' : ''}" data-name="${escHtml(t.name)}">
    <span class="table-item-icon">${icon}</span>
    <span class="table-item-name">${escHtml(t.name)}</span>
    <span class="table-item-type type-${escHtml(t.type)}">${escHtml(t.type)}</span>
  </div>`;
}

// ─── Table selection ───────────────────────────────────────────────────────────
async function selectTable(name) {
  state.currentTable = name;
  state.page = 1;
  state.sortBy = null;
  state.sortOrder = 'ASC';
  state.search = '';
  document.getElementById('row-search').value = '';

  // Re-render sidebar to update active item
  renderTableList(state.tables, document.getElementById('table-search').value);
  updateBreadcrumb();
  hideWelcome();
  setTab('data');
  await loadSchema();
  await loadRows();
}

// ─── Breadcrumb ────────────────────────────────────────────────────────────────
function updateBreadcrumb() {
  const el = document.getElementById('breadcrumb');
  if (!state.currentDb && !state.currentTable) {
    el.innerHTML = '<span>sqlite-dashboard</span>';
    return;
  }
  let html = `<span class="bc-db">${escHtml(state.currentDb)}</span>`;
  if (state.currentTable) {
    html += `<span class="bc-sep">/</span><span class="bc-table">${escHtml(state.currentTable)}</span>`;
  }
  el.innerHTML = html;
}

// ─── Welcome / panel visibility ────────────────────────────────────────────────
function showWelcome() {
  document.getElementById('welcome').style.display = 'flex';
  document.getElementById('tab-bar').style.visibility = 'hidden';
  document.getElementById('content').style.display = 'none';
}

function hideWelcome() {
  document.getElementById('welcome').style.display = 'none';
  document.getElementById('tab-bar').style.visibility = 'visible';
  document.getElementById('content').style.display = 'flex';
}

// ─── Tab switching ─────────────────────────────────────────────────────────────
function setTab(tab) {
  state.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.id === `${tab}-panel`);
  });

  if (tab === 'schema' && !state.schema) loadSchema();
  if (tab === 'sql') initSqlPanel();
}

// ─── Data panel ────────────────────────────────────────────────────────────────
async function loadRows() {
  if (!state.currentDb || !state.currentTable) return;
  const tableScroll = document.getElementById('table-scroll');
  tableScroll.innerHTML = '<div class="loading-state"><div class="spinner"></div> Loading rows…</div>';
  updatePagination(false);

  try {
    const params = {
      page: state.page,
      pageSize: state.pageSize,
    };
    if (state.sortBy) { params.sortBy = state.sortBy; params.sortOrder = state.sortOrder; }
    if (state.search) params.search = state.search;

    const data = await api.getRows(state.currentDb, state.currentTable, params);
    state.rows = data.rows;
    state.total = data.total;
    state.totalPages = data.totalPages;
    state.page = data.page;
    renderTable(data.rows);
    updatePagination(true);
  } catch (err) {
    tableScroll.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><p>${escHtml(err.message)}</p></div>`;
  }
}

function renderTable(rows) {
  const tableScroll = document.getElementById('table-scroll');
  state.selectedCell = null;
  state.editingCell = null;

  if (rows.length === 0 && !state.search) {
    tableScroll.innerHTML = '<div class="empty-state"><span class="empty-icon">📭</span><p>This table has no rows</p><p style="font-size:12px">Use the Insert tab to add data</p></div>';
    return;
  }
  if (rows.length === 0) {
    tableScroll.innerHTML = '<div class="empty-state"><span class="empty-icon">🔍</span><p>No rows match your search</p></div>';
    return;
  }

  // Get visible columns (exclude internal _rowid_)
  const allKeys = Object.keys(rows[0]);
  const cols = allKeys.filter((k) => k !== '_rowid_');
  state.columns = cols;

  const sortIcon = (col) => {
    if (state.sortBy !== col) return '<span class="sort-icon">↕</span>';
    return `<span class="sort-icon">${state.sortOrder === 'ASC' ? '↑' : '↓'}</span>`;
  };

  let html = `<table id="data-table">
    <thead><tr>
      <th class="td-actions" style="cursor:default"></th>
      ${cols.map((c) => `<th class="${state.sortBy === c ? 'sorted' : ''}" data-col="${escHtml(c)}">
        <div class="th-inner">${escHtml(c)} ${sortIcon(c)}</div>
      </th>`).join('')}
    </tr></thead>
    <tbody>
      ${rows.map((row) => renderDataRow(row, cols)).join('')}
    </tbody>
  </table>`;

  tableScroll.innerHTML = html;

  // Sort click handlers
  tableScroll.querySelectorAll('thead th[data-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (state.sortBy === col) {
        state.sortOrder = state.sortOrder === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.sortBy = col;
        state.sortOrder = 'ASC';
      }
      state.page = 1;
      loadRows();
    });
  });

  // Cell click/double-click handlers
  tableScroll.querySelectorAll('tbody td[data-col]').forEach((td) => {
    td.addEventListener('click', () => selectCell(td));
    td.addEventListener('dblclick', () => startCellEdit(td));
  });

  // Delete button handlers
  tableScroll.querySelectorAll('.row-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rowid = btn.dataset.rowid;
      showConfirmModal({
        title: 'Delete row',
        message: 'Are you sure you want to delete this row? This action cannot be undone.',
        onConfirm: () => deleteRow(rowid),
      });
    });
  });
}

function renderDataRow(row, cols) {
  const rowid = row._rowid_;
  return `<tr data-rowid="${escHtml(String(rowid))}">
    <td class="td-actions">
      <button class="row-delete-btn btn-sm" data-rowid="${escHtml(String(rowid))}" title="Delete">🗑️</button>
    </td>
    ${cols.map((c) => `<td class="td-data" data-col="${escHtml(c)}">${formatCellValue(row[c])}</td>`).join('')}
  </tr>`;
}

// ─── Cell editing ──────────────────────────────────────────────────────────────
function startCellEdit(td) {
  const tr = td?.closest('tr');
  const col = td?.dataset.col;
  if (!tr || !col || td.classList.contains('cell-editing')) return;
  const rowid = tr.dataset.rowid;
  const row = state.rows.find((r) => String(r._rowid_) === String(rowid));
  if (!row) return;
  const original = row[col];
  const { input, kind } = buildCellEditor(col, original);

  state.editingCell = { rowid, col };
  state.selectedCell = { rowid, col };
  td.classList.add('cell-editing');
  td.replaceChildren(input);
  updateCellSelection();

  let done = false;
  let saving = false;
  const finish = async (save) => {
    if (done || saving) return;

    if (!save) {
      done = true;
      state.editingCell = null;
      td.classList.remove('cell-editing');
      td.innerHTML = formatCellValue(original);
      updateCellSelection();
      return;
    }

    let next;
    try {
      next = parseEditorValue(col, kind, input);
    } catch (err) {
      toast(err.message, 'error');
      input.focus();
      return;
    }

    const unchanged = next === original || (kind === 'string' && original === null && next === '');
    if (unchanged) {
      done = true;
      state.editingCell = null;
      td.classList.remove('cell-editing');
      td.innerHTML = formatCellValue(original);
      updateCellSelection();
      return;
    }

    saving = true;
    try {
      await api.updateRow(state.currentDb, state.currentTable, rowid, { [col]: next });
      row[col] = next;
      done = true;
      state.editingCell = null;
      td.classList.remove('cell-editing');
      td.innerHTML = formatCellValue(next);
      updateCellSelection();
      toast('Cell updated', 'success');
    } catch (err) {
      saving = false;
      toast('Error: ' + err.message, 'error');
      input.focus();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
      return;
    }
    if (kind === 'string') {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        finish(true);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    }
  });

  input.addEventListener('blur', () => finish(true));
  requestAnimationFrame(() => input.focus());
}

async function deleteRow(rowid) {
  try {
    await api.deleteRow(state.currentDb, state.currentTable, rowid);
    toast('Row deleted', 'success');
    loadRows();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// ─── Pagination ────────────────────────────────────────────────────────────────
function updatePagination(visible) {
  const bar = document.getElementById('pagination-bar');
  bar.style.display = visible ? 'flex' : 'none';
  if (!visible) return;

  const start = (state.page - 1) * state.pageSize + 1;
  const end = Math.min(state.page * state.pageSize, state.total);

  document.getElementById('page-info').textContent =
    state.total === 0
      ? 'No rows'
      : `Rows ${start}–${end} of ${state.total}`;
  document.getElementById('btn-prev-page').disabled = state.page <= 1;
  document.getElementById('btn-next-page').disabled = state.page >= state.totalPages;
}

// ─── Insert panel ──────────────────────────────────────────────────────────────
async function renderInsertForm() {
  const panel = document.getElementById('insert-panel');
  if (!state.schema) {
    await loadSchema();
  }
  if (!state.schema) {
    panel.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><p>Schema not available</p></div>';
    return;
  }

  const cols = state.schema.columns.filter(
    (c) => !(c.pk && c.type && c.type.toLowerCase() === 'integer')
  );

  const fields = cols
    .map((c) => {
      const isPk = c.pk === 1;
      const isRequired = c.notnull === 1 && c.dflt_value === null && !isPk;
      return `<div class="form-row">
        <label>
          ${escHtml(c.name)}
          <span class="col-type-badge">${escHtml(c.type || 'TEXT')}</span>
          ${isPk ? '<span class="col-pk-badge">PK</span>' : ''}
          ${isRequired ? '<span style="color:var(--color-danger)">*</span>' : ''}
        </label>
        <input
          type="text"
          name="${escHtml(c.name)}"
          placeholder="${escHtml(c.dflt_value !== null ? `default: ${c.dflt_value}` : (c.notnull ? 'required' : 'optional'))}"
          ${isPk ? 'disabled title="Auto-generated primary key"' : ''}
        />
      </div>`;
    })
    .join('');

  panel.innerHTML = `<div class="insert-form">
    <h3>Insert new row into <em>${escHtml(state.currentTable)}</em></h3>
    <form id="insert-form">
      ${fields}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Insert Row</button>
        <button type="button" class="btn btn-secondary" id="insert-reset-btn">Reset</button>
      </div>
    </form>
  </div>`;

  document.getElementById('insert-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {};
    panel.querySelectorAll('input[name]:not([disabled])').forEach((input) => {
      if (input.value !== '') data[input.name] = input.value;
    });
    try {
      await api.insertRow(state.currentDb, state.currentTable, data);
      toast('Row inserted successfully', 'success');
      e.target.reset();
      // Refresh data if viewing data tab
      if (state.currentTab === 'data') loadRows();
    } catch (err) {
      toast('Insert failed: ' + err.message, 'error');
    }
  });

  document.getElementById('insert-reset-btn').addEventListener('click', () => {
    panel.querySelector('form').reset();
  });
}

// ─── Schema panel ──────────────────────────────────────────────────────────────
async function loadSchema() {
  if (!state.currentDb || !state.currentTable) return;
  try {
    const data = await api.getSchema(state.currentDb, state.currentTable);
    state.schema = data;
    if (state.currentTab === 'schema') renderSchema(data);
  } catch (err) {
    state.schema = null;
  }
}

function renderSchema(data) {
  const panel = document.getElementById('schema-panel');
  const { columns, indices } = data;

  const colRows = columns
    .map(
      (c) => `<tr>
      <td>${escHtml(String(c.cid))}</td>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td><span class="schema-badge">${escHtml(c.type || 'TEXT')}</span></td>
      <td>${c.notnull ? '<span class="schema-badge badge-notnull">NOT NULL</span>' : ''}</td>
      <td>${c.pk ? '<span class="schema-badge badge-pk">PK</span>' : ''}</td>
      <td>${c.dflt_value !== null ? `<span class="schema-badge badge-default">${escHtml(String(c.dflt_value))}</span>` : ''}</td>
    </tr>`
    )
    .join('');

  let idxHtml = '';
  if (indices.length > 0) {
    const idxRows = indices
      .map(
        (i) => `<tr>
        <td>${escHtml(i.index_name)}</td>
        <td>${escHtml(i.column_name)}</td>
        <td>${i.unique ? '<span class="schema-badge badge-unique">UNIQUE</span>' : ''}</td>
      </tr>`
      )
      .join('');
    idxHtml = `<div class="schema-section">
      <div class="schema-section-header">🔑 Indices</div>
      <table class="schema-table">
        <thead><tr><th>Name</th><th>Column</th><th>Constraints</th></tr></thead>
        <tbody>${idxRows}</tbody>
      </table>
    </div>`;
  }

  panel.innerHTML = `
    <div class="schema-section">
      <div class="schema-section-header">📋 Columns <span style="font-weight:400;font-size:12px;color:var(--color-text-muted)">${columns.length} column${columns.length !== 1 ? 's' : ''}</span></div>
      <table class="schema-table">
        <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Constraints</th><th>Key</th><th>Default</th></tr></thead>
        <tbody>${colRows}</tbody>
      </table>
    </div>
    ${idxHtml}`;
}

// ─── SQL editor panel ──────────────────────────────────────────────────────────
function initSqlPanel() {
  // Set default SQL if textarea is empty
  const ta = document.getElementById('sql-textarea');
  if (!ta.value && state.currentTable) {
    ta.value = `SELECT * FROM "${state.currentTable.replace(/"/g, '""')}" LIMIT 100;`;
  }
}

async function runSql() {
  const sql = document.getElementById('sql-textarea').value.trim();
  if (!sql) return;

  const resultsEl = document.getElementById('sql-results');
  resultsEl.innerHTML = '<div class="loading-state"><div class="spinner"></div> Running…</div>';

  try {
    const data = await api.query(state.currentDb, sql);

    if (data.rows !== undefined) {
      // SELECT-like result
      if (data.rows.length === 0) {
        resultsEl.innerHTML = `
          <div class="sql-result-info"><span class="result-count">0 rows</span></div>
          <div class="empty-state"><span class="empty-icon">📭</span><p>Query returned no rows</p></div>`;
        return;
      }
      const cols = Object.keys(data.rows[0]);
      const headerCells = cols.map((c) => `<th>${escHtml(c)}</th>`).join('');
      const bodyRows = data.rows
        .map(
          (r) =>
            `<tr>${cols.map((c) => `<td>${formatCellValue(r[c])}</td>`).join('')}</tr>`
        )
        .join('');

      resultsEl.innerHTML = `
        <div class="sql-result-info">
          <span class="result-count">${data.rowCount} row${data.rowCount !== 1 ? 's' : ''}</span>
        </div>
        <div class="sql-result-table-wrap">
          <table class="sql-result-table">
            <thead><tr>${headerCells}</tr></thead>
            <tbody>${bodyRows}</tbody>
          </table>
        </div>`;
    } else {
      // DML result
      resultsEl.innerHTML = `<div class="sql-success-message">
        ✅ Query executed successfully.<br>
        <strong>${data.changes}</strong> row(s) affected.
        ${data.lastInsertRowid ? `Last insert rowid: <strong>${data.lastInsertRowid}</strong>` : ''}
      </div>`;
      // Reload rows if we're on data tab
      if (state.currentTab === 'data') loadRows();
    }
  } catch (err) {
    resultsEl.innerHTML = `<div class="sql-error">⚠️ ${escHtml(err.message)}</div>`;
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  // DB selector
  document.getElementById('db-selector').addEventListener('change', (e) => {
    selectDatabase(e.target.value);
  });

  // Table search
  document.getElementById('table-search').addEventListener('input', (e) => {
    renderTableList(state.tables, e.target.value);
  });

  // Row search
  document.getElementById('row-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    state.page = 1;
    loadRows();
  });

  // Tabs
  document.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      setTab(tab);
      if (tab === 'insert') renderInsertForm();
      if (tab === 'schema' && state.schema) renderSchema(state.schema);
    });
  });

  // Pagination
  document.getElementById('btn-prev-page').addEventListener('click', () => {
    if (state.page > 1) { state.page--; loadRows(); }
  });
  document.getElementById('btn-next-page').addEventListener('click', () => {
    if (state.page < state.totalPages) { state.page++; loadRows(); }
  });

  // Page size
  document.getElementById('page-size-select').addEventListener('change', (e) => {
    state.pageSize = parseInt(e.target.value, 10);
    state.page = 1;
    loadRows();
  });

  // SQL run button
  document.getElementById('sql-run-btn').addEventListener('click', runSql);

  // SQL keyboard shortcut: Ctrl+Enter / Cmd+Enter
  document.getElementById('sql-textarea').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runSql();
    }
  });

  // Refresh button
  document.getElementById('btn-refresh').addEventListener('click', () => loadRows());

  // Init
  await loadDatabases();
}

document.addEventListener('DOMContentLoaded', init);
