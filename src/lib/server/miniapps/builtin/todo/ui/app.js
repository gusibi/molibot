/**
 * Todo Mini App UI.
 *
 * Talks only to its own API, mounted by the host at `./api/*` relative to this
 * document. It never reaches for Molibot internals, the parent DOM or Tauri IPC
 * — the sandboxed iframe would refuse anyway, and an app that needed them would
 * not be portable.
 *
 * Freshness is a revision poll: `/api/_host/state` returns a counter the host
 * bumps whenever *either* entrance mutates data, so an agent adding a todo in
 * chat refreshes this list within one interval without a socket.
 */

const POLL_INTERVAL_MS = 2000;

const STRINGS = {
  en: {
    heading: "Todo",
    placeholder: "What needs doing?",
    add: "Add",
    open: "Open",
    completed: "Completed",
    noOpen: "Nothing open.",
    noCompleted: "Nothing completed yet.",
    delete: "Delete",
    toggleOpen: "Mark as done",
    toggleDone: "Reopen",
    disabled: "This Mini App is switched off. Turn it back on in Settings › Plugins.",
    unavailable: "The Todo app could not start. Check Settings › Plugins for the error.",
    offline: "Molibot is not reachable. The list will refresh once it is back."
  },
  zh: {
    heading: "待办",
    placeholder: "要做点什么？",
    add: "添加",
    open: "进行中",
    completed: "已完成",
    noOpen: "暂无待办。",
    noCompleted: "还没有完成的事项。",
    delete: "删除",
    toggleOpen: "标记完成",
    toggleDone: "重新打开",
    disabled: "该 Mini App 已被禁用，可在「设置 › 插件」中重新开启。",
    unavailable: "Todo 应用启动失败，请在「设置 › 插件」中查看错误。",
    offline: "无法连接 Molibot，恢复后会自动刷新。"
  }
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const t = STRINGS[locale];

document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = theme;

const elements = {
  composer: document.getElementById("composer"),
  title: document.getElementById("title"),
  add: document.querySelector(".todo-add"),
  status: document.getElementById("status"),
  openGroup: document.getElementById("open-group"),
  openList: document.getElementById("open-list"),
  doneGroup: document.getElementById("done-group"),
  doneList: document.getElementById("done-list")
};

for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = t[node.dataset.i18n] ?? node.textContent;
}
for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
  node.placeholder = t[node.dataset.i18nPlaceholder] ?? node.placeholder;
}

let lastRevision = null;
/** Set once the app is disabled or failed to load: stop retrying forever. */
let halted = false;
let pollTimer = null;

function setStatus(message, tone) {
  if (!message) {
    elements.status.hidden = true;
    elements.status.textContent = "";
    return;
  }
  elements.status.hidden = false;
  elements.status.textContent = message;
  elements.status.dataset.tone = tone ?? "info";
}

async function api(path, init) {
  const response = await fetch(`./api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  if (response.status === 403) {
    halted = true;
    setStatus(t.disabled, "error");
    throw new Error("disabled");
  }
  if (response.status === 503) {
    halted = true;
    setStatus(t.unavailable, "error");
    throw new Error("unavailable");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

function renderGroup(group, list, rows) {
  group.dataset.empty = rows.length === 0 ? "true" : "false";
  list.replaceChildren(...rows.map(renderItem));
}

function renderItem(todo) {
  const item = document.createElement("li");
  item.className = "todo-item";
  item.dataset.completed = String(todo.completed);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "todo-toggle";
  toggle.checked = todo.completed;
  toggle.setAttribute("aria-label", todo.completed ? t.toggleDone : t.toggleOpen);
  toggle.addEventListener("change", () => {
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ completed: toggle.checked })
    }));
  });

  const title = document.createElement("span");
  title.className = "todo-title";
  title.textContent = todo.title;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "todo-delete";
  remove.textContent = "×";
  remove.title = t.delete;
  remove.setAttribute("aria-label", `${t.delete}: ${todo.title}`);
  remove.addEventListener("click", () => {
    void mutate(() => api(`/todos/${encodeURIComponent(todo.id)}`, { method: "DELETE" }));
  });

  item.append(toggle, title, remove);
  return item;
}

async function loadList() {
  const { todos } = await api("/todos?status=all");
  renderGroup(elements.openGroup, elements.openList, todos.filter((todo) => !todo.completed));
  renderGroup(elements.doneGroup, elements.doneList, todos.filter((todo) => todo.completed));
}

/** Runs a write, then refreshes — a local mutation must not wait for the poll. */
async function mutate(run) {
  if (halted) return;
  try {
    await run();
    setStatus(null);
    await loadList();
    lastRevision = await currentRevision();
  } catch (error) {
    if (!halted) setStatus(error.message, "error");
  }
}

async function currentRevision() {
  const state = await api("/_host/state");
  return state.revision;
}

async function poll() {
  if (halted || document.hidden) return;
  try {
    const revision = await currentRevision();
    if (revision !== lastRevision) {
      lastRevision = revision;
      await loadList();
    }
    setStatus(null);
  } catch (error) {
    // A transient connection failure is expected while the service restarts;
    // say so once and keep polling rather than clearing the visible list.
    if (!halted) setStatus(t.offline, "error");
  }
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = elements.title.value.trim();
  if (!title) return;
  elements.add.disabled = true;
  void mutate(() => api("/todos", { method: "POST", body: JSON.stringify({ title }) }))
    .then(() => {
      elements.title.value = "";
    })
    .finally(() => {
      elements.add.disabled = false;
      elements.title.focus();
    });
});

// Polling pauses while the panel is hidden and catches up the moment it returns,
// so a background panel costs nothing.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) void poll();
});

async function start() {
  try {
    // The first load always reads the list, regardless of revision: a panel
    // opened after the fact has no baseline to compare against.
    await loadList();
    lastRevision = await currentRevision();
    setStatus(null);
  } catch (error) {
    if (!halted) setStatus(error.message, "error");
  }
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

window.addEventListener("pagehide", () => {
  if (pollTimer) clearInterval(pollTimer);
});

void start();
