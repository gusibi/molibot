/**
 * Starter Mini App UI.
 *
 * Talks only to its own API, mounted by the host at `./api/*` relative to this
 * document. It never reaches for Molibot internals, the parent DOM or Tauri IPC
 * — the sandboxed iframe would refuse anyway, and an app that needed them would
 * not be portable.
 *
 * Freshness is a revision poll: `/api/_host/state` returns a counter the host
 * bumps whenever *either* entrance mutates data, so an agent writing a record
 * in chat refreshes this list within one interval without a socket.
 *
 * WHERE TO EDIT: STRINGS (your copy), renderItem() (your row), loadList() and
 * the `api()` calls (your endpoints). The polling, the error states and the
 * theme/locale wiring below are already correct — leave them alone.
 */

const POLL_INTERVAL_MS = 2000;

const STRINGS = {
  en: {
    heading: "Starter",
    placeholder: "Add a record",
    add: "Add",
    open: "Open",
    done: "Done",
    noOpen: "Nothing open.",
    noDone: "Nothing done yet.",
    delete: "Delete",
    toggleOpen: "Mark as done",
    toggleDone: "Reopen",
    disabled: "This Mini App is switched off. Turn it back on in Settings › Plugins.",
    unavailable: "The app could not start. Check Settings › Plugins for the error.",
    offline: "Molibot is not reachable. The list will refresh once it is back."
  },
  zh: {
    heading: "Starter",
    placeholder: "添加一条记录",
    add: "添加",
    open: "进行中",
    done: "已完成",
    noOpen: "暂无记录。",
    noDone: "还没有完成的记录。",
    delete: "删除",
    toggleOpen: "标记完成",
    toggleDone: "重新打开",
    disabled: "该 Mini App 已被禁用，可在「设置 › 插件」中重新开启。",
    unavailable: "应用启动失败，请在「设置 › 插件」中查看错误。",
    offline: "无法连接 Molibot，恢复后会自动刷新。"
  }
};

// Locale and theme arrive as non-sensitive URL hints; a change reloads the
// iframe, so reading them once at startup is enough.
const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
const t = STRINGS[locale];

document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = theme;

const elements = {
  composer: document.getElementById("composer"),
  title: document.getElementById("title"),
  submit: document.querySelector(".starter-submit"),
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

function renderGroup(group, list, records) {
  group.dataset.empty = records.length === 0 ? "true" : "false";
  list.replaceChildren(...records.map(renderItem));
}

function renderItem(record) {
  const item = document.createElement("li");
  item.className = "starter-item";
  item.dataset.done = String(record.done);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "starter-toggle";
  toggle.checked = record.done;
  toggle.setAttribute("aria-label", record.done ? t.toggleDone : t.toggleOpen);
  toggle.addEventListener("change", () => {
    void mutate(() => api(`/records/${encodeURIComponent(record.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done: toggle.checked })
    }));
  });

  const body = document.createElement("div");
  body.className = "starter-body";

  const title = document.createElement("span");
  title.className = "starter-title";
  title.textContent = record.title;
  body.append(title);

  if (record.note) {
    const note = document.createElement("span");
    note.className = "starter-note";
    note.textContent = record.note;
    body.append(note);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "starter-delete";
  remove.textContent = "×";
  remove.title = t.delete;
  remove.setAttribute("aria-label", `${t.delete}: ${record.title}`);
  remove.addEventListener("click", () => {
    void mutate(() => api(`/records/${encodeURIComponent(record.id)}`, { method: "DELETE" }));
  });

  item.append(toggle, body, remove);
  return item;
}

async function loadList() {
  const { records } = await api("/records?status=all");
  renderGroup(elements.openGroup, elements.openList, records.filter((record) => !record.done));
  renderGroup(elements.doneGroup, elements.doneList, records.filter((record) => record.done));
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
  elements.submit.disabled = true;
  void mutate(() => api("/records", { method: "POST", body: JSON.stringify({ title }) }))
    .then(() => {
      elements.title.value = "";
    })
    .finally(() => {
      elements.submit.disabled = false;
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
