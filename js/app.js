'use strict';

const CONFIG = window.BACK_CONFIG;
const TEXTS = window.BACK_TEXTS;
const EXPORT_FORMAT = 'sweet-afternoon-back';
const VIEWS = ['entry', 'summary', 'settings'];

const state = {
  view: 'entry',
  // 입력 화면의 날짜 'YYYY-MM-DD' 와 고른 캐스트
  date: '',
  castId: null,
  // 집계 기간 (끝 날짜 포함)
  from: '',
  to: '',
  receiptCast: 'all',
  // casts: [{ id, name, member }]  지금까지 나온 모든 캐스트. 지우지 않는다 (기록의 이름 표시용).
  //   member: 기본 멤버 (「設定」 목록). 매일 입력 화면에 나온다.
  // items: [{ id, name, back, removed }]  back 이 0 이면 금액을 직접 입력하는 품목
  //   removed: 「削除」한 것. 입력·설정 화면에서는 숨기고, 지난 기록의 이름 표시에만 쓴다.
  // days: { 'YYYY-MM-DD': { castId: { itemId: { n, back } | { amount } } } }
  //   back 은 입력한 때의 백 금액 (나중에 금액을 바꿔도 지난 기록은 그대로)
  // rosters: { 'YYYY-MM-DD': { added: [castId], hidden: [castId] } }  그날만 추가·제외한 캐스트
  data: { casts: [], items: [], days: {}, rosters: {} },
};

// ---------- 날짜 ----------

function toKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function fromKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(key, days) {
  const date = fromKey(key);
  date.setDate(date.getDate() + days);
  return toKey(date);
}

// 새벽(dayChangeHour 전)에는 전날 영업일로 본다.
function businessToday() {
  const now = new Date();
  now.setHours(now.getHours() - CONFIG.dayChangeHour);
  return toKey(now);
}

function dateLabel(key) {
  const date = fromKey(key);
  return TEXTS.dateLabel(date.getMonth() + 1, date.getDate(), TEXTS.weekdays[date.getDay()]);
}

function shortDate(key) {
  const date = fromKey(key);
  return TEXTS.shortDate(date.getMonth() + 1, date.getDate(), TEXTS.weekdays[date.getDay()]);
}

function fullDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return TEXTS.fullDate(y, m, d);
}

function monthRange(offset) {
  const date = fromKey(businessToday());
  const first = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const last = new Date(date.getFullYear(), date.getMonth() + offset + 1, 0);
  return [toKey(first), toKey(last)];
}

// ---------- 공통 ----------

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function setStatus(message, isError = false) {
  const node = document.getElementById('status');
  node.textContent = message;
  node.classList.toggle('is-error', isError);
}

// ---------- 데이터 ----------

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function normalizeEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  if ('amount' in value) {
    const amount = toAmount(value.amount);
    return amount ? { amount } : null;
  }
  const n = toAmount(value.n);
  return n ? { n, back: toAmount(value.back) } : null;
}

function normalizeCast(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') {
    return null;
  }
  // 예전 데이터(removed)는 「삭제하지 않은 것 = 기본 멤버」로 읽는다.
  const member = typeof value.member === 'boolean' ? value.member : value.removed !== true;
  return { id: value.id, name: typeof value.name === 'string' ? value.name : '', member };
}

function normalizeItem(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string') {
    return null;
  }
  return { id: value.id, name: typeof value.name === 'string' ? value.name : '', back: toAmount(value.back), removed: value.removed === true };
}

function normalizeRosters(value) {
  const rosters = {};
  if (!value || typeof value !== 'object') {
    return rosters;
  }
  const ids = (list) => (Array.isArray(list) ? [...new Set(list.filter((id) => typeof id === 'string'))] : []);
  for (const [key, roster] of Object.entries(value)) {
    const added = ids(roster?.added);
    const hidden = ids(roster?.hidden);
    if (/^\d{4}-\d{2}-\d{2}$/.test(key) && (added.length || hidden.length)) {
      rosters[key] = { added, hidden };
    }
  }
  return rosters;
}

function normalizeDays(value) {
  const days = {};
  if (!value || typeof value !== 'object') {
    return days;
  }
  for (const [key, casts] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !casts || typeof casts !== 'object') {
      continue;
    }
    for (const [castId, entries] of Object.entries(casts)) {
      if (!entries || typeof entries !== 'object') {
        continue;
      }
      for (const [itemId, raw] of Object.entries(entries)) {
        const entry = normalizeEntry(raw);
        if (entry) {
          days[key] ??= {};
          days[key][castId] ??= {};
          days[key][castId][itemId] = entry;
        }
      }
    }
  }
  return days;
}

function normalizeData(raw) {
  const list = (value, normalize) => (Array.isArray(value) ? value.map(normalize).filter(Boolean) : []);
  return {
    casts: list(raw?.casts, normalizeCast),
    items: list(raw?.items, normalizeItem),
    days: normalizeDays(raw?.days),
    rosters: normalizeRosters(raw?.rosters),
  };
}

function loadData() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CONFIG.storageKey)) || {};
  } catch (err) {
    console.error('保存された記録を読み込めませんでした', err);
  }
  const data = normalizeData(saved);
  // 처음 열었을 때는 config.js 의 품목으로 시작한다.
  if (!Array.isArray(saved.items)) {
    data.items = CONFIG.items.map(normalizeItem);
  }
  return data;
}

function saveData() {
  try {
    localStorage.setItem(CONFIG.storageKey, JSON.stringify(state.data));
  } catch (err) {
    console.error('バックの保存に失敗しました', err);
    setStatus(TEXTS.saveFailed, true);
    return false;
  }
  setStatus(TEXTS.saved);
  return true;
}

function castById(id) {
  return state.data.casts.find((cast) => cast.id === id);
}

function castName(id) {
  return state.data.casts.find((cast) => cast.id === id)?.name || id;
}

function itemById(id) {
  return state.data.items.find((item) => item.id === id);
}

function itemName(id) {
  return itemById(id)?.name || id;
}

function isDrink(itemId) {
  return CONFIG.drinkItems.includes(itemId);
}

function entriesOf(key, castId) {
  return state.data.days[key]?.[castId] || {};
}

function setEntry(key, castId, itemId, entry) {
  const days = state.data.days;
  if (entry) {
    days[key] ??= {};
    days[key][castId] ??= {};
    days[key][castId][itemId] = entry;
  } else if (days[key]?.[castId]) {
    delete days[key][castId][itemId];
    if (Object.keys(days[key][castId]).length === 0) {
      delete days[key][castId];
    }
    if (Object.keys(days[key]).length === 0) {
      delete days[key];
    }
  }
  saveData();
}

function entryAmount(entry) {
  return entry.amount ?? entry.n * entry.back;
}

function sumEntries(entries) {
  return Object.values(entries).reduce((sum, entry) => sum + entryAmount(entry), 0);
}

function drinkCount(entries) {
  return Object.entries(entries).reduce((sum, [itemId, entry]) => sum + (isDrink(itemId) ? entry.n || 0 : 0), 0);
}

// 설정의 품목 순서대로
function orderedEntries(entries) {
  const order = new Map(state.data.items.map((item, index) => [item.id, index]));
  return Object.entries(entries).sort(([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
}

// ---------- 그날의 캐스트 ----------

// 이름으로 캐스트를 찾고, 없으면 기본 멤버가 아닌 캐스트로 만든다.
function castByName(name) {
  const same = state.data.casts.filter((cast) => cast.name.trim() === name);
  const found = same.find((cast) => cast.member) || same[0];
  if (found) {
    return found;
  }
  const cast = { id: newId('cast'), name, member: false };
  state.data.casts.push(cast);
  return cast;
}

// 그날의 캐스트 = 기본 멤버 + 그날 추가한 사람 − 그날 뺀 사람
// 그날 입력이 있는 사람은 항상 들어간다 (명세와 목록이 어긋나지 않도록).
function dayCasts(key) {
  const roster = state.data.rosters[key] || { added: [], hidden: [] };
  const entered = state.data.days[key] || {};
  const ids = [
    ...state.data.casts.filter((cast) => cast.member).map((cast) => cast.id),
    ...roster.added,
    ...Object.keys(entered),
  ];
  return [...new Set(ids)]
    .filter((id) => id in entered || !roster.hidden.includes(id))
    .map(castById)
    .filter(Boolean);
}

function updateRoster(key, castId, add) {
  const roster = state.data.rosters[key] || { added: [], hidden: [] };
  roster.added = roster.added.filter((id) => id !== castId);
  roster.hidden = roster.hidden.filter((id) => id !== castId);
  (add ? roster.added : roster.hidden).push(castId);
  state.data.rosters[key] = roster;
}

function addToDay(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  const cast = castByName(trimmed);
  updateRoster(state.date, cast.id, true);
  state.castId = cast.id;
  saveData();
  renderEntry();
}

function removeFromDay() {
  const castId = state.castId;
  const total = sumEntries(entriesOf(state.date, castId));
  if (total && !confirm(TEXTS.confirmRemoveFromDay(castName(castId), dateLabel(state.date), TEXTS.yen(total)))) {
    return;
  }
  delete state.data.days[state.date]?.[castId];
  if (state.data.days[state.date] && Object.keys(state.data.days[state.date]).length === 0) {
    delete state.data.days[state.date];
  }
  updateRoster(state.date, castId, false);
  saveData();
  renderEntry();
}

// ---------- 탭 ----------

function renderTabs() {
  document.getElementById('view-tabs').innerHTML = VIEWS.map(
    (view) => `<button type="button" class="view-tabs__tab" role="tab" data-view="${view}">${escapeHtml(TEXTS.viewTabs[view])}</button>`,
  ).join('');
}

function selectView(view) {
  state.view = view;
  for (const name of VIEWS) {
    document.getElementById(`view-${name}`).hidden = name !== view;
  }
  document.querySelectorAll('.view-tabs__tab').forEach((tab) => {
    tab.setAttribute('aria-selected', String(tab.dataset.view === view));
  });
  render();
}

function render() {
  ({ entry: renderEntry, summary: renderSummary, settings: renderSettings })[state.view]();
}

// ---------- 입력 ----------

function renderEntry() {
  const key = state.date;
  document.getElementById('entry-date-label').textContent = dateLabel(key);
  document.getElementById('entry-date').value = key;

  const casts = dayCasts(key);
  document.getElementById('no-casts').hidden = casts.length > 0;
  if (!casts.some((cast) => cast.id === state.castId)) {
    state.castId = casts[0]?.id ?? null;
  }
  // 이름 후보: 그날 목록에 없는 캐스트
  const shownIds = new Set(casts.map((cast) => cast.id));
  const candidates = [...new Set(state.data.casts.filter((cast) => !shownIds.has(cast.id)).map((cast) => cast.name.trim()).filter(Boolean))];
  document.getElementById('cast-picker').innerHTML = casts
    .map((cast) => {
      const total = sumEntries(entriesOf(key, cast.id));
      return `<button type="button" class="chip" role="radio" aria-checked="${cast.id === state.castId}" data-action="pick-cast" data-cast="${escapeHtml(cast.id)}">
        <span>${escapeHtml(cast.name || TEXTS.newCast)}</span>
        ${total ? `<span class="chip__total">${escapeHtml(TEXTS.yen(total))}</span>` : ''}
      </button>`;
    })
    .join('') + `<span class="day-add">
      <input type="text" id="day-add-name" list="day-add-list" maxlength="20" placeholder="${escapeHtml(TEXTS.dayAddPlaceholder)}" aria-label="${escapeHtml(TEXTS.dayAddLabel)}">
      <button type="button" data-action="day-add">${escapeHtml(TEXTS.dayAdd)}</button>
      <datalist id="day-add-list">${candidates.map((name) => `<option value="${escapeHtml(name)}">`).join('')}</datalist>
    </span>`;

  renderEntryItems();
  renderDayOverview();
}

function renderEntryItems() {
  const node = document.getElementById('entry-items');
  const cast = castById(state.castId);
  node.hidden = !cast;
  if (!cast) {
    return;
  }
  const entries = entriesOf(state.date, cast.id);
  // 삭제한 품목이라도 그날 기록이 있으면 보여 준다.
  const items = state.data.items.filter((item) => !item.removed || item.id in entries);
  const rows = items.map((item) => {
    const entry = entries[item.id];
    const name = escapeHtml(item.name || TEXTS.newItem);
    const id = escapeHtml(item.id);
    // 백 금액이 없는 품목은 금액을 직접 넣는다.
    if (entry ? 'amount' in entry : !item.back) {
      return `<div class="entry-row${entry ? ' is-active' : ''}">
        <span class="entry-row__name">${name}<small>${escapeHtml(TEXTS.manualHint)}</small></span>
        <input type="number" inputmode="numeric" min="0" step="100" data-manual="${id}"
          value="${entry?.amount ?? ''}" placeholder="${escapeHtml(TEXTS.manualPlaceholder)}" aria-label="${escapeHtml(TEXTS.manualLabel(item.name))}">
        <span class="entry-row__amount">${entry ? escapeHtml(TEXTS.yen(entry.amount)) : ''}</span>
      </div>`;
    }
    const count = entry?.n || 0;
    return `<div class="entry-row${count ? ' is-active' : ''}">
      <span class="entry-row__name">${name}<small>${escapeHtml(TEXTS.unitBack(entry?.back ?? item.back))}</small></span>
      <span class="counter">
        <button type="button" data-action="minus" data-item="${id}" aria-label="${escapeHtml(TEXTS.minus(item.name))}" ${count ? '' : 'disabled'}>−</button>
        <output>${count}</output>
        <button type="button" data-action="plus" data-item="${id}" aria-label="${escapeHtml(TEXTS.plus(item.name))}">＋</button>
      </span>
      <span class="entry-row__amount">${count ? escapeHtml(TEXTS.yen(entryAmount(entry))) : ''}</span>
    </div>`;
  });
  const total = sumEntries(entries);
  node.innerHTML = `
    <div class="entry-items">${rows.join('')}</div>
    <div class="entry-total">
      <span>${escapeHtml(TEXTS.castDayTotal(cast.name))}</span>
      <strong>${escapeHtml(TEXTS.yen(total))}</strong>
    </div>
    <div class="entry-links">
      <button type="button" class="link-button" data-action="clear-cast-day" ${total ? '' : 'disabled'}>${escapeHtml(TEXTS.clearCastDay)}</button>
      <button type="button" class="link-button" data-action="remove-from-day">${escapeHtml(TEXTS.removeFromDay)}</button>
    </div>`;
}

function renderDayOverview() {
  const node = document.getElementById('day-overview');
  const casts = state.data.days[state.date] || {};
  const rows = state.data.casts
    .filter((cast) => cast.id in casts)
    .map((cast) => {
      const entries = casts[cast.id];
      const drinks = drinkCount(entries);
      return `<tr>
        <th scope="row">${escapeHtml(cast.name)}</th>
        <td>${drinks ? escapeHtml(TEXTS.cups(drinks)) : ''}</td>
        <td>${escapeHtml(TEXTS.yen(sumEntries(entries)))}</td>
      </tr>`;
    });
  const total = Object.values(casts).reduce((sum, entries) => sum + sumEntries(entries), 0);
  node.innerHTML = `<h2>${escapeHtml(TEXTS.dayOverview)}</h2>` + (rows.length === 0
    ? `<p class="empty">${escapeHtml(TEXTS.dayOverviewEmpty)}</p>`
    : `<table class="table">
        <tbody>${rows.join('')}</tbody>
        <tfoot><tr><th scope="row">${escapeHtml(TEXTS.dayTotal)}</th><td></td><td>${escapeHtml(TEXTS.yen(total))}</td></tr></tfoot>
      </table>`);
}

function changeCount(itemId, delta) {
  const entry = entriesOf(state.date, state.castId)[itemId];
  const n = Math.max(0, (entry?.n || 0) + delta);
  // 그날 처음 입력한 때의 백 금액을 계속 쓴다.
  setEntry(state.date, state.castId, itemId, n ? { n, back: entry?.back ?? itemById(itemId).back } : null);
  renderEntry();
}

function setManual(itemId, value) {
  const amount = toAmount(value);
  setEntry(state.date, state.castId, itemId, amount ? { amount } : null);
  renderEntry();
}

function clearCastDay() {
  const name = castName(state.castId);
  if (!confirm(TEXTS.confirmClearCastDay(name, dateLabel(state.date)))) {
    return;
  }
  delete state.data.days[state.date]?.[state.castId];
  if (state.data.days[state.date] && Object.keys(state.data.days[state.date]).length === 0) {
    delete state.data.days[state.date];
  }
  saveData();
  renderEntry();
}

function moveDate(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    state.date = key;
    renderEntry();
  }
}

// ---------- 집계・명세 ----------

// 기간 안의 한 캐스트 합계
function castReport(castId) {
  const report = { castId, back: 0, drinks: 0, days: [], items: new Map() };
  const keys = Object.keys(state.data.days).filter((key) => key >= state.from && key <= state.to).sort();
  for (const key of keys) {
    const entries = state.data.days[key][castId];
    if (!entries) {
      continue;
    }
    const lines = orderedEntries(entries);
    let subtotal = 0;
    for (const [itemId, entry] of lines) {
      const amount = entryAmount(entry);
      subtotal += amount;
      if (isDrink(itemId)) {
        report.drinks += entry.n || 0;
      }
      const sum = report.items.get(itemId) || { n: 0, amount: 0 };
      sum.n += entry.n || 0;
      sum.amount += amount;
      report.items.set(itemId, sum);
    }
    report.back += subtotal;
    report.days.push({ key, lines, subtotal });
  }
  return report;
}

function periodReports() {
  return state.data.casts.map((cast) => castReport(cast.id)).filter((report) => report.days.length > 0);
}

function validPeriod() {
  return state.from && state.to && state.from <= state.to;
}

function setPeriod(from, to) {
  state.from = from;
  state.to = to;
  renderSummary();
}

function renderSummary() {
  document.getElementById('period-from').value = state.from;
  document.getElementById('period-to').value = state.to;
  const node = document.getElementById('summary');
  const receipts = document.getElementById('receipts');
  const select = document.getElementById('receipt-cast');
  if (!validPeriod()) {
    node.innerHTML = `<p class="empty is-error">${escapeHtml(TEXTS.periodInvalid)}</p>`;
    receipts.replaceChildren();
    select.replaceChildren();
    return;
  }

  const reports = periodReports();
  const total = (field) => reports.reduce((sum, report) => sum + report[field], 0);
  node.innerHTML = reports.length === 0
    ? `<p class="empty">${escapeHtml(TEXTS.summaryEmpty)}</p>`
    : `<div class="stats">
        <div class="stat"><span>${escapeHtml(TEXTS.storeDrinks)}</span><strong>${escapeHtml(TEXTS.cups(total('drinks')))}</strong></div>
        <div class="stat"><span>${escapeHtml(TEXTS.storeBack)}</span><strong>${escapeHtml(TEXTS.yen(total('back')))}</strong></div>
      </div>
      <table class="table">
        <thead><tr>
          <th scope="col">${escapeHtml(TEXTS.colCast)}</th>
          <th scope="col">${escapeHtml(TEXTS.colDays)}</th>
          <th scope="col">${escapeHtml(TEXTS.colDrinks)}</th>
          <th scope="col">${escapeHtml(TEXTS.colBack)}</th>
        </tr></thead>
        <tbody>${reports
          .map((report) => `<tr>
            <th scope="row"><button type="button" class="link-button" data-action="open-receipt" data-cast="${escapeHtml(report.castId)}" aria-label="${escapeHtml(TEXTS.openReceipt(castName(report.castId)))}">${escapeHtml(castName(report.castId))}</button></th>
            <td>${escapeHtml(TEXTS.days(report.days.length))}</td>
            <td>${escapeHtml(TEXTS.cups(report.drinks))}</td>
            <td>${escapeHtml(TEXTS.yen(report.back))}</td>
          </tr>`)
          .join('')}</tbody>
        <tfoot><tr>
          <th scope="row">${escapeHtml(TEXTS.totalRow)}</th>
          <td></td>
          <td>${escapeHtml(TEXTS.cups(total('drinks')))}</td>
          <td>${escapeHtml(TEXTS.yen(total('back')))}</td>
        </tr></tfoot>
      </table>`;

  if (state.receiptCast !== 'all' && !reports.some((report) => report.castId === state.receiptCast)) {
    state.receiptCast = 'all';
  }
  select.innerHTML = [`<option value="all">${escapeHtml(TEXTS.receiptAll)}</option>`]
    .concat(reports.map((report) => `<option value="${escapeHtml(report.castId)}">${escapeHtml(castName(report.castId))}</option>`))
    .join('');
  select.value = state.receiptCast;

  const shown = state.receiptCast === 'all' ? reports : reports.filter((report) => report.castId === state.receiptCast);
  receipts.innerHTML = shown.length === 0
    ? `<p class="empty">${escapeHtml(TEXTS.receiptEmpty)}</p>`
    : shown.map(receiptHtml).join('');
}

// 금액을 직접 넣은 품목은 개수 없이 이름만
function lineLabel(itemId, count) {
  return count ? `${itemName(itemId)} ×${count}` : itemName(itemId);
}

// 명세의 줄 목록. 화면(HTML)과 이미지(canvas)가 같은 내용을 그린다.
//   type: store / title / line / sub / cast / hr / heading / date / total / issued
function receiptRows(report) {
  const number = (amount) => amount.toLocaleString('ja-JP');
  const now = new Date();
  const issued = `${fullDate(toKey(now))} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return [
    { type: 'store', label: TEXTS.storeName },
    { type: 'title', label: TEXTS.receiptTitle },
    { type: 'line', label: TEXTS.receiptPeriod, value: `${fullDate(state.from)} ${TEXTS.periodSep} ${fullDate(state.to)}` },
    { type: 'cast', label: TEXTS.receiptCast, value: castName(report.castId) },
    { type: 'hr' },
    { type: 'heading', label: TEXTS.receiptDays },
    ...report.days.flatMap((day) => [
      { type: 'date', label: shortDate(day.key) },
      ...day.lines.map(([itemId, entry]) => ({ type: 'dayLine', label: lineLabel(itemId, entry.n), value: number(entryAmount(entry)) })),
      { type: 'sub', label: TEXTS.receiptSubtotal, value: number(day.subtotal) },
    ]),
    { type: 'hr' },
    { type: 'heading', label: TEXTS.receiptItems },
    ...orderedEntries(Object.fromEntries(report.items)).map(([itemId, sum]) => ({ type: 'line', label: lineLabel(itemId, sum.n), value: number(sum.amount) })),
    { type: 'hr' },
    { type: 'line', label: TEXTS.receiptDrinks, value: TEXTS.cups(report.drinks) },
    { type: 'line', label: TEXTS.receiptInputDays, value: TEXTS.days(report.days.length) },
    { type: 'total', label: TEXTS.receiptTotal, value: `¥${number(report.back)}` },
    { type: 'issued', label: TEXTS.receiptIssued(issued) },
  ];
}

function receiptHtml(report) {
  const line = (row, className) => `<div class="receipt__line ${className}"><span>${escapeHtml(row.label)}</span><span>${escapeHtml(row.value)}</span></div>`;
  const html = {
    store: (row) => `<p class="receipt__store">${escapeHtml(row.label)}</p>`,
    title: (row) => `<h3>${escapeHtml(row.label)}</h3>`,
    line: (row) => line(row, ''),
    cast: (row) => line(row, 'receipt__line--cast'),
    dayLine: (row) => line(row, 'receipt__line--day'),
    sub: (row) => line(row, 'receipt__line--sub'),
    hr: () => '<hr>',
    heading: (row) => `<h4>${escapeHtml(row.label)}</h4>`,
    date: (row) => `<p class="receipt__date">${escapeHtml(row.label)}</p>`,
    total: (row) => `<div class="receipt__total"><span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong></div>`,
    issued: (row) => `<p class="receipt__issued">${escapeHtml(row.label)}</p>`,
  };
  return `<div class="receipt-wrap">
    <article class="receipt">${receiptRows(report).map((row) => html[row.type](row)).join('')}</article>
    <button type="button" class="receipt-save" data-action="save-receipt" data-cast="${escapeHtml(report.castId)}">${escapeHtml(TEXTS.saveReceipt)}</button>
  </div>`;
}

// ---------- 명세 이미지 ----------

// 줄마다의 높이(px)와 글자 모양. 화면의 영수증(style.css)과 맞춘다.
const RECEIPT_IMAGE = {
  width: 340,
  padding: 20,
  // 휴대폰 사진으로도 선명하도록 3배로 그린다.
  scale: 3,
  font: '"BIZ UDGothic", "Osaka-Mono", "MS Gothic", ui-monospace, monospace',
  ink: '#2a2f3a',
  muted: '#6b7280',
  faint: '#9ca3af',
  rows: {
    store: { height: 20, size: 12, color: 'muted', align: 'center', spacing: 2.4 },
    title: { height: 36, size: 17, weight: 700, align: 'center', spacing: 2.5 },
    line: { height: 21, size: 13 },
    cast: { height: 21, size: 13, valueWeight: 700 },
    dayLine: { height: 21, size: 13, indent: 13 },
    sub: { height: 21, size: 13, indent: 13, color: 'muted' },
    hr: { height: 21 },
    heading: { height: 24, size: 12, weight: 700, color: 'muted' },
    date: { height: 23, size: 13, weight: 700 },
    total: { height: 52 },
    issued: { height: 36, size: 11, color: 'faint', align: 'center' },
  },
};

function drawSpacedText(ctx, text, x, y, spacing, align) {
  if (!spacing) {
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
    return;
  }
  const chars = [...text];
  const width = chars.reduce((sum, char) => sum + ctx.measureText(char).width, 0) + spacing * (chars.length - 1);
  let cursor = align === 'center' ? x - width / 2 : x;
  ctx.textAlign = 'left';
  for (const char of chars) {
    ctx.fillText(char, cursor, y);
    cursor += ctx.measureText(char).width + spacing;
  }
}

function drawReceipt(report) {
  const { width, padding, scale, font, rows: styles } = RECEIPT_IMAGE;
  const rows = receiptRows(report);
  const bottom = 26;
  const height = padding + rows.reduce((sum, row) => sum + styles[row.type].height, 0) + bottom;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = 'middle';

  const left = padding;
  const right = width - padding;
  let y = padding;
  for (const row of rows) {
    const style = styles[row.type];
    const center = y + style.height / 2;
    ctx.fillStyle = RECEIPT_IMAGE[style.color || 'ink'];
    ctx.font = `${style.weight || 400} ${style.size || 13}px ${font}`;
    if (row.type === 'hr') {
      ctx.strokeStyle = RECEIPT_IMAGE.faint;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(left, Math.round(center) + 0.5);
      ctx.lineTo(right, Math.round(center) + 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (row.type === 'total') {
      ctx.fillStyle = RECEIPT_IMAGE.ink;
      ctx.fillRect(left, y + 10, right - left, 2);
      ctx.font = `400 13px ${font}`;
      ctx.textAlign = 'left';
      ctx.fillText(row.label, left, y + 34);
      ctx.font = `700 22px ${font}`;
      ctx.textAlign = 'right';
      ctx.fillText(row.value, right, y + 32);
    } else if (style.align === 'center') {
      drawSpacedText(ctx, row.label, width / 2, center, style.spacing || 0, 'center');
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(row.label, left + (style.indent || 0), center);
      if (row.value !== undefined) {
        ctx.font = `${style.valueWeight || style.weight || 400} ${style.size || 13}px ${font}`;
        ctx.textAlign = 'right';
        ctx.fillText(row.value, right, center);
      }
    }
    y += style.height;
  }

  // 아래쪽 톱니 모양 (화면의 영수증과 같게)
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 7; x < width; x += 14) {
    ctx.beginPath();
    ctx.arc(x, height, 6, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas;
}

async function saveReceiptImage(castId) {
  const report = castReport(castId);
  if (report.days.length === 0) {
    return;
  }
  let blob;
  try {
    await document.fonts.ready;
    blob = await new Promise((resolve) => drawReceipt(report).toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('toBlob failed');
    }
  } catch (err) {
    console.error('画像を作成できませんでした', err);
    setStatus(TEXTS.receiptImageFailed, true);
    return;
  }
  const safeName = castName(castId).replace(/[\\/:*?"<>|\s]/g, '_');
  const file = new File([blob], TEXTS.receiptImageFile(safeName, state.from, state.to), { type: 'image/png' });

  // 휴대폰에서는 공유 창(「画像を保存」으로 사진에 저장, LINE 등)으로 보낸다. 안 되면 파일로 내려받는다.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      setStatus(TEXTS.receiptImageSaved);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('共有に失敗しました', err);
        downloadFile(file);
        setStatus(TEXTS.receiptImageSaved);
      }
    }
    return;
  }
  downloadFile(file);
  setStatus(TEXTS.receiptImageSaved);
}

function exportCsv() {
  if (!validPeriod()) {
    setStatus(TEXTS.periodInvalid, true);
    return;
  }
  const reports = periodReports();
  const usedIds = new Set(reports.flatMap((report) => [...report.items.keys()]));
  const items = state.data.items.filter((item) => usedIds.has(item.id));
  const header = [TEXTS.colCast, TEXTS.colDays, TEXTS.receiptDrinks, ...items.map((item) => item.name), TEXTS.receiptTotal];
  // 품목 칸: 개수로 센 품목은 개수, 금액을 직접 넣은 품목은 금액
  const rows = reports.map((report) => [
    castName(report.castId),
    report.days.length,
    report.drinks,
    ...items.map((item) => {
      const sum = report.items.get(item.id);
      return sum ? sum.n || sum.amount : 0;
    }),
    report.back,
  ]);
  const cell = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = [[`${TEXTS.periodLabel} ${fullDate(state.from)}${TEXTS.periodSep}${fullDate(state.to)}`], header, ...rows]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
  // 엑셀에서 일본어가 깨지지 않도록 BOM 을 붙인다.
  downloadFile(new File(['﻿' + csv], TEXTS.csvFile(state.from, state.to), { type: 'text/csv' }));
  setStatus(TEXTS.csvExported);
}

function printReceipts() {
  if (state.view !== 'summary') {
    selectView('summary');
  }
  window.print();
}

// ---------- 설정 ----------

function iconButton(action, index, label, text, disabled = false) {
  return `<button type="button" class="icon-button" data-action="${action}" data-index="${index}" aria-label="${escapeHtml(label)}" ${disabled ? 'disabled' : ''}>${text}</button>`;
}

// 설정 화면에 나오는 행: 캐스트는 기본 멤버, 품목은 삭제하지 않은 것
function isListed(row) {
  return 'member' in row ? row.member : !row.removed;
}

// 설정 화면에 나오는 행만, 원래 목록의 위치(index)와 함께 그린다.
function settingRows(kind, list, fields) {
  const shown = list.map((row, index) => ({ row, index })).filter(({ row }) => isListed(row));
  return shown
    .map(({ row, index }, position) => `<div class="setting-row setting-row--${kind}">
      ${fields(row, index)}
      ${iconButton(`${kind}-up`, index, TEXTS.moveUp, '↑', position === 0)}
      ${iconButton(`${kind}-down`, index, TEXTS.moveDown, '↓', position === shown.length - 1)}
      ${iconButton(`${kind}-remove`, index, TEXTS.remove, '×')}
    </div>`)
    .join('');
}

function renderSettings() {
  document.getElementById('cast-list').innerHTML = settingRows('cast', state.data.casts, (cast, index) =>
    `<input type="text" maxlength="20" data-kind="cast" data-field="name" data-index="${index}" value="${escapeHtml(cast.name)}" placeholder="${escapeHtml(TEXTS.castPlaceholder)}">`);
  document.getElementById('item-list').innerHTML = settingRows('item', state.data.items, (item, index) =>
    `<input type="text" maxlength="30" data-kind="item" data-field="name" data-index="${index}" value="${escapeHtml(item.name)}" placeholder="${escapeHtml(TEXTS.itemPlaceholder)}">
    <span class="yen-input">
      <input type="number" inputmode="numeric" min="0" step="10" data-kind="item" data-field="back" data-index="${index}" value="${item.back || ''}" placeholder="${escapeHtml(TEXTS.backPlaceholder)}" aria-label="${escapeHtml(TEXTS.backLabel)}">
      <span>円</span>
    </span>`);
}

function handleSettingInput(event) {
  const { kind, field, index } = event.target.dataset;
  const row = (kind === 'cast' ? state.data.casts : state.data.items)[Number(index)];
  if (!row) {
    return;
  }
  row[field] = field === 'back' ? toAmount(event.target.value) : event.target.value;
  saveData();
}

// 설정 화면에 없는 행은 건너뛰고, 보이는 바로 위·아래 행과 자리를 바꾼다.
function moveRow(list, index, delta) {
  let next = index + delta;
  while (list[next] && !isListed(list[next])) {
    next += delta;
  }
  if (!list[next]) {
    return;
  }
  [list[index], list[next]] = [list[next], list[index]];
  saveData();
  renderSettings();
}

// 기록에 이름이 남도록 목록에서 지우지 않고 숨긴다.
function removeRow(list, index) {
  const row = list[index];
  const isCast = 'member' in (row || {});
  if (!row || !confirm(isCast ? TEXTS.confirmRemoveMember(row.name) : TEXTS.confirmRemove(row.name))) {
    return;
  }
  if (isCast) {
    row.member = false;
  } else {
    row.removed = true;
  }
  saveData();
  renderSettings();
}

// 새로 추가한 기본 멤버에 이미 있는 캐스트(그날만 추가한 사람, 기본 멤버에서 뺀 사람)와 같은 이름을 넣으면,
// 지난 기록이 이어지도록 새 행 대신 그 캐스트를 같은 자리에 기본 멤버로 넣는다.
function mergeSameNameCast(index) {
  const casts = state.data.casts;
  const cast = casts[index];
  const name = cast?.name.trim();
  const other = casts.find((row) => row !== cast && !row.member && row.name.trim() === name);
  const used = Object.values(state.data.days).some((day) => cast?.id in day)
    || Object.values(state.data.rosters).some((roster) => roster.added.includes(cast?.id) || roster.hidden.includes(cast?.id));
  if (!other || !name || used) {
    return;
  }
  other.member = true;
  casts.splice(casts.indexOf(other), 1);
  casts.splice(casts.indexOf(cast), 1, other);
  saveData();
  renderSettings();
}

function addRow(kind, row) {
  (kind === 'cast' ? state.data.casts : state.data.items).push(row);
  saveData();
  renderSettings();
  const inputs = document.querySelectorAll(`[data-kind="${kind}"][data-field="name"]`);
  inputs[inputs.length - 1]?.focus();
}

// ---------- 데이터 이동 ----------

function downloadFile(file) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportData() {
  const data = { format: EXPORT_FORMAT, version: 1, exportedAt: new Date().toISOString(), data: state.data };
  const fileName = `back-data_${toKey(new Date()).replaceAll('-', '')}.json`;
  const file = new File([JSON.stringify(data, null, 2)], fileName, { type: 'application/json' });

  // 휴대폰에서는 공유 창(AirDrop, LINE, メール 등)으로 바로 보낸다. 안 되면 파일로 내려받는다.
  const isTouch = window.matchMedia('(pointer: coarse)').matches;
  if (isTouch && navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: fileName }).catch((err) => {
      if (err.name !== 'AbortError') {
        console.error('共有に失敗しました', err);
        downloadFile(file);
      }
    });
  } else {
    downloadFile(file);
  }
  setStatus(TEXTS.exported);
}

// 같은 id 는 읽어 온 것으로 바꾸고, 새 id 는 뒤에 붙인다.
function mergeById(current, incoming) {
  const merged = current.map((row) => incoming.find((next) => next.id === row.id) || row);
  return merged.concat(incoming.filter((next) => !current.some((row) => row.id === next.id)));
}

async function importData(file) {
  let imported;
  try {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('file too large');
    }
    const raw = JSON.parse(await file.text());
    if (raw?.format !== EXPORT_FORMAT || typeof raw.data !== 'object') {
      throw new Error('unknown format');
    }
    imported = normalizeData(raw.data);
  } catch (err) {
    console.error('読み込みに失敗しました', err);
    setStatus(TEXTS.importInvalid, true);
    return;
  }
  const dayCount = Object.keys(imported.days).length;
  if (dayCount === 0 && imported.casts.length === 0 && imported.items.length === 0) {
    setStatus(TEXTS.importEmpty, true);
    return;
  }
  if (!confirm(TEXTS.confirmImport(dayCount))) {
    return;
  }
  state.data.casts = mergeById(state.data.casts, imported.casts);
  state.data.items = mergeById(state.data.items, imported.items);
  Object.assign(state.data.days, imported.days);
  Object.assign(state.data.rosters, imported.rosters);
  if (saveData()) {
    setStatus(TEXTS.imported(dayCount));
  }
  document.getElementById('data-dialog').close();
  render();
}

// ---------- 시작 ----------

function applyTexts() {
  document.title = TEXTS.pageTitle;
  document.querySelectorAll('[data-text]').forEach((node) => {
    node.textContent = TEXTS[node.dataset.text];
  });
  document.querySelectorAll('[data-text-label]').forEach((node) => {
    node.setAttribute('aria-label', TEXTS[node.dataset.textLabel]);
  });
}

function handleAction(button) {
  const { action, item, cast } = button.dataset;
  const index = Number(button.dataset.index);
  const actions = {
    'prev-day': () => moveDate(addDays(state.date, -1)),
    'next-day': () => moveDate(addDays(state.date, 1)),
    today: () => moveDate(businessToday()),
    'pick-cast': () => {
      state.castId = cast;
      renderEntry();
    },
    minus: () => changeCount(item, -1),
    plus: () => changeCount(item, 1),
    'clear-cast-day': clearCastDay,
    'remove-from-day': removeFromDay,
    'day-add': () => addToDay(document.getElementById('day-add-name').value),
    'this-month': () => setPeriod(...monthRange(0)),
    'last-month': () => setPeriod(...monthRange(-1)),
    'open-receipt': () => {
      state.receiptCast = cast;
      renderSummary();
      document.getElementById('receipts').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'add-cast': () => addRow('cast', { id: newId('cast'), name: '', member: true }),
    'add-item': () => addRow('item', { id: newId('item'), name: '', back: 0, removed: false }),
    'cast-up': () => moveRow(state.data.casts, index, -1),
    'cast-down': () => moveRow(state.data.casts, index, 1),
    'cast-remove': () => removeRow(state.data.casts, index),
    'item-up': () => moveRow(state.data.items, index, -1),
    'item-down': () => moveRow(state.data.items, index, 1),
    'item-remove': () => removeRow(state.data.items, index),
    csv: exportCsv,
    print: printReceipts,
    'save-receipt': () => saveReceiptImage(cast),
    data: () => document.getElementById('data-dialog').showModal(),
    export: exportData,
    import: () => document.getElementById('import-file').click(),
    'close-data': () => document.getElementById('data-dialog').close(),
  };
  actions[action]?.();
}

function init() {
  applyTexts();
  setStatus(TEXTS.autosave);
  state.data = loadData();
  state.date = businessToday();
  [state.from, state.to] = monthRange(0);
  renderTabs();
  selectView('entry');

  document.getElementById('view-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-view]');
    if (tab) {
      selectView(tab.dataset.view);
    }
  });
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button && !button.disabled) {
      handleAction(button);
    }
  });

  document.getElementById('entry-date').addEventListener('change', (event) => moveDate(event.target.value));
  document.getElementById('cast-picker').addEventListener('keydown', (event) => {
    if (event.target.id === 'day-add-name' && event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      addToDay(event.target.value);
    }
  });
  document.getElementById('entry-items').addEventListener('change', (event) => {
    if (event.target.dataset.manual) {
      setManual(event.target.dataset.manual, event.target.value);
    }
  });

  document.getElementById('period-from').addEventListener('change', (event) => setPeriod(event.target.value, state.to));
  document.getElementById('period-to').addEventListener('change', (event) => setPeriod(state.from, event.target.value));
  document.getElementById('receipt-cast').addEventListener('change', (event) => {
    state.receiptCast = event.target.value;
    renderSummary();
  });

  // 입력하는 동안 바로 저장한다. 다시 그리지 않으므로 입력칸 포커스가 빠지지 않는다.
  document.getElementById('view-settings').addEventListener('input', (event) => {
    if (event.target.dataset.kind) {
      handleSettingInput(event);
    }
  });
  document.getElementById('view-settings').addEventListener('change', (event) => {
    if (event.target.dataset.kind === 'cast') {
      mergeSameNameCast(Number(event.target.dataset.index));
    }
  });

  const importInput = document.getElementById('import-file');
  importInput.addEventListener('change', () => {
    if (importInput.files[0]) {
      importData(importInput.files[0]);
    }
    // 같은 파일을 다시 골라도 change 가 일어나도록 비운다.
    importInput.value = '';
  });

  // 같은 기기의 다른 탭에서 입력한 내용을 반영한다.
  window.addEventListener('storage', (event) => {
    if (event.key === CONFIG.storageKey) {
      state.data = loadData();
      render();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
