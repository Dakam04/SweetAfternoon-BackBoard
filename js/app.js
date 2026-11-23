'use strict';

const CONFIG = window.BACK_CONFIG;
const TEXTS = window.BACK_TEXTS;
const EXPORT_FORMAT = 'sweet-afternoon-back';
const VIEWS = ['entry', 'sales', 'summary', 'settings'];

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
  // works: { 'YYYY-MM-DD': { castId: { start, end, break, rate, nightRate, nightStart, nightEnd, unit } } }  그날의 근무
  //   break: 휴게(분). 근무 시간의 끝(퇴근 쪽)부터 뺀다.
  //   rate, nightRate: 그날 그 사람의 시급·심야 시급. 처음엔 설정 값이고, 입력 화면에서 그날만 바꿀 수 있다.
  //   nightStart〜nightEnd, unit(계산 단위 분)도 입력한 때의 값 (나중에 설정을 바꿔도 지난 기록은 그대로)
  // wage: { base, nightRate }  시급 설정. cast.rate / cast.nightRate 가 있으면 그쪽을 쓴다.
  // sales: { 'YYYY-MM-DD': { guests, store, remote } }  그날의 손님 수와 매상(가게・원격, 円)
  // targets: { 'YYYY-MM': amount }  그달의 목표 매상(円)
  data: { casts: [], items: [], days: {}, rosters: {}, works: {}, wage: { base: 0, nightRate: 0 }, sales: {}, targets: {} },
  // 출근·퇴근 중 하나만 넣었거나 시각을 잘못 넣은 상태 (입력한 글자 그대로 둔다)
  workDraft: null,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  // rate / nightRate: 그 사람만의 시급·심야 시급. 0 이면 「設定」의 시급을 쓴다.
  return { id: value.id, name: typeof value.name === 'string' ? value.name : '', member, rate: toAmount(value.rate), nightRate: toAmount(value.nightRate) };
}

// 시급 설정. 금액은 「設定」에서 직접 넣는다. 심야 시간대는 config.js (nightStart〜nightEnd)
function normalizeWage(value) {
  return { base: toAmount(value?.base), nightRate: toAmount(value?.nightRate) };
}

function normalizeWork(value) {
  if (!value || typeof value !== 'object' || !TIME_PATTERN.test(value.start) || !TIME_PATTERN.test(value.end)) {
    return null;
  }
  const time = (text, fallback) => (TIME_PATTERN.test(text) ? text : fallback);
  return {
    start: value.start,
    end: value.end,
    break: toAmount(value.break),
    rate: toAmount(value.rate),
    nightRate: toAmount(value.nightRate),
    nightStart: time(value.nightStart, CONFIG.nightStart),
    nightEnd: time(value.nightEnd, CONFIG.nightEnd),
    unit: toAmount(value.unit) || CONFIG.timeUnitMinutes,
  };
}

function normalizeWorks(value) {
  const works = {};
  if (!value || typeof value !== 'object') {
    return works;
  }
  for (const [key, casts] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !casts || typeof casts !== 'object') {
      continue;
    }
    for (const [castId, raw] of Object.entries(casts)) {
      const work = normalizeWork(raw);
      if (work) {
        works[key] ??= {};
        works[key][castId] = work;
      }
    }
  }
  return works;
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

const SALES_FIELDS = ['guests', 'store', 'remote'];

function normalizeSales(value) {
  const sales = {};
  if (!value || typeof value !== 'object') {
    return sales;
  }
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !raw || typeof raw !== 'object') {
      continue;
    }
    const day = Object.fromEntries(SALES_FIELDS.map((field) => [field, toAmount(raw[field])]));
    if (SALES_FIELDS.some((field) => day[field])) {
      sales[key] = day;
    }
  }
  return sales;
}

function normalizeTargets(value) {
  const targets = {};
  if (!value || typeof value !== 'object') {
    return targets;
  }
  for (const [month, amount] of Object.entries(value)) {
    if (/^\d{4}-\d{2}$/.test(month) && toAmount(amount)) {
      targets[month] = toAmount(amount);
    }
  }
  return targets;
}

function normalizeData(raw) {
  const list = (value, normalize) => (Array.isArray(value) ? value.map(normalize).filter(Boolean) : []);
  return {
    casts: list(raw?.casts, normalizeCast),
    items: list(raw?.items, normalizeItem),
    days: normalizeDays(raw?.days),
    rosters: normalizeRosters(raw?.rosters),
    works: normalizeWorks(raw?.works),
    sales: normalizeSales(raw?.sales),
    targets: normalizeTargets(raw?.targets),
    // 시급 설정이 없는 데이터(예전 데이터)는 null. 불러올 때 처음 설정으로 채운다.
    wage: raw?.wage && typeof raw.wage === 'object' ? normalizeWage(raw.wage) : null,
  };
}

// 두 기록을 하나로 더한다. 백 금액이 다르면 합계가 맞도록 1개당 금액을 평균 낸다.
function addEntries(a, b) {
  if ('n' in a && 'n' in b) {
    const n = a.n + b.n;
    return { n, back: a.back === b.back ? a.back : Math.round((a.n * a.back + b.n * b.back) / n) };
  }
  const total = (entry) => entry.amount ?? entry.n * entry.back;
  return { amount: total(a) + total(b) };
}

// 이름(앞뒤 공백 무시)이 같은 캐스트는 한 사람으로 합친다.
// 남기는 쪽은 기본 멤버를 우선하고, 나머지의 기록·그날 목록을 그쪽으로 옮긴다.
// 수기로 추가한 뒤 설정에 같은 이름을 넣었거나, 다른 기기의 데이터를 읽어 왔을 때 생기는 중복을 없앤다.
// 합친 캐스트 수를 돌려준다.
function mergeSameNameCasts(data) {
  const groups = new Map();
  for (const cast of data.casts) {
    const name = cast.name.trim();
    if (name) {
      groups.set(name, [...(groups.get(name) || []), cast]);
    }
  }
  const renamed = new Map();
  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }
    const keeper = group.find((cast) => cast.member) || group[0];
    for (const cast of group) {
      if (cast !== keeper) {
        renamed.set(cast.id, keeper.id);
        // 남기는 쪽에 직접 넣은 시급이 없으면 합쳐지는 쪽 시급을 이어받는다.
        keeper.rate ||= cast.rate || 0;
        keeper.nightRate ||= cast.nightRate || 0;
      }
    }
  }
  if (renamed.size === 0) {
    return 0;
  }

  data.casts = data.casts.filter((cast) => !renamed.has(cast.id));
  for (const day of Object.values(data.days)) {
    for (const [fromId, toId] of renamed) {
      const moving = day[fromId];
      if (!moving) {
        continue;
      }
      const target = (day[toId] ??= {});
      for (const [itemId, entry] of Object.entries(moving)) {
        target[itemId] = target[itemId] ? addEntries(target[itemId], entry) : entry;
      }
      delete day[fromId];
    }
  }
  // 근무 기록: 같은 날 둘 다 있으면 남기는 쪽 기록을 쓴다 (시각을 더할 수는 없으므로).
  for (const day of Object.values(data.works || {})) {
    for (const [fromId, toId] of renamed) {
      if (day[fromId]) {
        day[toId] ??= day[fromId];
        delete day[fromId];
      }
    }
  }
  for (const roster of Object.values(data.rosters)) {
    const map = (list) => [...new Set(list.map((id) => renamed.get(id) || id))];
    roster.added = map(roster.added);
    // 한쪽이라도 그날 추가돼 있었으면 보이게 둔다.
    roster.hidden = map(roster.hidden).filter((id) => !roster.added.includes(id));
  }
  if (renamed.has(state.castId)) {
    state.castId = renamed.get(state.castId);
  }
  if (renamed.has(state.receiptCast)) {
    state.receiptCast = renamed.get(state.receiptCast);
  }
  return renamed.size;
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
  data.wage ??= normalizeWage({});
  // 이미 저장된 중복도 열 때 합쳐서 저장해 둔다.
  if (mergeSameNameCasts(data)) {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(data));
    } catch (err) {
      console.error('バックの保存に失敗しました', err);
    }
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

// ---------- 시급 ----------

const DAY_MINUTES = 24 * 60;

function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

// 직접 입력한 시각을 HH:MM 으로. 「18」「1830」「18:30」「18時30分」「１８：３０」, 26:00 (= 02:00) 까지 받는다.
// 읽을 수 없으면 ''
function parseTime(text) {
  const plain = String(text)
    .replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/時/g, ':')
    .replace(/分|\s/g, '');
  const match = plain.match(/^(\d{1,2})(?::?(\d{2}))?:?$/);
  if (!match) {
    return '';
  }
  const hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  return hour <= 29 && minute <= 59 ? fromMinutes((hour % 24) * 60 + minute) : '';
}

// minute: 0〜1439. 끝이 시작보다 이르면 날짜를 넘는 시간대 (22:00〜05:00)
function inNight(minute, work) {
  const start = toMinutes(work.nightStart);
  const end = toMinutes(work.nightEnd);
  if (start === end) {
    return false;
  }
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

// 퇴근이 출근보다 이르면 다음 날 퇴근
function shiftMinutes(work) {
  const start = toMinutes(work.start);
  const end = toMinutes(work.end);
  return end < start ? end + DAY_MINUTES - start : end - start;
}

// 심야 시급이 0 이면 심야도 기본 시급
function nightRateOf(work) {
  return work.nightRate || work.rate;
}

// unit(30분) 단위로 계산한다. 단위에 못 미치는 끝자리는 버린다.
// 휴게는 퇴근 쪽부터 뺀다 (출근부터 「근무 − 휴게」만큼만 센다).
// 각 단위는 시작 시각이 심야 시간대면 심야 시급, 아니면 기본 시급. 원 미만은 버린다.
function workResult(work) {
  const start = toMinutes(work.start);
  const worked = Math.max(0, shiftMinutes(work) - (work.break || 0));
  const blocks = Math.floor(worked / work.unit);
  let nightBlocks = 0;
  for (let i = 0; i < blocks; i += 1) {
    if (inNight((start + i * work.unit) % DAY_MINUTES, work)) {
      nightBlocks += 1;
    }
  }
  const pay = Math.floor((((blocks - nightBlocks) * work.rate + nightBlocks * nightRateOf(work)) * work.unit) / 60);
  const minutes = blocks * work.unit;
  // nightPay: 그중 심야 시간분 (명세의 내역용)
  const nightPay = Math.min(pay, Math.floor((nightBlocks * nightRateOf(work) * work.unit) / 60));
  // paidEnd: 휴게를 빼고 실제로 계산한 끝 시각
  return { minutes, night: nightBlocks * work.unit, actual: shiftMinutes(work), paidEnd: fromMinutes((start + minutes) % DAY_MINUTES), pay, nightPay };
}

function workOf(key, castId) {
  return state.data.works[key]?.[castId] || null;
}

function workPay(key, castId) {
  const work = workOf(key, castId);
  return work ? workResult(work).pay : 0;
}

// 그날 한 캐스트의 시급 + 백
function castDayTotal(key, castId) {
  return workPay(key, castId) + sumEntries(entriesOf(key, castId));
}

// 지금 설정의 그 사람 시급 (근무를 처음 넣을 때 함께 저장)
function wageSnapshot(castId) {
  const cast = castById(castId);
  const wage = state.data.wage;
  return {
    rate: cast?.rate || wage.base,
    nightRate: cast?.nightRate || wage.nightRate,
    nightStart: CONFIG.nightStart,
    nightEnd: CONFIG.nightEnd,
    unit: CONFIG.timeUnitMinutes,
  };
}

// 그날의 시급이 지금 설정과 다른지 (그날만 바꿨거나, 넣은 뒤 설정을 바꿨을 때)
function isStaleWork(work, castId) {
  const now = wageSnapshot(castId);
  return Object.keys(now).some((key) => work[key] !== now[key]);
}

function setWork(key, castId, work) {
  const works = state.data.works;
  if (work) {
    works[key] ??= {};
    works[key][castId] = work;
  } else if (works[key]?.[castId]) {
    delete works[key][castId];
    if (Object.keys(works[key]).length === 0) {
      delete works[key];
    }
  }
  saveData();
}

// 출근·퇴근·그날 시급 칸을 바꿨을 때. 시각이 둘 다 맞으면 저장, 아니면 입력한 글자를 그대로 두고 기다린다.
function changeWorkTime() {
  const field = (name) => document.querySelector(`[data-work="${name}"]`).value.trim();
  const startText = field('start');
  const endText = field('end');
  const start = parseTime(startText);
  const end = parseTime(endText);
  // 그날 시급 칸은 비우면 설정의 시급
  const base = workOf(state.date, state.castId) || wageSnapshot(state.castId);
  const rates = { rate: toAmount(field('rate')) || wageSnapshot(state.castId).rate, nightRate: toAmount(field('nightRate')), break: toAmount(field('break')) };
  state.workDraft = null;
  if (start && end) {
    setWork(state.date, state.castId, { ...base, ...rates, start, end });
  } else {
    if (startText || endText) {
      state.workDraft = { key: state.date, castId: state.castId, start: startText, end: endText, ...rates, invalid: Boolean((startText && !start) || (endText && !end)) };
    }
    setWork(state.date, state.castId, null);
  }
  renderEntry();
}

// 그날의 시급을 지금 설정 값으로 되돌린다.
function refreshWorkRate() {
  const work = workOf(state.date, state.castId);
  if (work) {
    setWork(state.date, state.castId, { ...work, ...wageSnapshot(state.castId), start: work.start, end: work.end });
    renderEntry();
  }
}

// ---------- 시각 입력 (직접 입력 + 후보 목록) ----------

// 00:00 은 마감(퇴근)으로 자주 쓰므로 23:30 다음, 목록 맨 아래에 둔다.
function timeOptions() {
  const options = [];
  for (let minute = CONFIG.timeStepMinutes; minute < DAY_MINUTES; minute += CONFIG.timeStepMinutes) {
    options.push(fromMinutes(minute));
  }
  options.push('00:00');
  return options;
}

function timeComboHtml(name, value, label, placeholder) {
  const id = `time-list-${name}`;
  return `<span class="combo">
    <input type="text" inputmode="numeric" maxlength="8" autocomplete="off" data-work="${name}" value="${escapeHtml(value)}"
      placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(label)}"
      role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}">
    <button type="button" class="combo__toggle" tabindex="-1" aria-label="${escapeHtml(TEXTS.showOptions)}">▾</button>
    <ul class="combo__list" id="${id}" role="listbox" hidden></ul>
  </span>`;
}

// showAll: 눌러서 열었을 때는 전부, 입력 중에는 친 숫자로 시작하는 것만
function openCombo(input, showAll) {
  const list = input.parentElement.querySelector('.combo__list');
  const digits = input.value.replace(/\D/g, '');
  const options = timeOptions().filter((option) => showAll || option.replace(':', '').startsWith(digits));
  const current = parseTime(input.value);
  list.innerHTML = options
    .map((option, i) => `<li id="${list.id}-${i}" role="option" aria-selected="${option === current}">${option}</li>`)
    .join('');
  list.hidden = options.length === 0;
  input.setAttribute('aria-expanded', String(!list.hidden));
  input.removeAttribute('aria-activedescendant');
  // 지금 값(없으면 자주 쓰는 시각) 근처를 보여 준다.
  const target = current || CONFIG.timeScrollTo;
  const items = [...list.children];
  const near = items.find((item) => item.textContent === target) || items.find((item) => item.textContent >= target);
  if (showAll && near) {
    list.scrollTop = near.offsetTop - list.clientHeight / 2 + near.offsetHeight / 2;
  }
}

function closeCombo(input) {
  input.parentElement.querySelector('.combo__list').hidden = true;
  input.setAttribute('aria-expanded', 'false');
  input.removeAttribute('aria-activedescendant');
}

function chooseOption(input, value) {
  input.value = value;
  closeCombo(input);
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function moveActiveOption(input, step) {
  const list = input.parentElement.querySelector('.combo__list');
  const items = [...list.children];
  if (list.hidden || items.length === 0) {
    openCombo(input, true);
    return;
  }
  const current = items.findIndex((item) => item.id === input.getAttribute('aria-activedescendant'));
  const next = items[(current + step + items.length) % items.length];
  items.forEach((item) => item.classList.toggle('is-active', item === next));
  input.setAttribute('aria-activedescendant', next.id);
  next.scrollIntoView({ block: 'nearest' });
}

// 마우스: 누르는 순간(pointerdown) 고르고, 입력칸 포커스를 유지한다.
// 터치: 손가락으로 목록을 넘길 수 있도록 탭(click)으로 고른다. ▾ 는 키보드 없이 목록만 연다.
function setupCombos() {
  const isCombo = (node) => node?.getAttribute?.('role') === 'combobox';
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  const comboInput = (node) => node.closest('.combo').querySelector('input');
  const closeAll = (except) => {
    document.querySelectorAll('.combo__list:not([hidden])').forEach((list) => {
      const input = comboInput(list);
      if (input !== except) {
        closeCombo(input);
      }
    });
  };
  const toggleList = (input) => {
    const list = input.parentElement.querySelector('.combo__list');
    if (!list.hidden) {
      closeCombo(input);
      return;
    }
    closeAll(input);
    if (!isTouch()) {
      input.focus();
    }
    openCombo(input, true);
    list.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // 터치에서는 칸을 누르면 키보드가 목록을 가리므로, 칠 때 좁힌 후보만 보여 준다.
  document.addEventListener('focusin', (event) => {
    if (isCombo(event.target) && !isTouch()) {
      openCombo(event.target, true);
    }
  });
  document.addEventListener('focusout', (event) => {
    if (isCombo(event.target)) {
      closeCombo(event.target);
    }
  });
  document.addEventListener('input', (event) => {
    if (isCombo(event.target)) {
      openCombo(event.target, false);
    }
  });
  document.addEventListener('pointerdown', (event) => {
    const option = event.target.closest('.combo__list [role="option"]');
    const toggle = event.target.closest('.combo__toggle');
    if (!option && !toggle) {
      // 목록 밖을 누르면 닫는다 (터치에서 ▾ 로 연 목록은 포커스가 없어 focusout 이 없다).
      if (!event.target.closest('.combo')) {
        closeAll(null);
      }
      return;
    }
    if (event.pointerType === 'touch') {
      return;
    }
    event.preventDefault();
    if (option) {
      chooseOption(comboInput(option), option.textContent);
    } else {
      toggleList(comboInput(toggle));
    }
  });
  // 터치 탭 뒤에 오는 mousedown 이 입력칸 포커스를 빼앗아 목록을 닫지 않게 한다.
  document.addEventListener('mousedown', (event) => {
    if (event.target.closest('.combo__list, .combo__toggle')) {
      event.preventDefault();
    }
  });
  document.addEventListener('click', (event) => {
    if (!isTouch()) {
      return;
    }
    const option = event.target.closest('.combo__list [role="option"]');
    const toggle = event.target.closest('.combo__toggle');
    if (option) {
      chooseOption(comboInput(option), option.textContent);
    } else if (toggle) {
      toggleList(comboInput(toggle));
    }
  });
  document.addEventListener('keydown', (event) => {
    if (!isCombo(event.target)) {
      return;
    }
    const input = event.target;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActiveOption(input, event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault();
      const active = input.getAttribute('aria-activedescendant');
      if (active) {
        chooseOption(input, document.getElementById(active).textContent);
      } else {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    } else if (event.key === 'Escape') {
      closeCombo(input);
    }
  });
}

// 그날 입력(백 또는 근무)이 있는 캐스트 id
function enteredIds(key) {
  return new Set([...Object.keys(state.data.days[key] || {}), ...Object.keys(state.data.works[key] || {})]);
}

function deleteCastDay(key, castId) {
  delete state.data.days[key]?.[castId];
  if (state.data.days[key] && Object.keys(state.data.days[key]).length === 0) {
    delete state.data.days[key];
  }
  delete state.data.works[key]?.[castId];
  if (state.data.works[key] && Object.keys(state.data.works[key]).length === 0) {
    delete state.data.works[key];
  }
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
  const cast = { id: newId('cast'), name, member: false, rate: 0, nightRate: 0 };
  state.data.casts.push(cast);
  return cast;
}

// 그날의 캐스트 = 기본 멤버 + 그날 추가한 사람 − 그날 뺀 사람
// 그날 입력이 있는 사람은 항상 들어간다 (명세와 목록이 어긋나지 않도록).
function dayCasts(key) {
  const roster = state.data.rosters[key] || { added: [], hidden: [] };
  const entered = enteredIds(key);
  const ids = [
    ...state.data.casts.filter((cast) => cast.member).map((cast) => cast.id),
    ...roster.added,
    ...entered,
  ];
  return [...new Set(ids)]
    .filter((id) => entered.has(id) || !roster.hidden.includes(id))
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
  const total = castDayTotal(state.date, castId);
  const hasInput = enteredIds(state.date).has(castId);
  if (hasInput && !confirm(TEXTS.confirmRemoveFromDay(castName(castId), dateLabel(state.date), TEXTS.yen(total)))) {
    return;
  }
  deleteCastDay(state.date, castId);
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
  ({ entry: renderEntry, sales: renderSales, summary: renderSummary, settings: renderSettings })[state.view]();
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
      const total = castDayTotal(key, cast.id);
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
  const back = sumEntries(entries);
  const wage = workPay(state.date, cast.id);
  node.innerHTML = `
    ${workHtml(cast)}
    <div class="entry-items">${rows.join('')}</div>
    <div class="entry-total">
      <span>${escapeHtml(TEXTS.castDayTotal(cast.name))}<small>${escapeHtml(TEXTS.castDayBreakdown(TEXTS.yen(wage), TEXTS.yen(back)))}</small></span>
      <strong>${escapeHtml(TEXTS.yen(wage + back))}</strong>
    </div>
    <div class="entry-links">
      <button type="button" class="link-button" data-action="clear-cast-day" ${enteredIds(state.date).has(cast.id) ? '' : 'disabled'}>${escapeHtml(TEXTS.clearCastDay)}</button>
      <button type="button" class="link-button" data-action="remove-from-day">${escapeHtml(TEXTS.removeFromDay)}</button>
    </div>`;
}

// 입력 화면 맨 위의 출근〜퇴근 칸과 그날의 시급
function workHtml(cast) {
  const work = workOf(state.date, cast.id);
  const draft = state.workDraft?.key === state.date && state.workDraft.castId === cast.id ? state.workDraft : null;
  const setting = wageSnapshot(cast.id);
  const shown = work || { ...setting, ...(draft && { rate: draft.rate, nightRate: draft.nightRate, break: draft.break }) };
  const result = work ? workResult(work) : null;
  const info = [TEXTS.nightRange(shown.nightStart, shown.nightEnd), TEXTS.timeUnit(shown.unit)];
  if (result) {
    const hours = result.night ? TEXTS.hoursWithNight(TEXTS.hours(result.minutes), TEXTS.hours(result.night)) : TEXTS.hours(result.minutes);
    info.unshift(...(work.break ? [hours, TEXTS.paidRange(work.start, result.paidEnd)] : [hours]));
  }
  const notes = [];
  if (!shown.rate) {
    notes.push(`<small class="work__warn">${escapeHtml(TEXTS.noRate)}</small>`);
  }
  if (shown.rate && nightRateOf(shown) < shown.rate) {
    notes.push(`<small class="work__warn">${escapeHtml(TEXTS.nightBelowBase)}</small>`);
  }
  if (draft) {
    notes.push(`<small class="work__warn">${escapeHtml(draft.invalid ? TEXTS.timeInvalid : TEXTS.workTimeOnlyOne)}</small>`);
  }
  if (work && isStaleWork(work, cast.id)) {
    notes.push(`<button type="button" class="link-button" data-action="refresh-rate">${escapeHtml(TEXTS.refreshRate)}</button>`);
  }
  const rateInput = (name, value, label) => `<label class="yen-input">
      <span>${escapeHtml(label)}</span>
      <input type="number" inputmode="numeric" min="0" step="10" data-work="${name}" value="${value || ''}" placeholder="${escapeHtml(TEXTS.castRatePlaceholder)}" aria-label="${escapeHtml(TEXTS.dayRateLabel(label))}">
      <span>円</span>
    </label>`;
  return `<div class="work${work ? ' is-active' : ''}">
    <span class="work__label">${escapeHtml(TEXTS.work)}</span>
    <span class="work__times">
      <span class="work__range">
        ${timeComboHtml('start', work?.start ?? draft?.start ?? '', TEXTS.workStart, TEXTS.workStartPlaceholder)}
        <span>${escapeHtml(TEXTS.workSep)}</span>
        ${timeComboHtml('end', work?.end ?? draft?.end ?? '', TEXTS.workEnd, TEXTS.workEndPlaceholder)}
      </span>
      <label class="work__break">
        <span>${escapeHtml(TEXTS.breakLabel)}</span>
        <input type="number" inputmode="numeric" min="0" step="${shown.unit}" data-work="break" value="${shown.break || ''}" placeholder="0" aria-label="${escapeHtml(TEXTS.breakAria)}">
        <span>${escapeHtml(TEXTS.minutesUnit)}</span>
      </label>
    </span>
    <span class="entry-row__amount">${result ? escapeHtml(TEXTS.yen(result.pay)) : ''}</span>
    <span class="work__rates">
      ${rateInput('rate', shown.rate, TEXTS.dayRate)}
      ${rateInput('nightRate', shown.nightRate, TEXTS.dayNightRate)}
    </span>
    <small class="work__info">${escapeHtml(info.join(' ・ '))}</small>
    ${notes.join('')}
  </div>`;
}

function renderDayOverview() {
  const node = document.getElementById('day-overview');
  const key = state.date;
  const entered = enteredIds(key);
  let wageTotal = 0;
  let backTotal = 0;
  const rows = state.data.casts
    .filter((cast) => entered.has(cast.id))
    .map((cast) => {
      const entries = entriesOf(key, cast.id);
      const work = workOf(key, cast.id);
      const drinks = drinkCount(entries);
      const wage = workPay(key, cast.id);
      const back = sumEntries(entries);
      wageTotal += wage;
      backTotal += back;
      const notes = [work ? TEXTS.hours(workResult(work).minutes) : '', drinks ? TEXTS.cups(drinks) : ''].filter(Boolean).join(' ・ ');
      return `<tr>
        <th scope="row">${escapeHtml(cast.name)}${notes ? `<small>${escapeHtml(notes)}</small>` : ''}</th>
        <td>${work ? escapeHtml(TEXTS.yen(wage)) : ''}</td>
        <td>${escapeHtml(TEXTS.yen(back))}</td>
        <td>${escapeHtml(TEXTS.yen(wage + back))}</td>
      </tr>`;
    });
  node.innerHTML = `<h2>${escapeHtml(TEXTS.dayOverview)}</h2>` + (rows.length === 0
    ? `<p class="empty">${escapeHtml(TEXTS.dayOverviewEmpty)}</p>`
    : `<table class="table">
        <thead><tr>
          <th scope="col">${escapeHtml(TEXTS.colCast)}</th>
          <th scope="col">${escapeHtml(TEXTS.colWage)}</th>
          <th scope="col">${escapeHtml(TEXTS.colBack)}</th>
          <th scope="col">${escapeHtml(TEXTS.colTotal)}</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot><tr>
          <th scope="row">${escapeHtml(TEXTS.dayTotal)}</th>
          <td>${escapeHtml(TEXTS.yen(wageTotal))}</td>
          <td>${escapeHtml(TEXTS.yen(backTotal))}</td>
          <td>${escapeHtml(TEXTS.yen(wageTotal + backTotal))}</td>
        </tr></tfoot>
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
  deleteCastDay(state.date, state.castId);
  state.workDraft = null;
  saveData();
  renderEntry();
}

function moveDate(key) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    state.date = key;
    render();
  }
}

// ---------- 매상 ----------

function salesOf(key) {
  return state.data.sales[key] || { guests: 0, store: 0, remote: 0 };
}

function salesTotal(day) {
  return day.store + day.remote;
}

// 객단가 = 매상 합계 ÷ 손님 수 (원 미만 버림). 손님 수가 없으면 null
function perGuest(total, guests) {
  return guests ? Math.floor(total / guests) : null;
}

function monthKey(key) {
  return key.slice(0, 7);
}

// 그달의 날짜별 매상 (날짜 순)
function monthSales(month) {
  return Object.keys(state.data.sales)
    .filter((key) => monthKey(key) === month)
    .sort()
    .map((key) => ({ key, ...state.data.sales[key] }));
}

function statHtml(label, value, note = '') {
  return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${note ? `<small>${escapeHtml(note)}</small>` : ''}</div>`;
}

function renderSales() {
  const key = state.date;
  document.getElementById('sales-date-label').textContent = dateLabel(key);
  document.getElementById('sales-date').value = key;
  document.getElementById('sales-day-title').textContent = TEXTS.salesDayTitle(dateLabel(key));
  const [year, month] = key.split('-').map(Number);
  document.getElementById('sales-month-title').textContent = TEXTS.salesMonthTitle(year, month);
  const day = salesOf(key);
  for (const field of SALES_FIELDS) {
    document.getElementById(`sales-${field}`).value = day[field] || '';
  }
  document.getElementById('sales-target').value = state.data.targets[monthKey(key)] || '';
  renderSalesStats();
}

// 계산 결과(합계·객단가·남은 금액·달성률)와 날짜별 표만 다시 그린다. 입력칸은 건드리지 않는다.
function renderSalesStats() {
  const key = state.date;
  const day = salesOf(key);
  const total = salesTotal(day);
  const unit = perGuest(total, day.guests);
  document.getElementById('sales-day-stats').innerHTML = [
    statHtml(TEXTS.salesTotal, TEXTS.yen(total)),
    statHtml(TEXTS.salesPerGuest, unit === null ? '—' : TEXTS.yen(unit), TEXTS.salesPerGuestNote),
  ].join('');

  const month = monthKey(key);
  const days = monthSales(month);
  const sum = (field) => days.reduce((acc, row) => acc + row[field], 0);
  const monthTotal = sum('store') + sum('remote');
  const guests = sum('guests');
  const target = state.data.targets[month] || 0;
  const monthUnit = perGuest(monthTotal, guests);
  const remaining = target - monthTotal;
  document.getElementById('sales-month-stats').innerHTML = [
    statHtml(TEXTS.salesMonthTotal, TEXTS.yen(monthTotal)),
    target
      ? statHtml(remaining >= 0 ? TEXTS.salesRemaining : TEXTS.salesOver, TEXTS.yen(Math.abs(remaining)))
      : statHtml(TEXTS.salesRemaining, '—', TEXTS.salesNoTarget),
    target
      ? statHtml(TEXTS.salesRate, TEXTS.percent((monthTotal / target) * 100))
      : statHtml(TEXTS.salesRate, '—', TEXTS.salesNoTarget),
    statHtml(TEXTS.salesMonthGuests, TEXTS.people(guests)),
    statHtml(TEXTS.salesMonthPerGuest, monthUnit === null ? '—' : TEXTS.yen(monthUnit)),
  ].join('');

  const rows = days.map((row) => {
    const rowTotal = salesTotal(row);
    const rowUnit = perGuest(rowTotal, row.guests);
    return `<tr${row.key === key ? ' class="is-current"' : ''}>
      <th scope="row"><button type="button" class="link-button" data-action="sales-day" data-date="${row.key}">${escapeHtml(shortDate(row.key))}</button></th>
      <td>${row.guests ? escapeHtml(TEXTS.people(row.guests)) : ''}</td>
      <td>${escapeHtml(TEXTS.yen(row.store))}</td>
      <td>${escapeHtml(TEXTS.yen(row.remote))}</td>
      <td>${escapeHtml(TEXTS.yen(rowTotal))}</td>
      <td>${rowUnit === null ? '' : escapeHtml(TEXTS.yen(rowUnit))}</td>
    </tr>`;
  });
  document.getElementById('sales-month-days').innerHTML = `<h2>${escapeHtml(TEXTS.salesDaysTitle(Number(month.slice(5))))}</h2>` + (rows.length === 0
    ? `<p class="empty">${escapeHtml(TEXTS.salesDaysEmpty)}</p>`
    : `<div class="table-scroll"><table class="table">
        <thead><tr>
          <th scope="col">${escapeHtml(TEXTS.colDate)}</th>
          <th scope="col">${escapeHtml(TEXTS.colGuests)}</th>
          <th scope="col">${escapeHtml(TEXTS.colStore)}</th>
          <th scope="col">${escapeHtml(TEXTS.colRemote)}</th>
          <th scope="col">${escapeHtml(TEXTS.colTotal)}</th>
          <th scope="col">${escapeHtml(TEXTS.colPerGuest)}</th>
        </tr></thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot><tr>
          <th scope="row">${escapeHtml(TEXTS.totalRow)}</th>
          <td>${escapeHtml(TEXTS.people(guests))}</td>
          <td>${escapeHtml(TEXTS.yen(sum('store')))}</td>
          <td>${escapeHtml(TEXTS.yen(sum('remote')))}</td>
          <td>${escapeHtml(TEXTS.yen(monthTotal))}</td>
          <td>${monthUnit === null ? '' : escapeHtml(TEXTS.yen(monthUnit))}</td>
        </tr></tfoot>
      </table></div>`);
}

// 칠 때마다 저장하고 계산 결과만 다시 그린다 (입력칸 포커스가 빠지지 않도록).
function handleSalesInput(event) {
  const input = event.target;
  if (input.id === 'sales-target') {
    const amount = toAmount(input.value);
    const month = monthKey(state.date);
    if (amount) {
      state.data.targets[month] = amount;
    } else {
      delete state.data.targets[month];
    }
  } else if (input.dataset.sales) {
    const day = { ...salesOf(state.date), [input.dataset.sales]: toAmount(input.value) };
    if (SALES_FIELDS.some((field) => day[field])) {
      state.data.sales[state.date] = day;
    } else {
      delete state.data.sales[state.date];
    }
  } else {
    return;
  }
  saveData();
  renderSalesStats();
}

// ---------- 집계・명세 ----------

// 기간 안의 한 캐스트 합계
function castReport(castId) {
  const report = { castId, back: 0, wage: 0, total: 0, minutes: 0, night: 0, nightPay: 0, breaks: 0, drinks: 0, days: [], items: new Map() };
  const keys = [...new Set([...Object.keys(state.data.days), ...Object.keys(state.data.works)])]
    .filter((key) => key >= state.from && key <= state.to)
    .sort();
  for (const key of keys) {
    const entries = state.data.days[key]?.[castId];
    const work = workOf(key, castId);
    if (!entries && !work) {
      continue;
    }
    const lines = orderedEntries(entries || {});
    const result = work ? workResult(work) : null;
    if (result) {
      report.wage += result.pay;
      report.minutes += result.minutes;
      report.night += result.night;
      report.breaks += work.break || 0;
      report.nightPay += result.nightPay;
    }
    let subtotal = result?.pay || 0;
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
    report.back += subtotal - (result?.pay || 0);
    report.days.push({ key, lines, work, result, subtotal });
  }
  report.total = report.wage + report.back;
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
        <div class="stat"><span>${escapeHtml(TEXTS.storeWage)}</span><strong>${escapeHtml(TEXTS.yen(total('wage')))}</strong></div>
        <div class="stat"><span>${escapeHtml(TEXTS.storeBack)}</span><strong>${escapeHtml(TEXTS.yen(total('back')))}</strong></div>
        <div class="stat"><span>${escapeHtml(TEXTS.storeTotal)}</span><strong>${escapeHtml(TEXTS.yen(total('total')))}</strong></div>
      </div>
      <div class="table-scroll"><table class="table">
        <thead><tr>
          <th scope="col">${escapeHtml(TEXTS.colCast)}</th>
          <th scope="col">${escapeHtml(TEXTS.colDays)}</th>
          <th scope="col">${escapeHtml(TEXTS.colHours)}</th>
          <th scope="col">${escapeHtml(TEXTS.colDrinks)}</th>
          <th scope="col">${escapeHtml(TEXTS.colWage)}</th>
          <th scope="col">${escapeHtml(TEXTS.colBack)}</th>
          <th scope="col">${escapeHtml(TEXTS.colTotal)}</th>
        </tr></thead>
        <tbody>${reports
          .map((report) => `<tr>
            <th scope="row"><button type="button" class="link-button" data-action="open-receipt" data-cast="${escapeHtml(report.castId)}" aria-label="${escapeHtml(TEXTS.openReceipt(castName(report.castId)))}">${escapeHtml(castName(report.castId))}</button></th>
            <td>${escapeHtml(TEXTS.days(report.days.length))}</td>
            <td>${report.minutes ? escapeHtml(TEXTS.hours(report.minutes)) : ''}</td>
            <td>${escapeHtml(TEXTS.cups(report.drinks))}</td>
            <td>${escapeHtml(TEXTS.yen(report.wage))}</td>
            <td>${escapeHtml(TEXTS.yen(report.back))}</td>
            <td>${escapeHtml(TEXTS.yen(report.total))}</td>
          </tr>`)
          .join('')}</tbody>
        <tfoot><tr>
          <th scope="row">${escapeHtml(TEXTS.totalRow)}</th>
          <td></td>
          <td>${escapeHtml(TEXTS.hours(total('minutes')))}</td>
          <td>${escapeHtml(TEXTS.cups(total('drinks')))}</td>
          <td>${escapeHtml(TEXTS.yen(total('wage')))}</td>
          <td>${escapeHtml(TEXTS.yen(total('back')))}</td>
          <td>${escapeHtml(TEXTS.yen(total('total')))}</td>
        </tr></tfoot>
      </table></div>`;

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
  // 근무 기록이 없는 기간은 예전처럼 백 명세만
  const hasWork = report.days.some((day) => day.work);
  const itemRows = orderedEntries(Object.fromEntries(report.items));
  return [
    { type: 'store', label: TEXTS.storeName },
    { type: 'title', label: hasWork ? TEXTS.receiptTitleWage : TEXTS.receiptTitle },
    { type: 'line', label: TEXTS.receiptPeriod, value: `${fullDate(state.from)} ${TEXTS.periodSep} ${fullDate(state.to)}` },
    { type: 'cast', label: TEXTS.receiptCast, value: castName(report.castId) },
    { type: 'hr' },
    { type: 'heading', label: TEXTS.receiptDays },
    ...report.days.flatMap((day) => [
      { type: 'date', label: shortDate(day.key) },
      ...(day.work ? [{ type: 'dayLine', label: TEXTS.receiptWorkLine(day.work.start, day.work.end, TEXTS.hours(day.result.minutes), day.work.break), value: number(day.result.pay) }] : []),
      ...day.lines.map(([itemId, entry]) => ({ type: 'dayLine', label: lineLabel(itemId, entry.n), value: number(entryAmount(entry)) })),
      { type: 'sub', label: TEXTS.receiptSubtotal, value: number(day.subtotal) },
    ]),
    ...(itemRows.length ? [
      { type: 'hr' },
      { type: 'heading', label: TEXTS.receiptItems },
      ...itemRows.map(([itemId, sum]) => ({ type: 'line', label: lineLabel(itemId, sum.n), value: number(sum.amount) })),
    ] : []),
    // 기간 전체의 근무 시간 합계 (휴게를 뺀 계산 시간)
    ...(hasWork ? [
      { type: 'hr' },
      { type: 'heading', label: TEXTS.receiptHoursTitle },
      { type: 'strong', label: TEXTS.receiptHours, value: TEXTS.hours(report.minutes) },
      ...(report.night ? [{ type: 'line', label: TEXTS.receiptNightHours, value: TEXTS.hours(report.night) }] : []),
      ...(report.breaks ? [{ type: 'line', label: TEXTS.receiptBreak, value: TEXTS.hours(report.breaks) }] : []),
      { type: 'line', label: TEXTS.receiptWorkDays, value: TEXTS.days(report.days.filter((day) => day.work).length) },
    ] : []),
    { type: 'hr' },
    { type: 'line', label: TEXTS.receiptDrinks, value: TEXTS.cups(report.drinks) },
    { type: 'line', label: TEXTS.receiptInputDays, value: TEXTS.days(report.days.length) },
    // 기간 전체의 금액 합계
    ...(hasWork ? [
      { type: 'hr' },
      { type: 'heading', label: TEXTS.receiptAmountTitle },
      { type: 'line', label: TEXTS.receiptWage, value: number(report.wage) },
      ...(report.nightPay ? [{ type: 'line', label: TEXTS.receiptNightPay, value: number(report.nightPay) }] : []),
      { type: 'line', label: TEXTS.receiptTotal, value: number(report.back) },
    ] : []),
    { type: 'total', label: hasWork ? TEXTS.receiptGrandTotal : TEXTS.receiptTotal, value: `¥${number(report.total)}` },
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
    strong: (row) => line(row, 'receipt__line--strong'),
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
    strong: { height: 25, size: 15, weight: 700 },
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
  const header = [TEXTS.colCast, TEXTS.colDays, TEXTS.csvHours, TEXTS.csvNightHours, TEXTS.csvBreakHours, TEXTS.receiptDrinks, ...items.map((item) => item.name), TEXTS.receiptWage, TEXTS.receiptTotal, TEXTS.receiptGrandTotal];
  // 품목 칸: 개수로 센 품목은 개수, 금액을 직접 넣은 품목은 금액
  // 근무 시간은 엑셀에서 계산하기 쉽도록 소수 (5時間30分 → 5.5)
  const rows = reports.map((report) => [
    castName(report.castId),
    report.days.length,
    Math.round((report.minutes / 60) * 100) / 100,
    Math.round((report.night / 60) * 100) / 100,
    Math.round((report.breaks / 60) * 100) / 100,
    report.drinks,
    ...items.map((item) => {
      const sum = report.items.get(item.id);
      return sum ? sum.n || sum.amount : 0;
    }),
    report.wage,
    report.back,
    report.total,
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

// 이름 붙은 금액 칸. 휴대폰에서는 이름 아래 줄에 나란히 놓인다.
//   auto: 직접 넣지 않았을 때(value 0) 대신 보여 줄 공통 금액. 회색(is-auto)으로 보여 준다.
function amountInput(kind, field, index, value, label, ariaLabel, placeholder, auto = 0) {
  const isAuto = !value && auto > 0;
  return `<label class="yen-input">
    <span class="yen-input__label">${escapeHtml(label)}</span>
    <input type="number" inputmode="numeric" min="0" step="10" data-kind="${kind}" data-field="${field}" data-index="${index}" value="${value || auto || ''}"
      class="${isAuto ? 'is-auto' : ''}" ${isAuto ? `title="${escapeHtml(TEXTS.castRateAuto)}"` : ''} placeholder="${escapeHtml(placeholder)}" aria-label="${escapeHtml(ariaLabel)}">
    <span>円</span>
  </label>`;
}

// 기본 멤버의 시급 칸 중 직접 넣지 않은 칸에 공통 시급을 다시 채운다. 쓰고 있는 칸은 건드리지 않는다.
function refreshAutoRates() {
  const auto = { rate: state.data.wage.base, nightRate: state.data.wage.nightRate };
  document.querySelectorAll('#cast-list [data-field="rate"], #cast-list [data-field="nightRate"]').forEach((input) => {
    const cast = state.data.casts[Number(input.dataset.index)];
    if (!cast || cast[input.dataset.field] || input === document.activeElement) {
      return;
    }
    const value = auto[input.dataset.field];
    input.value = value || '';
    input.classList.toggle('is-auto', value > 0);
    input.title = value > 0 ? TEXTS.castRateAuto : '';
  });
}

function renderSettings() {
  document.getElementById('cast-list').innerHTML = settingRows('cast', state.data.casts, (cast, index) =>
    `<input type="text" maxlength="20" data-kind="cast" data-field="name" data-index="${index}" value="${escapeHtml(cast.name)}" placeholder="${escapeHtml(TEXTS.castPlaceholder)}">
    <span class="setting-row__amounts">
      ${amountInput('cast', 'rate', index, cast.rate, TEXTS.castRate, TEXTS.castRateLabel, TEXTS.castRatePlaceholder, state.data.wage.base)}
      ${amountInput('cast', 'nightRate', index, cast.nightRate, TEXTS.castNight, TEXTS.castNightLabel, TEXTS.castRatePlaceholder, state.data.wage.nightRate)}
    </span>`);
  renderWageSettings();
  document.getElementById('item-list').innerHTML = settingRows('item', state.data.items, (item, index) =>
    `<input type="text" maxlength="30" data-kind="item" data-field="name" data-index="${index}" value="${escapeHtml(item.name)}" placeholder="${escapeHtml(TEXTS.itemPlaceholder)}">
    <span class="setting-row__amounts">
      ${amountInput('item', 'back', index, item.back, TEXTS.backShort, TEXTS.backLabel, TEXTS.backPlaceholder)}
    </span>`);
}

function handleSettingInput(event) {
  const { kind, field, index } = event.target.dataset;
  const row = (kind === 'cast' ? state.data.casts : state.data.items)[Number(index)];
  if (!row) {
    return;
  }
  row[field] = ['back', 'rate', 'nightRate'].includes(field) ? toAmount(event.target.value) : event.target.value;
  // 쓰기 시작하면 직접 넣은 시급 (회색 표시를 없앤다)
  event.target.classList.remove('is-auto');
  event.target.title = '';
  saveData();
}

function renderWageSettings() {
  document.getElementById('wage-base').value = state.data.wage.base || '';
  document.getElementById('wage-night').value = state.data.wage.nightRate || '';
}

function handleWageInput(event) {
  state.data.wage[event.target.dataset.wage] = toAmount(event.target.value);
  saveData();
  refreshAutoRates();
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

// 설정에서 이름을 정한 뒤 같은 이름의 캐스트가 생겼으면 한 사람으로 합친다.
function mergeCastsAfterRename() {
  if (mergeSameNameCasts(state.data)) {
    saveData();
    renderSettings();
  }
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
  const dayCount = new Set([...Object.keys(imported.days), ...Object.keys(imported.works), ...Object.keys(imported.sales)]).size;
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
  Object.assign(state.data.works, imported.works);
  Object.assign(state.data.sales, imported.sales);
  Object.assign(state.data.targets, imported.targets);
  if (imported.wage) {
    state.data.wage = imported.wage;
  }
  // id 가 달라도 이름이 같으면 같은 사람이다 (다른 기기에서 따로 추가한 경우 등).
  mergeSameNameCasts(state.data);
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
    'refresh-rate': refreshWorkRate,
    'remove-from-day': removeFromDay,
    'sales-day': () => moveDate(button.dataset.date),
    'day-add': () => addToDay(document.getElementById('day-add-name').value),
    'this-month': () => setPeriod(...monthRange(0)),
    'last-month': () => setPeriod(...monthRange(-1)),
    'open-receipt': () => {
      state.receiptCast = cast;
      renderSummary();
      document.getElementById('receipts').scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'add-cast': () => addRow('cast', { id: newId('cast'), name: '', member: true, rate: 0, nightRate: 0 }),
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
  setupCombos();

  // 휴대폰에서 입력하는 동안 아래 버튼 줄을 숨긴다 (style.css 의 is-typing). 키보드 위 공간이 좁기 때문.
  const isTyping = () => document.activeElement?.matches('input:not([type="date"]):not([type="file"]), select, textarea');
  document.addEventListener('focusin', () => document.body.classList.toggle('is-typing', isTyping()));
  document.addEventListener('focusout', () => setTimeout(() => document.body.classList.toggle('is-typing', isTyping())));

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
    } else if (event.target.dataset.work) {
      changeWorkTime();
    }
  });

  document.getElementById('sales-date').addEventListener('change', (event) => moveDate(event.target.value));
  document.getElementById('view-sales').addEventListener('input', handleSalesInput);

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
    } else if (event.target.dataset.wage) {
      handleWageInput(event);
    }
  });
  document.getElementById('view-settings').addEventListener('change', (event) => {
    if (event.target.dataset.kind === 'cast' && event.target.dataset.field === 'name') {
      mergeCastsAfterRename();
    }
  });
  // 비운 시급 칸은 칸을 떠날 때 공통 시급으로 다시 채운다.
  document.getElementById('view-settings').addEventListener('focusout', (event) => {
    if (event.target.dataset.kind === 'cast' && ['rate', 'nightRate'].includes(event.target.dataset.field)) {
      setTimeout(refreshAutoRates);
    }
  });
  // 자동으로 들어간 시급 칸을 누르면 전체를 골라, 치는 대로 바꿔 쓰이게 한다.
  document.getElementById('view-settings').addEventListener('focusin', (event) => {
    if (event.target.classList.contains('is-auto')) {
      event.target.select();
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
