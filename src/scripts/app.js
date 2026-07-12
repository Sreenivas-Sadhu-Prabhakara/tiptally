// tiptally — client island. Wires the form to the split engine, persists to
// localStorage, renders the receipt-tape split sheet, print + copy.
import { computeSplit, centsToStr, METHOD_LABELS } from './split.js';

const STORAGE_KEY = 'tiptally.v1';

// Editable role weights (defaults from the brief).
const DEFAULT_ROLES = {
  server: 1.0,
  bartender: 1.0,
  busser: 0.7,
  host: 0.6,
  kitchen: 0.5,
};

const CURRENCIES = ['$', '£', '€', '₹', '¥', 'R$', 'A$', 'C$', '₩', '₦'];

// Sensible example roster so the tool explains itself on first load.
const EXAMPLE_STATE = {
  currency: '$',
  method: 'weighted',
  poolCash: 240,
  poolCard: 360,
  splitCashCard: false,
  roles: { ...DEFAULT_ROLES },
  tipOuts: [
    { label: 'Bar tip-out', pct: 3 },
    { label: 'Busser tip-out', pct: 2 },
  ],
  people: [
    { id: pid(), name: 'Maya', role: 'server', hours: 6.5, sales: 820 },
    { id: pid(), name: 'Devon', role: 'server', hours: 8, sales: 1140 },
    { id: pid(), name: 'Priya', role: 'bartender', hours: 7, sales: 640 },
    { id: pid(), name: 'Luis', role: 'busser', hours: 5, sales: 0 },
    { id: pid(), name: 'Sam', role: 'host', hours: 4, sales: 0 },
  ],
};

let state = null;

function pid() {
  return 'p' + Math.random().toString(36).slice(2, 9);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneish(EXAMPLE_STATE);
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch {
    return structuredCloneish(EXAMPLE_STATE);
  }
}

function normalizeState(s) {
  const base = structuredCloneish(EXAMPLE_STATE);
  const out = { ...base, ...s };
  out.roles = { ...DEFAULT_ROLES, ...(s.roles || {}) };
  out.tipOuts = Array.isArray(s.tipOuts) ? s.tipOuts : base.tipOuts;
  out.people = Array.isArray(s.people) && s.people.length ? s.people : base.people;
  out.people = out.people.map((p) => ({
    id: p.id || pid(),
    name: p.name || '',
    role: p.role || 'server',
    hours: numOr(p.hours, 0),
    sales: numOr(p.sales, 0),
  }));
  out.currency = CURRENCIES.includes(s.currency) ? s.currency : base.currency;
  out.method = ['weighted', 'hours', 'equal', 'sales'].includes(s.method)
    ? s.method
    : base.method;
  return out;
}

function structuredCloneish(o) {
  return JSON.parse(JSON.stringify(o));
}

function numOr(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    flashSaved();
  } catch {
    /* private mode / quota — non-fatal */
  }
}

let savedTimer = null;
function flashSaved() {
  const el = $('#save-status');
  if (!el) return;
  el.textContent = 'Saved to this device';
  el.dataset.on = 'true';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    el.dataset.on = 'false';
  }, 1600);
}

// ---- tiny DOM helpers ----
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ------------------------------------------------------------------ render

function buildInput() {
  return {
    poolCash: state.splitCashCard ? state.poolCash : 0,
    poolCard: state.splitCashCard ? state.poolCard : state.poolCash + state.poolCard,
    method: state.method,
    tipOuts: state.tipOuts,
    people: state.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      hours: p.hours,
      weight: state.roles[p.role] ?? 1,
      sales: p.sales,
    })),
  };
}

// When cash/card split is OFF we keep one pool number in poolCash for the UI,
// but the engine wants both — normalize so totals are correct either way.
function poolForEngine() {
  if (state.splitCashCard) {
    return { poolCash: state.poolCash, poolCard: state.poolCard };
  }
  return { poolCash: state.poolCash, poolCard: 0 };
}

function currentResult() {
  const inp = {
    ...poolForEngine(),
    method: state.method,
    tipOuts: state.tipOuts,
    people: state.people.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      hours: p.hours,
      weight: state.roles[p.role] ?? 1,
      sales: p.sales,
    })),
  };
  return computeSplit(inp);
}

function money(cents) {
  return state.currency + centsToStr(cents);
}

function renderAll() {
  renderControls();
  renderRoster();
  renderTipOuts();
  renderRoles();
  renderSheet();
}

function renderControls() {
  // currency
  const curSel = $('#currency');
  if (curSel && curSel.value !== state.currency) curSel.value = state.currency;

  // method radios
  $$('input[name="method"]').forEach((r) => {
    r.checked = r.value === state.method;
  });

  // cash/card toggle + fields
  const toggle = $('#split-cashcard');
  if (toggle) toggle.checked = state.splitCashCard;
  $('#pool-single-wrap').hidden = state.splitCashCard;
  $('#pool-split-wrap').hidden = !state.splitCashCard;

  setVal('#pool-single', state.poolCash);
  setVal('#pool-cash', state.poolCash);
  setVal('#pool-card', state.poolCard);

  // sales column visibility hint
  const salesActive = state.method === 'sales';
  $('#roster').dataset.sales = salesActive ? 'on' : 'off';

  // currency prefixes
  $$('.cur-prefix').forEach((n) => (n.textContent = state.currency));
}

function setVal(sel, v) {
  const n = $(sel);
  if (n && document.activeElement !== n) n.value = v;
}

function renderRoster() {
  const tbody = $('#roster-body');
  if (!tbody) return;
  tbody.replaceChildren();
  const roleOptions = Object.keys(state.roles);

  state.people.forEach((p, idx) => {
    const roleSel = el('select', {
      class: 'cell-role',
      'aria-label': `Role for ${p.name || 'person ' + (idx + 1)}`,
    });
    roleOptions.forEach((r) => {
      const o = el('option', { value: r, text: capitalize(r) });
      if (r === p.role) o.selected = true;
      roleSel.append(o);
    });
    roleSel.addEventListener('change', () => {
      p.role = roleSel.value;
      saveState();
      renderSheet();
      renderRoster();
    });

    const nameInput = el('input', {
      type: 'text',
      class: 'cell-name',
      value: p.name,
      placeholder: 'Name',
      'aria-label': `Name for person ${idx + 1}`,
    });
    nameInput.addEventListener('input', () => {
      p.name = nameInput.value;
      saveState();
      renderSheet();
    });

    const hoursInput = numInput(p.hours, `Hours for ${p.name || 'person ' + (idx + 1)}`);
    hoursInput.classList.add('cell-hours');
    hoursInput.addEventListener('input', () => {
      p.hours = numOr(hoursInput.value, 0);
      saveState();
      renderSheet();
    });

    const salesInput = numInput(p.sales, `Sales for ${p.name || 'person ' + (idx + 1)}`);
    salesInput.classList.add('cell-sales');
    salesInput.addEventListener('input', () => {
      p.sales = numOr(salesInput.value, 0);
      saveState();
      renderSheet();
    });

    const weightBadge = el('span', {
      class: 'weight-badge',
      title: 'Role weight (edit under Role weights)',
      text: '×' + (state.roles[p.role] ?? 1),
    });

    const removeBtn = el('button', {
      type: 'button',
      class: 'row-remove',
      'aria-label': `Remove ${p.name || 'person ' + (idx + 1)}`,
      text: 'Remove',
    });
    removeBtn.addEventListener('click', () => {
      state.people = state.people.filter((x) => x.id !== p.id);
      if (state.people.length === 0) addPerson(false);
      saveState();
      renderRoster();
      renderSheet();
    });

    const tr = el('tr', { class: 'roster-row' }, [
      el('td', { class: 'td-name' }, [nameInput]),
      el('td', { class: 'td-role' }, [roleSel, weightBadge]),
      el('td', { class: 'td-hours num' }, [hoursInput]),
      el('td', { class: 'td-sales num' }, [salesInput]),
      el('td', { class: 'td-remove' }, [removeBtn]),
    ]);
    tbody.append(tr);
  });
}

function numInput(value, label) {
  return el('input', {
    type: 'number',
    inputmode: 'decimal',
    min: '0',
    step: '0.01',
    value: value,
    'aria-label': label,
  });
}

function renderTipOuts() {
  const wrap = $('#tipout-list');
  if (!wrap) return;
  wrap.replaceChildren();
  state.tipOuts.forEach((t, i) => {
    const label = el('input', {
      type: 'text',
      class: 'tipout-label',
      value: t.label,
      placeholder: 'e.g. Bar tip-out',
      'aria-label': `Tip-out ${i + 1} label`,
    });
    label.addEventListener('input', () => {
      t.label = label.value;
      saveState();
      renderSheet();
    });

    const pct = el('input', {
      type: 'number',
      class: 'tipout-pct',
      min: '0',
      max: '100',
      step: '0.1',
      inputmode: 'decimal',
      value: t.pct,
      'aria-label': `Tip-out ${i + 1} percent`,
    });
    pct.addEventListener('input', () => {
      t.pct = numOr(pct.value, 0);
      saveState();
      renderSheet();
    });

    const rm = el('button', {
      type: 'button',
      class: 'row-remove small',
      'aria-label': `Remove tip-out ${i + 1}`,
      text: 'Remove',
    });
    rm.addEventListener('click', () => {
      state.tipOuts.splice(i, 1);
      saveState();
      renderTipOuts();
      renderSheet();
    });

    wrap.append(
      el('div', { class: 'tipout-row' }, [
        label,
        el('span', { class: 'pct-wrap' }, [pct, el('span', { class: 'pct-sign', text: '%' })]),
        rm,
      ])
    );
  });
}

function renderRoles() {
  const wrap = $('#roles-list');
  if (!wrap) return;
  wrap.replaceChildren();
  Object.entries(state.roles).forEach(([role, weight]) => {
    const inp = el('input', {
      type: 'number',
      class: 'role-weight',
      min: '0',
      step: '0.1',
      inputmode: 'decimal',
      value: weight,
      'aria-label': `Weight for ${capitalize(role)}`,
    });
    inp.addEventListener('input', () => {
      state.roles[role] = numOr(inp.value, 0);
      saveState();
      renderRoster();
      renderSheet();
    });
    wrap.append(
      el('div', { class: 'role-row' }, [
        el('span', { class: 'role-name', text: capitalize(role) }),
        el('span', { class: 'role-mult', text: '×' }),
        inp,
      ])
    );
  });
}

function renderSheet() {
  const res = currentResult();
  const sheet = $('#sheet');
  if (!sheet) return;

  // header numbers
  $('#sheet-pool').textContent = money(res.poolCents);
  $('#sheet-method').textContent = res.methodLabel;
  $('#sheet-distributable').textContent = money(res.distributableCents);
  $('#sheet-date').textContent = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // cash / card breakdown line
  const cc = $('#sheet-cashcard');
  if (state.splitCashCard) {
    cc.hidden = false;
    cc.textContent = `Cash ${money(res.cashCents)}  ·  Card ${money(res.cardCents)}`;
  } else {
    cc.hidden = true;
  }

  // tip-outs
  const toWrap = $('#sheet-tipouts');
  toWrap.replaceChildren();
  if (res.tipOutRows.length) {
    toWrap.append(el('div', { class: 'ledger-subhead', text: 'Off the top' }));
    res.tipOutRows.forEach((r) => {
      toWrap.append(
        ledgerLine(r.label, `${r.pct}%`, '−' + money(r.cents).slice(state.currency.length))
      );
    });
    toWrap.append(
      el('div', { class: 'ledger-line rule' }, [
        el('span', { class: 'll-name', text: 'Remaining pool to split' }),
        el('span', { class: 'll-mid' }),
        el('span', { class: 'll-amt strong', text: money(res.distributableCents) }),
      ])
    );
    toWrap.hidden = false;
  } else {
    toWrap.hidden = true;
  }

  // people ledger
  const body = $('#sheet-body');
  body.replaceChildren();
  body.append(el('div', { class: 'ledger-subhead', text: 'Each person’s share' }));
  res.rows.forEach((r) => {
    const amt = el('span', { class: 'll-amt strong', text: money(r.share) });
    const head = el('div', { class: 'ledger-line' }, [
      el('span', { class: 'll-name', text: r.name }),
      el('span', { class: 'll-mid', text: r.role ? capitalize(r.role) : '' }),
      amt,
    ]);
    const detail = el('div', { class: 'll-detail' }, [
      el('div', { class: 'll-formula', text: r.formula + ' = ' + money(r.share) }),
      el('div', { class: 'll-why', text: r.why }),
    ]);
    body.append(el('div', { class: 'ledger-person' }, [head, detail]));
  });

  // reconciliation
  const rec = $('#sheet-recon');
  rec.replaceChildren();
  const distributed = res.distributedCents;
  const parts = [money(distributed)];
  if (res.tipOutTotalCents > 0) parts.push(money(res.tipOutTotalCents) + ' tip-outs');
  const recLine = el('div', { class: 'recon-line' }, [
    el('span', {
      class: 'recon-check',
      'data-ok': res.reconciled ? 'true' : 'false',
      text: res.reconciled ? 'Balanced' : 'Off',
    }),
    el('span', {
      class: 'recon-text',
      text: res.reconciled
        ? `${parts.join(' + ')} = ${money(res.poolCents)} pool, to the cent.`
        : `Shares total ${money(distributed + res.tipOutTotalCents)} vs ${money(
            res.poolCents
          )} pool.`,
    }),
  ]);
  rec.append(recLine);
  rec.append(
    el('div', {
      class: 'recon-note',
      text: 'Leftover cents are handed out one at a time by largest remainder, so the total always matches the pool exactly.',
    })
  );

  // summary text stashed for copy
  sheet.dataset.summary = buildSummaryText(res);
}

function ledgerLine(name, mid, amt) {
  return el('div', { class: 'ledger-line' }, [
    el('span', { class: 'll-name', text: name }),
    el('span', { class: 'll-mid', text: mid }),
    el('span', { class: 'll-amt', text: amt }),
  ]);
}

function buildSummaryText(res) {
  const lines = [];
  lines.push(`tiptally — tip split (${res.methodLabel})`);
  lines.push(`Pool: ${money(res.poolCents)}`);
  if (state.splitCashCard) {
    lines.push(`  Cash ${money(res.cashCents)} / Card ${money(res.cardCents)}`);
  }
  res.tipOutRows.forEach((r) => {
    lines.push(`Off the top — ${r.label} (${r.pct}%): −${money(r.cents)}`);
  });
  if (res.tipOutRows.length) lines.push(`Remaining to split: ${money(res.distributableCents)}`);
  lines.push('');
  res.rows.forEach((r) => {
    lines.push(`${r.name} (${capitalize(r.role)}): ${money(r.share)}  — ${r.why}`);
  });
  lines.push('');
  lines.push(
    res.reconciled
      ? `Balanced: shares + tip-outs = ${money(res.poolCents)} exactly.`
      : `Check: totals ${money(res.distributedCents + res.tipOutTotalCents)} vs pool ${money(
          res.poolCents
        )}.`
  );
  lines.push('Not legal, payroll, or tax advice. Verify against local law and workplace policy.');
  return lines.join('\n');
}

function capitalize(s) {
  s = String(s || '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------ actions

function addPerson(save = true) {
  state.people.push({ id: pid(), name: '', role: 'server', hours: 0, sales: 0 });
  if (save) {
    saveState();
    renderRoster();
    renderSheet();
    // focus the new name field
    const rows = $$('#roster-body .cell-name');
    if (rows.length) rows[rows.length - 1].focus();
  }
}

function addTipOut() {
  state.tipOuts.push({ label: '', pct: 0 });
  saveState();
  renderTipOuts();
  renderSheet();
}

function resetToExample() {
  state = structuredCloneish(EXAMPLE_STATE);
  state.people.forEach((p) => (p.id = pid()));
  saveState();
  renderAll();
}

function clearRoster() {
  state.people = [];
  addPerson(false);
  saveState();
  renderAll();
}

async function copySummary() {
  const text = $('#sheet').dataset.summary || '';
  const btn = $('#copy-btn');
  const done = () => {
    if (!btn) return;
    const old = btn.textContent;
    btn.textContent = 'Copied';
    btn.dataset.done = 'true';
    setTimeout(() => {
      btn.textContent = old;
      btn.dataset.done = 'false';
    }, 1500);
  };
  try {
    await navigator.clipboard.writeText(text);
    done();
  } catch {
    // Fallback for browsers without async clipboard / http contexts.
    const ta = el('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      /* give up silently */
    }
    ta.remove();
  }
}

// ------------------------------------------------------------------ wiring

function wire() {
  // currency
  const curSel = $('#currency');
  CURRENCIES.forEach((c) => {
    const o = el('option', { value: c, text: c });
    if (c === state.currency) o.selected = true;
    curSel.append(o);
  });
  curSel.addEventListener('change', () => {
    state.currency = curSel.value;
    saveState();
    renderAll();
  });

  // method
  $$('input[name="method"]').forEach((r) => {
    r.addEventListener('change', () => {
      if (r.checked) {
        state.method = r.value;
        saveState();
        renderControls();
        renderSheet();
      }
    });
  });

  // pool inputs
  $('#pool-single').addEventListener('input', (e) => {
    state.poolCash = numOr(e.target.value, 0);
    state.poolCard = 0;
    saveState();
    renderSheet();
  });
  $('#pool-cash').addEventListener('input', (e) => {
    state.poolCash = numOr(e.target.value, 0);
    saveState();
    renderSheet();
  });
  $('#pool-card').addEventListener('input', (e) => {
    state.poolCard = numOr(e.target.value, 0);
    saveState();
    renderSheet();
  });

  // cash/card toggle
  $('#split-cashcard').addEventListener('change', (e) => {
    state.splitCashCard = e.target.checked;
    if (!state.splitCashCard) {
      // fold card back into a single pool total
      state.poolCash = state.poolCash + state.poolCard;
      state.poolCard = 0;
    }
    saveState();
    renderControls();
    renderSheet();
  });

  // buttons
  $('#add-person').addEventListener('click', () => addPerson());
  $('#add-tipout').addEventListener('click', addTipOut);
  $('#reset-example').addEventListener('click', resetToExample);
  $('#clear-roster').addEventListener('click', clearRoster);
  $('#print-btn').addEventListener('click', () => window.print());
  $('#copy-btn').addEventListener('click', copySummary);
}

function init() {
  state = loadState();
  wire();
  renderAll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
