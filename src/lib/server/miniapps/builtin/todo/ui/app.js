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
  },
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const t = STRINGS[locale];
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = theme;

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
  1: { cls: "pri-high", label: t.high, color: "#ff3b30" },
  2: { cls: "pri-normal", label: t.normal, color: "#c7c7cc" },
  3: { cls: "pri-low", label: t.low, color: "#007aff" },
};

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

// — Composer form submit —
el.composerForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const title = el.title.value.trim();
  if (!title) return;

  const payload = { title, priority: composerPriority, pinned: composerPinned };
  if (activeList) payload.listId = activeList;

  void mutate(() => api("/todos", { method: "POST", body: JSON.stringify(payload) }))
    .then(() => {
      el.title.value = "";
      composerPriority = 2; composerPinned = false;
      el.priDot.className = "opt-dot pri-normal";
      el.priLabel.textContent = t.normal;
      el.optPin.classList.remove("active");
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
el.backdrop.addEventListener("click", () => togglePicker(false));

const LIST_COLORS = ["#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#5ac8fa", "#007aff", "#5856d6", "#af52de"];
function listColor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return LIST_COLORS[Math.abs(hash) % LIST_COLORS.length];
}

function lpIconSVG(color) {
  return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" fill="${color}" opacity="0.2"/><circle cx="8" cy="8" r="6" stroke="${color}" stroke-width="1.5"/></svg>`;
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

// — SVG helpers —
const SVG_CHECK_EMPTY = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9.5" stroke="currentColor" stroke-width="1.5" opacity="0.4"/></svg>`;
const SVG_CHECK_DONE = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><circle cx="11" cy="11" r="9.5" stroke="currentColor" stroke-width="1.5" fill="currentColor" fill-opacity="0.15"/><path class="check-mark" d="M7 11.5l2.8 2.8L15 8.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SVG_STAR_FILLED = `<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5l1.8 4.2 4.5.4-3.4 3 1 4.4-3.9-2.3-3.9 2.3 1-4.4-3.4-3 4.5-.4z"/></svg>`;
const SVG_STAR_OUTLINE = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 1.5l1.8 4.2 4.5.4-3.4 3 1 4.4-3.9-2.3-3.9 2.3 1-4.4-3.4-3 4.5-.4z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>`;

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

  // Meta (only list tag, priority is shown by the badge)
  const metaParts = [];
  if (!activeList && todo.listId && todo.listId !== "inbox") {
    const listDef = lists.find((l) => l.id === todo.listId);
    metaParts.push({ label: listDef ? listDef.name : todo.listId, color: listColor(todo.listId) });
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
    moveBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 6l3-3 3 3M5 10l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
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
    });
    actions.appendChild(moveWrap);
  }

  // Delete
  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "action-btn del-btn";
  delBtn.title = t.delete;
  delBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
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

// — Close move menus on outside click —
document.addEventListener("click", (e) => {
  document.querySelectorAll(".move-menu.open").forEach((m) => {
    if (!m.parentElement.contains(e.target)) m.classList.remove("open");
  });
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll();
});

// — Start —
async function start() {
  try {
    await loadLists();
    await loadList();
    lastRevision = await currentRevision();
    setStatus(null);
  } catch (err) {
    if (!halted) setStatus(err.message, "error");
  }
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) clearInterval(pollTimer);
});

void start();