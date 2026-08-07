/**
 * Todo Mini App UI — v3.4 (bugfix release).
 *
 * Fixes:
 * - Composer always visible (no toggle, no RAF race)
 * - Search type=text (type=search had issues in sandboxed iframe)
 * - Completed section visibility: use class + display, no inline style override
 * - Mutation: sequential loadLists + loadList to avoid race
 * - No prompt()/confirm() — all inline DOM
 * - Close picker: blur the focused element so the New List input stops
 *   capturing keystrokes during the fade-out; restore the New List button
 *   after a successful create (renderPicker only rebuilds #lp-lists).
 */

const POLL_INTERVAL_MS = 2000;

const STRINGS = {
  en: {
    all: "All", inbox: "Inbox", search: "Search", newTodo: "New To-Do",
    add: "Add", open: "To-Do", completed: "Completed", noOpen: "No to-dos",
    delete: "Delete", newList: "New List", newListPlaceholder: "List name",
    create: "Create", cancel: "Cancel", confirmDelete: "Delete list?",
    confirmDeleteDesc: "Items will move to Inbox.", collapse: "Collapse",
    disabled: "This Mini App is switched off.",
    unavailable: "Todo could not start.", offline: "Reconnecting…",
    high: "High", normal: "Normal", low: "Low", star: "Star", moveTo: "Move",
    setDate: "Date", dueLabel: "Deadline", remindLabel: "Remind",
    clearDate: "Clear", schedule: "Deadline and reminder",
    today: "Today", tomorrow: "Tomorrow", yesterday: "Yesterday",
    overdue: "Overdue", noDate: "No date", insertIntoComposer: "Insert into composer",
  },
  zh: {
    all: "全部", inbox: "收件箱", search: "搜索", newTodo: "新建待办",
    add: "添加", open: "待办", completed: "已完成", noOpen: "暂无待办",
    delete: "删除", newList: "新建列表", newListPlaceholder: "列表名称",
    create: "创建", cancel: "取消", confirmDelete: "删除列表？",
    confirmDeleteDesc: "列表中的任务将移至收件箱。", collapse: "收起",
    disabled: "该应用已被禁用。",
    unavailable: "应用启动失败。", offline: "重新连接中…",
    high: "高", normal: "普通", low: "低", star: "星标", moveTo: "移动",
    setDate: "日期", dueLabel: "截止", remindLabel: "提醒",
    clearDate: "清除", schedule: "截止与提醒",
    today: "今天", tomorrow: "明天", yesterday: "昨天",
    overdue: "已逾期", noDate: "无日期", insertIntoComposer: "填入输入框",
  },
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
/**
 * Deep-link locator from `molibot://miniapp/todo/<path>`, handed over as a
 * startup hint beside locale/theme. The host never interprets it — this app
 * defines the shape, which here is `item/<id>`.
 *
 * Consumed once: after the first render lands on the item, following it again
 * on every later refresh would keep yanking the list back.
 */
let pendingDeepLink = params.get("path") ?? "";
const t = STRINGS[locale];
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = theme;

/**
 * Static copy in index.html carries the English default and a `data-i18n*`
 * key; the markup and STRINGS are the single pair to keep in sync. Without
 * this pass the shell stayed English under a zh locale while everything the
 * renderers produced was translated — which is most of what read as
 * "inconsistent" in the panel.
 */
for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = t[node.dataset.i18n] ?? node.textContent;
}
for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
  node.placeholder = t[node.dataset.i18nPlaceholder] ?? node.placeholder;
}
for (const node of document.querySelectorAll("[data-i18n-title]")) {
  node.title = t[node.dataset.i18nTitle] ?? node.title;
}

const $ = (id) => document.getElementById(id);

const el = {
  backdrop: $("backdrop"),
  listPickerBtn: $("list-picker-btn"),
  currentListName: $("current-list-name"),
  openCount: $("open-count"),
  listPicker: $("list-picker"),
  lpLists: $("lp-lists"),
  lpAllCount: $("lp-all-count"),
  lpAdd: $("lp-add"),
  search: $("search"),
  composerForm: $("composer-form"),
  title: $("title"),
  optPriority: $("opt-priority"),
  priDot: $("pri-dot"),
  priLabel: $("pri-label"),
  optPin: $("opt-pin"),
  optSchedule: $("opt-schedule"),
  scheduleLabel: $("schedule-label"),
  composerSchedule: $("composer-schedule"),
  dueDate: $("due-date"),
  dueTime: $("due-time"),
  remindAt: $("remind-at"),
  scheduleClear: $("schedule-clear"),
  collapseBtn: $("composer-collapse"),
  status: $("status"),
  openList: $("open-list"),
  openEmpty: $("open-empty"),
  doneSection: $("done-section"),
  doneList: $("done-list"),
};

let lists = [];
let activeList = "";
let lastRevision = null;
let halted = false;
let pollTimer = null;
let searchDebounce = null;
let composerPriority = 2;
let composerPinned = false;
let pickerOpen = false;

const PRIORITY_CYCLE = [2, 1, 3];
const PRIORITY_META = {
  1: { cls: "pri-high", label: t.high },
  2: { cls: "pri-normal", label: t.normal },
  3: { cls: "pri-low", label: t.low },
};

/* — Dates —
 *
 * Two shapes, mirroring the server: a deadline is either a floating calendar
 * date (`YYYY-MM-DD`) or an instant, while a reminder is always an instant.
 * The native controls speak local wall-clock time with no offset, which is
 * exactly what the server reads as local — so nothing here converts anything.
 * The one rule: never hand a bare `YYYY-MM-DD` to `new Date()`, which parses
 * it as UTC and lands on the wrong day for most of the world.
 */

const pad2 = (value) => String(value).padStart(2, "0");

/** Local `YYYY-MM-DD` for a Date — the day a person would call it. */
function localDateValue(at) {
  return `${at.getFullYear()}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}`;
}

/** Local `YYYY-MM-DDTHH:MM`, the value shape of `<input type=datetime-local>`. */
function localDateTimeValue(at) {
  return `${localDateValue(at)}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}

/** A stored deadline as a Date, without ever parsing a bare date as UTC. */
function dueToDate(row) {
  if (!row.dueAt) return null;
  if (row.dueAllDay) {
    const [y, m, d] = row.dueAt.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(row.dueAt);
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
  month: "short",
  day: "numeric",
});
const TIME_LABEL_FORMAT = new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

/** "Today" / "Tomorrow" / "Mar 4" — relative where that reads better. */
function dayLabel(at, now = new Date()) {
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()) -
      new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000
  );
  if (days === 0) return t.today;
  if (days === 1) return t.tomorrow;
  if (days === -1) return t.yesterday;
  return DAY_LABEL_FORMAT.format(at);
}

/** The chip text and tone for a row's deadline, or null when it has none. */
function dueChipMeta(row, now = Date.now()) {
  const at = dueToDate(row);
  if (!at) return null;
  const label = row.dueAllDay
    ? dayLabel(at)
    : `${dayLabel(at)} ${TIME_LABEL_FORMAT.format(at)}`;
  if (row.completed) return { label, tone: "done" };
  if (row.dueMs !== null && row.dueMs < now) return { label, tone: "overdue" };
  // "Soon" is the rest of today — the window where a deadline stops being a
  // date and starts being a thing to act on.
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  if (row.dueMs !== null && row.dueMs <= endOfToday.getTime()) return { label, tone: "soon" };
  return { label, tone: "upcoming" };
}

// — API —
async function api(path, init) {
  const response = await fetch(`./api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 403) { halted = true; setStatus(t.disabled, "error"); throw new Error("disabled"); }
  if (response.status === 503) { halted = true; setStatus(t.unavailable, "error"); throw new Error("unavailable"); }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function setStatus(message, tone) {
  if (!message) { el.status.hidden = true; el.status.textContent = ""; return; }
  el.status.hidden = false;
  el.status.textContent = message;
  el.status.dataset.tone = tone ?? "info";
}

// — Composer collapse (simple toggle) —
el.collapseBtn.addEventListener("click", () => {
  el.composerForm.classList.toggle("collapsed");
});

// — Composer schedule —

/**
 * The composer's deadline as the server wants it: a bare date when no time was
 * given (an all-day deadline), `YYYY-MM-DDTHH:MM` when one was. A time with no
 * date is not a deadline and is ignored rather than silently assumed to mean
 * today.
 */
function composerDueValue() {
  const date = el.dueDate.value;
  if (!date) return "";
  return el.dueTime.value ? `${date}T${el.dueTime.value}` : date;
}

function syncScheduleChip() {
  const due = composerDueValue();
  const remind = el.remindAt.value;
  el.optSchedule.classList.toggle("active", Boolean(due || remind));

  if (!due && !remind) {
    el.scheduleLabel.textContent = t.setDate;
    return;
  }
  // The chip shows the deadline when there is one, otherwise the reminder —
  // whichever the user actually set, never an empty "Date".
  const shown = due
    ? { at: el.dueTime.value ? new Date(due) : null, date: el.dueDate.value, timed: Boolean(el.dueTime.value) }
    : { at: new Date(remind), date: remind.slice(0, 10), timed: true };
  const [y, m, d] = shown.date.split("-").map(Number);
  const day = dayLabel(new Date(y, m - 1, d));
  el.scheduleLabel.textContent = shown.timed && shown.at
    ? `${day} ${TIME_LABEL_FORMAT.format(shown.at)}`
    : day;
}

function resetComposerSchedule() {
  el.dueDate.value = "";
  el.dueTime.value = "";
  el.remindAt.value = "";
  el.composerSchedule.hidden = true;
  syncScheduleChip();
}

el.optSchedule.addEventListener("click", () => {
  el.composerSchedule.hidden = !el.composerSchedule.hidden;
  if (!el.composerSchedule.hidden) el.dueDate.focus();
});

for (const input of [el.dueDate, el.dueTime, el.remindAt]) {
  input.addEventListener("change", syncScheduleChip);
}

el.scheduleClear.addEventListener("click", () => {
  el.dueDate.value = "";
  el.dueTime.value = "";
  el.remindAt.value = "";
  syncScheduleChip();
});

// — Composer form submit —
el.composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = el.title.value.trim();
  if (!title) return;

  const payload = { title, priority: composerPriority, pinned: composerPinned };
  if (activeList) payload.listId = activeList;
  const dueAt = composerDueValue();
  if (dueAt) payload.dueAt = dueAt;
  if (el.remindAt.value) payload.remindAt = el.remindAt.value;

  void mutate(() => api("/todos", { method: "POST", body: JSON.stringify(payload) }))
    .then(() => {
      el.title.value = "";
      composerPriority = 2; composerPinned = false;
      el.priDot.className = "opt-dot pri-normal";
      el.priLabel.textContent = t.normal;
      el.optPin.classList.remove("active");
      resetComposerSchedule();
      el.title.focus();
    });
});

el.optPriority.addEventListener("click", () => {
  const idx = PRIORITY_CYCLE.indexOf(composerPriority);
  composerPriority = PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length];
  const meta = PRIORITY_META[composerPriority];
  el.priDot.className = `opt-dot ${meta.cls}`;
  el.priLabel.textContent = meta.label;
});

el.optPin.addEventListener("click", () => {
  composerPinned = !composerPinned;
  el.optPin.classList.toggle("active", composerPinned);
});

// — List picker —
function togglePicker(force) {
  pickerOpen = force ?? !pickerOpen;
  const chevron = $("topbar-chevron");
  if (chevron) chevron.classList.toggle("rotate", pickerOpen);
  if (pickerOpen) {
    el.listPicker.hidden = false;
    el.backdrop.hidden = false;
    requestAnimationFrame(() => {
      el.listPicker.classList.add("open");
      el.backdrop.classList.add("show");
    });
  } else {
    el.listPicker.classList.remove("open");
    el.backdrop.classList.remove("show");
    // Drop keyboard focus from the picker (e.g. the New List input) right
    // away, otherwise it keeps receiving keystrokes until `hidden` is set.
    if (el.listPicker.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(() => {
      el.listPicker.hidden = true;
      el.backdrop.hidden = true;
    }, 300);
  }
}

el.listPickerBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePicker(); });
$("list-selector-trigger")?.addEventListener("click", (e) => { e.stopPropagation(); togglePicker(); });
el.backdrop.addEventListener("click", () => togglePicker(false));

/**
 * Per-list accent, from the Google label palette.
 *
 * Two sets, not one: the value is applied as a *text* colour on a surface, so
 * the light-theme tones fail contrast on the dark surfaces and vice versa.
 * The theme is fixed for the lifetime of the frame (a change reloads it), so
 * picking once here is enough.
 */
const LIST_COLORS = theme === "dark"
  ? ["#f28b82", "#fcad70", "#fdd663", "#81c995", "#78d9ec", "#8ab4f8", "#c58af9", "#d7aefb"]
  : ["#c5221f", "#e8710a", "#a8710a", "#188038", "#007b83", "#1a73e8", "#7627bb", "#9334e6"];
function listColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return LIST_COLORS[Math.abs(hash) % LIST_COLORS.length];
}

function lpIconSVG(color) {
  return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" fill="${color}" opacity="0.2"/><circle cx="10" cy="10" r="7" stroke="${color}" stroke-width="2"/></svg>`;
}

function renderPicker() {
  const totalOpen = lists.reduce((s, l) => s + l.openCount, 0);
  el.lpAllCount.textContent = totalOpen > 0 ? totalOpen : "";
  el.lpAllCount.style.visibility = totalOpen > 0 ? "" : "hidden";

  el.lpLists.replaceChildren(...lists.map((l) => {
    const item = document.createElement("button");
    item.className = "lp-item";
    item.type = "button";
    item.dataset.listId = l.id;
    if (activeList === l.id) item.classList.add("active");

    const icon = document.createElement("span");
    icon.className = "lp-icon";
    icon.innerHTML = lpIconSVG(listColor(l.id));

    const name = document.createElement("span");
    name.className = "lp-name";
    name.textContent = l.name;

    item.append(icon, name);

    if (l.openCount > 0) {
      const count = document.createElement("span");
      count.className = "lp-count";
      count.textContent = l.openCount;
      item.appendChild(count);
    }

    if (l.id !== "inbox") {
      const del = document.createElement("span");
      del.className = "lp-delete";
      del.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
      del.addEventListener("click", (e) => { e.stopPropagation(); confirmDeleteList(l.id, l.name, item); });
      item.appendChild(del);
    }

    item.addEventListener("click", () => {
      activeList = l.id;
      togglePicker(false);
      updateTopbar();
      void loadList();
    });
    return item;
  }));
}

// — New list creator —
el.lpAdd.addEventListener("click", () => {
  const wrap = document.createElement("div");
  wrap.className = "lp-new-list";
  const input = document.createElement("input");
  input.type = "text"; input.className = "lp-new-input"; input.placeholder = t.newListPlaceholder; input.maxLength = 100;
  const createBtn = document.createElement("button");
  createBtn.type = "button"; createBtn.className = "lp-new-confirm"; createBtn.textContent = t.create;
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button"; cancelBtn.className = "lp-new-cancel"; cancelBtn.textContent = t.cancel;
  wrap.append(input, createBtn, cancelBtn);
  el.lpAdd.replaceWith(wrap);
  input.focus();

  async function submit() {
    const name = input.value.trim();
    if (!name) { cancel(); return; }
    input.disabled = true; createBtn.disabled = true;
    try {
      await api("/lists", { method: "POST", body: JSON.stringify({ name }) });
      await loadLists();
      setStatus(null);
      // renderPicker() only rebuilds #lp-lists; the inline form is still in
      // the DOM. Restore the "New List" button so it can be used again.
      if (wrap.parentNode) wrap.replaceWith(el.lpAdd);
    } catch (err) {
      if (!halted) setStatus(err.message, "error");
      input.disabled = false; createBtn.disabled = false; input.focus();
    }
  }
  function cancel() {
    // Restores the "New List" button. Safe any time wrap is attached; submit()
    // also restores it after a successful create.
    if (wrap.parentNode) wrap.replaceWith(el.lpAdd);
  }
  createBtn.addEventListener("click", submit);
  cancelBtn.addEventListener("click", cancel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submit(); }
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
  });
});

// — Delete list —
function confirmDeleteList(id, name, itemEl) {
  const wrap = document.createElement("div");
  wrap.className = "lp-confirm-delete";
  wrap.innerHTML = `
    <div class="lp-confirm-msg">${t.confirmDelete}</div>
    <div class="lp-confirm-desc">${t.confirmDeleteDesc}</div>
    <div class="lp-confirm-btns">
      <button type="button" class="lp-confirm-no">${t.cancel}</button>
      <button type="button" class="lp-confirm-yes">${t.delete}</button>
    </div>`;
  itemEl.replaceWith(wrap);
  const yes = wrap.querySelector(".lp-confirm-yes");
  const no = wrap.querySelector(".lp-confirm-no");

  async function doDelete() {
    yes.disabled = true; no.disabled = true;
    try {
      await api(`/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (activeList === id) activeList = "";
      await loadLists();
      updateTopbar();
      await loadList();
      setStatus(null);
    } catch (err) { if (!halted) setStatus(err.message, "error"); await loadLists(); }
  }
  yes.addEventListener("click", doDelete);
  no.addEventListener("click", () => loadLists());
}

function insertIntoComposer(text) {
  window.parent.postMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: String(text), mode: "append" }
  }, "*");
}

// — SVG helpers —
// Material Symbols geometry at the M3 icon sizes: 24dp for the primary
// control, 18dp inside the dense hover action row.
const SVG_CHECK_EMPTY = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/></svg>`;
const SVG_CHECK_DONE = `<svg width="24" height="24" viewBox="0 0 24 24"><path class="check-mark" fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`;
const SVG_STAR_FILLED = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>`;
const SVG_STAR_OUTLINE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/></svg>`;
const SVG_CALENDAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 18H5V9h14v12z"/></svg>`;
const SVG_BELL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;
const SVG_SCHEDULE = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3h-1V1h-2v2H8V1H6v2H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 18H5V9h14v12z"/></svg>`;
const SVG_COMPOSER = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`;

/**
 * A small leading-icon chip. Built as nodes rather than one innerHTML string:
 * the icon is static markup but the label is user text, and the two must not
 * share a parsing path.
 */
function iconChip(className, iconSvg, label) {
  const chip = document.createElement("span");
  chip.className = className;
  const icon = document.createElement("span");
  icon.className = "chip-icon";
  icon.innerHTML = iconSvg;
  const text = document.createElement("span");
  text.textContent = label;
  chip.append(icon, text);
  return chip;
}

// — Render item —
function renderItem(todo, index) {
  const li = document.createElement("li");
  li.className = "todo-item";
  li.dataset.id = todo.id;
  if (todo.completed) li.classList.add("completed");
  if (todo.pinned) li.classList.add("starred");

  // Star indicator (always visible left edge)
  if (todo.pinned) {
    const starInd = document.createElement("span");
    starInd.className = "star-indicator";
    starInd.innerHTML = SVG_STAR_FILLED;
    li.appendChild(starInd);
  }

  // Check circle
  const check = document.createElement("button");
  check.type = "button";
  check.className = "check-circle";
  check.setAttribute("aria-label", todo.completed ? "Reopen" : "Complete");
  check.innerHTML = todo.completed ? SVG_CHECK_DONE : SVG_CHECK_EMPTY;
  check.addEventListener("click", () => {
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH", body: JSON.stringify({ completed: !todo.completed }),
    }));
  });
  li.appendChild(check);

  // Priority badge — always visible, click to cycle
  const priBadge = document.createElement("button");
  priBadge.type = "button";
  priBadge.className = `item-pri-badge ${PRIORITY_META[todo.priority].cls}`;
  priBadge.title = PRIORITY_META[todo.priority].label;
  priBadge.innerHTML = `<span class="pri-ring"></span>`;
  priBadge.addEventListener("click", () => {
    const next = todo.priority === 1 ? 2 : todo.priority === 2 ? 3 : 1;
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH", body: JSON.stringify({ priority: next }),
    }));
  });
  li.appendChild(priBadge);

  // Text
  const textWrap = document.createElement("div");
  textWrap.className = "item-text";
  const titleSpan = document.createElement("span");
  titleSpan.className = "item-title";
  titleSpan.textContent = todo.title;
  textWrap.appendChild(titleSpan);

  // Meta (list tag, deadline, reminder; priority is shown by the badge)
  const metaParts = [];
  if (!activeList && todo.listId && todo.listId !== "inbox") {
    const listDef = lists.find((l) => l.id === todo.listId);
    metaParts.push({ label: listDef ? listDef.name : todo.listId, color: listColor(todo.listId) });
  }

  const dueChip = dueChipMeta(todo);
  if (dueChip || todo.remindAt) {
    const meta = document.createElement("div");
    meta.className = "item-meta";

    if (dueChip) {
      // The tone is reinforced by an icon and, when late, by the word itself —
      // an overdue item must not be distinguishable by colour alone.
      const text = dueChip.tone === "overdue" ? `${dueChip.label} · ${t.overdue}` : dueChip.label;
      const chip = iconChip("due-chip", SVG_CALENDAR, text);
      chip.dataset.tone = dueChip.tone;
      chip.title = `${t.dueLabel}: ${text}`;
      meta.appendChild(chip);
    }

    if (todo.remindAt) {
      const at = new Date(todo.remindAt);
      const text = `${dayLabel(at)} ${TIME_LABEL_FORMAT.format(at)}`;
      const bell = iconChip("remind-chip", SVG_BELL, text);
      bell.title = `${t.remindLabel}: ${text}`;
      if (!todo.completed && todo.remindMs !== null && todo.remindMs <= Date.now()) {
        bell.dataset.tone = "due";
      }
      meta.appendChild(bell);
    }

    textWrap.appendChild(meta);
  }

  if (metaParts.length > 0) {
    const meta = document.createElement("div");
    meta.className = "item-meta";
    for (const p of metaParts) {
      const tag = document.createElement("span");
      tag.className = "meta-tag";
      if (p.dot) {
        tag.innerHTML = `<span class="meta-dot ${p.dot}"></span>${p.label}`;
      } else {
        tag.textContent = p.label;
        if (p.color) tag.style.color = p.color;
      }
      meta.appendChild(tag);
    }
    textWrap.appendChild(meta);
  }
  li.appendChild(textWrap);

  // Actions
  const actions = document.createElement("div");
  actions.className = "item-actions";

  // Schedule (deadline + reminder). Same anchored-menu shape as Move, so it
  // inherits the flip-up behaviour near the bottom of the scroll container.
  const schedWrap = document.createElement("div");
  schedWrap.className = "move-wrap";
  const schedBtn = document.createElement("button");
  schedBtn.type = "button";
  schedBtn.className = "action-btn sched-btn";
  schedBtn.title = t.schedule;
  schedBtn.innerHTML = SVG_SCHEDULE;
  if (todo.dueAt || todo.remindAt) schedBtn.classList.add("active");

  const schedMenu = document.createElement("div");
  schedMenu.className = "move-menu schedule-menu";

  const dueDate = document.createElement("input");
  dueDate.type = "date";
  dueDate.className = "sched-input";
  const dueTime = document.createElement("input");
  dueTime.type = "time";
  dueTime.className = "sched-input sched-input-time";
  if (todo.dueAt) {
    const at = dueToDate(todo);
    dueDate.value = localDateValue(at);
    if (!todo.dueAllDay) dueTime.value = localDateTimeValue(at).slice(11);
  }

  const remindInput = document.createElement("input");
  remindInput.type = "datetime-local";
  remindInput.className = "sched-input";
  if (todo.remindAt) remindInput.value = localDateTimeValue(new Date(todo.remindAt));

  const dueRow = document.createElement("div");
  dueRow.className = "sched-row";
  const dueLabelEl = document.createElement("span");
  dueLabelEl.className = "sched-label";
  dueLabelEl.textContent = t.dueLabel;
  dueRow.append(dueLabelEl, dueDate, dueTime);

  const remindRow = document.createElement("div");
  remindRow.className = "sched-row";
  const remindLabelEl = document.createElement("span");
  remindLabelEl.className = "sched-label";
  remindLabelEl.textContent = t.remindLabel;
  remindRow.append(remindLabelEl, remindInput);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "sched-clear";
  clearBtn.textContent = t.clearDate;

  const schedActions = document.createElement("div");
  schedActions.className = "sched-actions";
  schedActions.append(clearBtn);
  schedMenu.append(dueRow, remindRow, schedActions);

  /**
   * Sends both fields on every commit. `""` clears, and sending both together
   * means the row can never end up with a deadline the menu no longer shows.
   */
  const commitSchedule = (due, remind) => {
    schedMenu.classList.remove("open");
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ dueAt: due, remindAt: remind }),
    }));
  };

  for (const input of [dueDate, dueTime, remindInput]) {
    // A picker click lands inside the menu; without this the document-level
    // outside-click handler would close it mid-interaction.
    input.addEventListener("click", (event) => event.stopPropagation());
    input.addEventListener("change", () => {
      const due = dueDate.value ? (dueTime.value ? `${dueDate.value}T${dueTime.value}` : dueDate.value) : "";
      commitSchedule(due, remindInput.value);
    });
  }

  clearBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    commitSchedule("", "");
  });

  schedMenu.addEventListener("click", (event) => event.stopPropagation());

  schedWrap.append(schedBtn, schedMenu);
  schedBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !schedMenu.classList.contains("open");
    schedMenu.classList.toggle("open", willOpen);
    if (willOpen) {
      const rect = schedBtn.getBoundingClientRect();
      schedMenu.classList.toggle("up", window.innerHeight - rect.bottom < schedMenu.offsetHeight + 8);
    }
    li.classList.toggle("menu-open", willOpen);
  });
  actions.appendChild(schedWrap);

  // Insert into composer (fill into chat draft)
  const composerBtn = document.createElement("button");
  composerBtn.type = "button";
  composerBtn.className = "action-btn composer-btn";
  composerBtn.title = t.insertIntoComposer;
  composerBtn.innerHTML = SVG_COMPOSER;
  composerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    insertIntoComposer(todo.title);
  });
  actions.appendChild(composerBtn);

  // Star toggle
  const starBtn = document.createElement("button");
  starBtn.type = "button";
  starBtn.className = "action-btn star-btn";
  starBtn.title = t.star;
  starBtn.innerHTML = todo.pinned ? SVG_STAR_FILLED : SVG_STAR_OUTLINE;
  starBtn.addEventListener("click", () => {
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH", body: JSON.stringify({ pinned: !todo.pinned }),
    }));
  });
  actions.appendChild(starBtn);

  // Move
  if (lists.length > 1) {
    const moveWrap = document.createElement("div");
    moveWrap.className = "move-wrap";
    const moveBtn = document.createElement("button");
    moveBtn.type = "button";
    moveBtn.className = "action-btn move-btn";
    moveBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5.83L15.17 9l1.41-1.41L12 3 7.41 7.59 8.83 9 12 5.83zm0 12.34L8.83 15l-1.41 1.41L12 21l4.59-4.59L15.17 15 12 18.17z"/></svg>`;
    moveBtn.title = t.moveTo;
    const moveMenu = document.createElement("div");
    moveMenu.className = "move-menu";
    for (const l of lists) {
      if (l.id === todo.listId) continue;
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "move-option";
      opt.textContent = l.name;
      opt.addEventListener("click", () => {
        void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
          method: "PATCH", body: JSON.stringify({ listId: l.id }),
        }));
        moveMenu.classList.remove("open");
      });
      moveMenu.appendChild(opt);
    }
    moveWrap.append(moveBtn, moveMenu);
    moveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = !moveMenu.classList.contains("open");
      moveMenu.classList.toggle("open", willOpen);
      if (willOpen) {
        // If there's no room below the button (last item near the content's
        // bottom edge), flip the menu up so .content doesn't clip it.
        const rect = moveBtn.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        moveMenu.classList.toggle("up", spaceBelow < moveMenu.offsetHeight + 8);
      }
      li.classList.toggle("menu-open", willOpen);
    });
    actions.appendChild(moveWrap);
  }

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "action-btn del-btn";
  delBtn.title = t.delete;
  delBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
  delBtn.addEventListener("click", () => {
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, { method: "DELETE" }));
  });
  actions.appendChild(delBtn);

  li.appendChild(actions);
  return li;
}

// — Data loading —
async function loadLists() {
  try {
    const data = await api("/lists");
    lists = data.lists;
    renderPicker();
    updateTopbar();
  } catch { /* non-fatal */ }
}

function updateTopbar() {
  if (!activeList) {
    el.currentListName.textContent = t.all;
  } else {
    const l = lists.find((x) => x.id === activeList);
    el.currentListName.textContent = l ? l.name : activeList;
  }
}

/**
 * Scrolls to and briefly highlights the item a deep link named.
 *
 * Silently does nothing when the item is not in the current view (a filter is
 * on, or it was deleted): a link into a Mini App is a convenience, and failing
 * loudly over a stale id would be worse than simply opening the app.
 */
function followDeepLink() {
  if (!pendingDeepLink) return;
  const [kind, rawId] = pendingDeepLink.split("/");
  // Cleared even when nothing matches, so a stale id is not retried forever.
  pendingDeepLink = "";
  if (kind !== "item" || !rawId) return;
  const target = document.querySelector(`.todo-item[data-id="${CSS.escape(rawId)}"]`);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("deep-link-target");
  setTimeout(() => target.classList.remove("deep-link-target"), 2000);
}

async function loadList() {
  const sp = new URLSearchParams();
  sp.set("status", "all");
  if (activeList) sp.set("listId", activeList);
  const search = el.search.value.trim();
  if (search) sp.set("search", search);

  try {
    const { todos } = await api(`/todos?${sp}`);
    const open = todos.filter((x) => !x.completed);
    const done = todos.filter((x) => x.completed);

    el.openList.replaceChildren(...open.map((t, i) => renderItem(t, i)));
    el.doneList.replaceChildren(...done.map((t, i) => renderItem(t, i)));

    // Show/hide empty state
    el.openEmpty.hidden = open.length > 0;

    // Show/hide done section via class
    el.doneSection.classList.toggle("visible", done.length > 0);

    // Count
    el.openCount.textContent = open.length > 0 ? open.length : "";
    el.openCount.style.visibility = open.length > 0 ? "" : "hidden";

    followDeepLink();

    setStatus(null);
  } catch (err) {
    if (!halted) setStatus(err.message, "error");
  }
}

async function mutate(run) {
  if (halted) return;
  try {
    await run();
    setStatus(null);
    // Sequential: lists first, then todos — no race on the server
    await loadLists();
    await loadList();
    lastRevision = await currentRevision();
  } catch (err) {
    if (!halted) setStatus(err.message, "error");
  }
}

async function currentRevision() {
  const state = await api("/_host/state");
  return state.revision;
}

async function poll() {
  if (halted || document.hidden) return;
  try {
    const rev = await currentRevision();
    if (rev !== lastRevision) {
      lastRevision = rev;
      await loadLists();
      await loadList();
    }
    setStatus(null);
  } catch {
    if (!halted) setStatus(t.offline, "error");
  }
}

// — Search events —
el.search.addEventListener("input", () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => void loadList(), 250);
});

// — Close anchored menus on outside click —
document.addEventListener("click", (e) => {
  document.querySelectorAll(".move-menu.open").forEach((m) => {
    if (m.parentElement.contains(e.target)) return;
    m.classList.remove("open");
    // The action row is only visible on hover, so an item whose menu is open
    // has to be pinned visible or the menu vanishes the moment the pointer
    // leaves the row on its way to it.
    m.closest(".todo-item")?.classList.remove("menu-open");
  });
});

/**
 * Reports that the reminders currently on screen have been seen.
 *
 * This is the only thing that clears the app's sidebar badge — the server
 * never infers it from a poll, because being *able* to see the list is what
 * "acknowledged" means. Failure is silent on purpose: an unacknowledged badge
 * is a stale count, not something worth a red banner over the user's list.
 */
function acknowledgeReminders() {
  void api("/reminders", { method: "POST" }).catch(() => {});
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  void poll();
  acknowledgeReminders();
});

window.addEventListener("focus", acknowledgeReminders);

// — Start —
async function start() {
  try {
    await loadLists();
    await loadList();
    lastRevision = await currentRevision();
    setStatus(null);
    acknowledgeReminders();
  } catch (err) {
    if (!halted) setStatus(err.message, "error");
  }
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) clearInterval(pollTimer);
});

void start();