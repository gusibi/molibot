const STRINGS = {
  en: {
    heading: "Note",
    searchPlaceholder: "Search",
    titlePlaceholder: "Title",
    contentPlaceholder: "Take a note...",
    labelsPlaceholder: "Add labels...",
    add: "Save",
    close: "Close",
    cancel: "Cancel",
    saveEdit: "Save changes",
    takeNote: "Take a note...",
    tabActive: "Notes",
    tabArchived: "Archive",
    pinnedSection: "Pinned",
    notesSection: "Others",
    archivedSection: "Archive",
    noNotes: "No notes found",
    disabled: "This Mini App is switched off.",
    unavailable: "The app could not start.",
    offline: "Molibot is not reachable."
  },
  zh: {
    heading: "Note",
    searchPlaceholder: "搜索",
    titlePlaceholder: "标题",
    contentPlaceholder: "添加笔记...",
    labelsPlaceholder: "添加标签...",
    add: "保存",
    close: "关闭",
    cancel: "取消",
    saveEdit: "保存修改",
    takeNote: "添加笔记...",
    tabActive: "笔记",
    tabArchived: "归档",
    pinnedSection: "置顶",
    notesSection: "其他",
    archivedSection: "归档",
    noNotes: "暂无笔记",
    disabled: "该 Mini App 已被禁用。",
    unavailable: "应用启动失败。",
    offline: "无法连接 Molibot。"
  }
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const theme = params.get("theme") === "dark" ? "dark" : "light";
/**
 * Deep-link locator from `molibot://miniapp/note/<path>`, delivered as a
 * startup hint beside locale/theme. This app defines its shape (`note/<id>`);
 * the host only passes it through.
 *
 * Consumed once: re-following it on every refresh would keep yanking the list.
 */
let pendingDeepLink = params.get("path") ?? "";
const t = STRINGS[locale];

/**
 * Host bridge. Fills the chat composer with a note's text; it can never send.
 *
 * `targetOrigin: "*"` is correct here — the iframe cannot know the host
 * WebView's origin, nothing in the message is secret, and the real check is the
 * host comparing `event.source` against this iframe. An older host simply
 * ignores the message, so nothing here may depend on it working.
 */
function insertIntoComposer(text) {
  window.parent.postMessage({
    protocol: "molibot-miniapp",
    version: 1,
    action: "composer.insert",
    payload: { text: String(text), mode: "append" }
  }, "*");
}

document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = theme;

// 统一的 Material SVG 图标集
const SVG_ICONS = {
  pin: `<svg class="action-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  more: `<svg class="action-icon" viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg>`,
  composer: `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>`,
  archive: `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.21 3 17.5 3h-11c-.71 0-1.38.21-1.65.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM12 18l-4.5-4.5h3V11h3v2.5h3L12 18z"/></svg>`,
  unarchive: `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.21 3 17.5 3h-11c-.71 0-1.38.21-1.65.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM6.24 5h11.52l.83 1H5.41l.83-1zM12 11l4.5 4.5h-3V18h-3v-2.5h-3L12 11z"/></svg>`,
  delete: `<svg class="action-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`
};

const elements = {
  composerCollapsed: document.getElementById("composer-collapsed"),
  composer: document.getElementById("composer"),
  composerCloseBtn: document.getElementById("composer-close-btn"),
  composerPinBtn: document.getElementById("composer-pin-btn"),
  title: document.getElementById("title"),
  content: document.getElementById("content"),
  colorSelect: document.getElementById("color-select"),
  labelsInput: document.getElementById("labels-input"),
  pinCheckbox: document.getElementById("pin-checkbox"),
  submit: document.querySelector(".note-submit"),
  searchInput: document.getElementById("search-input"),
  tabSelectorTrigger: document.getElementById("tab-selector-trigger"),
  tabPicker: document.getElementById("tab-picker"),
  currentTabName: document.getElementById("current-tab-name"),
  noteChevron: document.getElementById("note-chevron"),
  backdrop: document.getElementById("backdrop"),
  tabItems: document.querySelectorAll(".tp-item"),
  status: document.getElementById("status"),
  pinnedGroup: document.getElementById("pinned-group"),
  pinnedList: document.getElementById("pinned-list"),
  otherGroupTitle: document.getElementById("other-group-title"),
  otherList: document.getElementById("other-list"),
  emptyMsg: document.getElementById("empty-msg"),
  colorDots: document.querySelectorAll(".color-dot"),
  
  // 编辑弹窗元素
  editModal: document.getElementById("edit-modal"),
  modalCard: document.getElementById("modal-card"),
  editTitle: document.getElementById("edit-title"),
  editContent: document.getElementById("edit-content"),
  editLabels: document.getElementById("edit-labels"),
  modalPinBtn: document.getElementById("modal-pin-btn"),
  modalCancelBtn: document.getElementById("modal-cancel-btn"),
  modalSaveBtn: document.getElementById("modal-save-btn"),
  modalColorDots: document.querySelectorAll(".modal-color-dot")
};

for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = t[node.dataset.i18n] ?? node.textContent;
}
for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
  node.placeholder = t[node.dataset.i18nPlaceholder] ?? node.placeholder;
}

let halted = false;
let currentTab = "active";
let editingNoteId = null;
let editingIsPinned = false;
let editingColor = "default";
let openDropdown = null;

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

function expandComposer() {
  elements.composerCollapsed.classList.add("hidden");
  elements.composer.classList.remove("hidden");
  elements.content.focus();
}

function collapseComposer() {
  elements.title.value = "";
  elements.content.value = "";
  elements.labelsInput.value = "";
  elements.colorSelect.value = "default";
  elements.pinCheckbox.checked = false;
  elements.composerPinBtn.classList.remove("active");
  elements.composer.dataset.color = "default";
  
  elements.colorDots.forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.color === "default");
  });

  elements.composer.classList.add("hidden");
  elements.composerCollapsed.classList.remove("hidden");
}

elements.composerCollapsed.addEventListener("click", expandComposer);
elements.composerCloseBtn.addEventListener("click", collapseComposer);

elements.composerPinBtn.addEventListener("click", () => {
  elements.pinCheckbox.checked = !elements.pinCheckbox.checked;
  elements.composerPinBtn.classList.toggle("active", elements.pinCheckbox.checked);
});

elements.colorDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    const color = dot.dataset.color;
    elements.colorSelect.value = color;
    elements.composer.dataset.color = color;
    elements.colorDots.forEach((d) => d.classList.remove("active"));
    dot.classList.add("active");
  });
});

// 全局关闭下拉菜单
function closeAllDropdowns() {
  if (openDropdown) {
    openDropdown.classList.add("hidden");
    openDropdown = null;
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest(".card-dropdown") && !e.target.closest(".card-more-btn")) {
    closeAllDropdowns();
  }
});

// 编辑弹窗逻辑
function openEditModal(note) {
  closeAllDropdowns();
  editingNoteId = note.id;
  editingIsPinned = note.isPinned;
  editingColor = note.color || "default";

  elements.editTitle.value = note.title || "";
  elements.editContent.value = note.content || "";
  elements.editLabels.value = (note.labels || []).join(", ");
  elements.modalCard.dataset.color = editingColor;
  elements.modalPinBtn.classList.toggle("active", editingIsPinned);

  elements.modalColorDots.forEach((dot) => {
    dot.classList.toggle("active", dot.dataset.color === editingColor);
  });

  elements.editModal.classList.remove("hidden");
  elements.editContent.focus();
}

function closeEditModal() {
  elements.editModal.classList.add("hidden");
  elements.editTitle.blur();
  elements.editContent.blur();
  elements.editLabels.blur();
  editingNoteId = null;
}

elements.modalCancelBtn.addEventListener("click", closeEditModal);
elements.editModal.addEventListener("click", (e) => {
  if (e.target === elements.editModal) {
    closeEditModal();
  }
});

elements.modalPinBtn.addEventListener("click", () => {
  editingIsPinned = !editingIsPinned;
  elements.modalPinBtn.classList.toggle("active", editingIsPinned);
});

elements.modalColorDots.forEach((dot) => {
  dot.addEventListener("click", () => {
    editingColor = dot.dataset.color;
    elements.modalCard.dataset.color = editingColor;
    elements.modalColorDots.forEach((d) => d.classList.remove("active"));
    dot.classList.add("active");
  });
});

elements.modalSaveBtn.addEventListener("click", () => {
  if (!editingNoteId) return;
  const title = elements.editTitle.value.trim();
  const content = elements.editContent.value.trim();
  const labelsStr = elements.editLabels.value.trim();
  const labels = labelsStr ? labelsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];

  if (!title && !content) return;

  void mutate(() => api(`/notes/${encodeURIComponent(editingNoteId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      title,
      content,
      color: editingColor,
      labels,
      is_pinned: editingIsPinned
    })
  })).then(() => {
    closeEditModal();
  });
});

function renderCard(note) {
  const card = document.createElement("div");
  card.className = "note-card";
  card.dataset.color = note.color || "default";
  // Lets a deep link find this card after the list renders.
  card.dataset.id = note.id;
  // No title: collapse the header row so content starts at the top; the
  // action buttons float to the top-right via the .no-title CSS rule.
  if (!note.title) card.classList.add("no-title");

  // 点击卡片本体直接唤起编辑弹窗
  card.addEventListener("click", (event) => {
    if (event.target.closest(".card-header-actions") || event.target.closest(".card-dropdown")) return;
    openEditModal(note);
  });

  // 顶栏 Header（包含 Title 及右侧靠右展示的按钮组：More按钮 在 Pin按钮 左边）
  const header = document.createElement("div");
  header.className = "card-header";

  if (note.title) {
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = note.title;
    header.append(title);
  }

  const headerActions = document.createElement("div");
  headerActions.className = "card-header-actions";

  // 更多（三点点点）按钮 + 下拉菜单容器
  const moreContainer = document.createElement("div");
  moreContainer.className = "card-more-container";

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "icon-btn-sm card-more-btn";
  moreBtn.innerHTML = SVG_ICONS.more;
  moreBtn.title = "更多选项";

  const dropdown = document.createElement("div");
  dropdown.className = "card-dropdown hidden";

  const archiveItem = document.createElement("button");
  archiveItem.type = "button";
  archiveItem.className = "dropdown-item";
  archiveItem.innerHTML = `${note.isArchived ? SVG_ICONS.unarchive : SVG_ICONS.archive} <span>${note.isArchived ? "取消归档" : "归档"}</span>`;
  archiveItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllDropdowns();
    void mutate(() => api(`/notes/${encodeURIComponent(note.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_archived: !note.isArchived })
    }));
  });

  const deleteItem = document.createElement("button");
  deleteItem.type = "button";
  deleteItem.className = "dropdown-item dropdown-item-del";
  deleteItem.innerHTML = `${SVG_ICONS.delete} <span>删除笔记</span>`;
  deleteItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllDropdowns();
    void mutate(() => api(`/notes/${encodeURIComponent(note.id)}`, { method: "DELETE" }));
  });

  // Send the note back to the chat draft. Deliberately fills only — the user
  // still edits and presses enter themselves.
  const composerItem = document.createElement("button");
  composerItem.type = "button";
  composerItem.className = "dropdown-item";
  composerItem.innerHTML = `${SVG_ICONS.composer} <span>${locale === "zh" ? "填入输入框" : "Insert into composer"}</span>`;
  composerItem.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllDropdowns();
    const body = [note.title, note.content].filter(Boolean).join("\n").trim();
    if (body) insertIntoComposer(body);
  });

  dropdown.append(composerItem, archiveItem, deleteItem);
  moreContainer.append(moreBtn, dropdown);

  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (openDropdown && openDropdown !== dropdown) {
      openDropdown.classList.add("hidden");
    }
    const isHidden = dropdown.classList.toggle("hidden");
    openDropdown = isHidden ? null : dropdown;
  });

  // 置顶按钮
  const pinBtn = document.createElement("button");
  pinBtn.type = "button";
  pinBtn.className = `icon-btn-sm composer-pin-toggle ${note.isPinned ? "active" : ""}`;
  pinBtn.innerHTML = SVG_ICONS.pin;
  pinBtn.title = note.isPinned ? "取消置顶" : "置顶";
  pinBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllDropdowns();
    void mutate(() => api(`/notes/${encodeURIComponent(note.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ is_pinned: !note.isPinned })
    }));
  });

  // 按钮位置顺序：三点点点在左，置顶在右
  headerActions.append(moreContainer, pinBtn);
  header.append(headerActions);
  card.append(header);

  // 正文内容
  const content = document.createElement("div");
  content.className = "card-content";
  content.textContent = note.content;
  card.append(content);

  // 标签区
  if (note.labels && note.labels.length > 0) {
    const labelsContainer = document.createElement("div");
    labelsContainer.className = "card-labels";
    for (const lbl of note.labels) {
      const tag = document.createElement("span");
      tag.className = "card-label-tag";
      tag.textContent = `#${lbl}`;
      labelsContainer.append(tag);
    }
    card.append(labelsContainer);
  }

  return card;
}

/**
 * Scrolls to and briefly highlights the note a deep link named.
 *
 * Does nothing when the note is not in the current view (archived tab, active
 * search, or deleted): a link into a Mini App is a convenience, and failing
 * loudly over a stale id would be worse than just opening the app.
 */
function followDeepLink() {
  if (!pendingDeepLink) return;
  const [kind, rawId] = pendingDeepLink.split("/");
  // Cleared even on a miss, so a stale id is not retried on every refresh.
  pendingDeepLink = "";
  if (kind !== "note" || !rawId) return;
  const target = document.querySelector(`.note-card[data-id="${CSS.escape(rawId)}"]`);
  if (!target) return;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.add("deep-link-target");
  setTimeout(() => target.classList.remove("deep-link-target"), 2000);
}

async function loadNotes() {
  if (halted) return;
  const isArchived = currentTab === "archived";
  const query = elements.searchInput.value.trim();

  let url = `/notes?archived=${isArchived}`;
  if (query) {
    url += `&query=${encodeURIComponent(query)}`;
  }

  const { notes } = await api(url);

  if (isArchived) {
    elements.pinnedGroup.hidden = true;
    elements.otherGroupTitle.textContent = t.archivedSection;
    elements.otherList.replaceChildren(...notes.map(renderCard));
    elements.emptyMsg.hidden = notes.length > 0;
  } else {
    const pinned = notes.filter((n) => n.isPinned);
    const others = notes.filter((n) => !n.isPinned);

    elements.pinnedGroup.hidden = pinned.length === 0;
    elements.pinnedList.replaceChildren(...pinned.map(renderCard));

    elements.otherGroupTitle.textContent = pinned.length > 0 ? t.notesSection : t.notesSection;
    elements.otherList.replaceChildren(...others.map(renderCard));

    elements.emptyMsg.hidden = notes.length > 0;
  }

  followDeepLink();
}

async function mutate(run) {
  if (halted) return;
  try {
    await run();
    setStatus(null);
    await loadNotes();
  } catch (error) {
    if (!halted) setStatus(error.message, "error");
  }
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = elements.title.value.trim();
  const content = elements.content.value.trim();
  if (!title && !content) return;

  const color = elements.colorSelect.value;
  const labelsStr = elements.labelsInput.value.trim();
  const labels = labelsStr ? labelsStr.split(/[,，]/).map((s) => s.trim()).filter(Boolean) : [];
  const is_pinned = elements.pinCheckbox.checked;

  elements.submit.disabled = true;
  void mutate(() => api("/notes", {
    method: "POST",
    body: JSON.stringify({ title, content, color, labels, is_pinned })
  }))
    .then(() => {
      collapseComposer();
    })
    .finally(() => {
      elements.submit.disabled = false;
    });
});

let searchTimer = null;
elements.searchInput.addEventListener("input", () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadNotes(), 200);
});

// - Tab picker (dropdown) -
let tabPickerOpen = false;

function updateTabTrigger() {
  elements.currentTabName.textContent = currentTab === "active" ? t.tabActive : t.tabArchived;
  elements.tabItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.tab === currentTab);
  });
}

function toggleTabPicker(force) {
  tabPickerOpen = force ?? !tabPickerOpen;
  elements.noteChevron.classList.toggle("rotate", tabPickerOpen);
  if (tabPickerOpen) {
    elements.tabPicker.hidden = false;
    elements.backdrop.hidden = false;
    requestAnimationFrame(() => {
      elements.tabPicker.classList.add("open");
      elements.backdrop.classList.add("show");
    });
  } else {
    elements.tabPicker.classList.remove("open");
    elements.backdrop.classList.remove("show");
    if (elements.tabPicker.contains(document.activeElement)) document.activeElement.blur();
    setTimeout(() => {
      elements.tabPicker.hidden = true;
      elements.backdrop.hidden = true;
    }, 300);
  }
}

elements.tabSelectorTrigger.addEventListener("click", (e) => { e.stopPropagation(); toggleTabPicker(); });
elements.backdrop.addEventListener("click", () => toggleTabPicker(false));

elements.tabItems.forEach((item) => {
  item.addEventListener("click", (e) => {
    e.stopPropagation();
    const tab = item.dataset.tab;
    toggleTabPicker(false);
    if (currentTab === tab) return;
    currentTab = tab;
    updateTabTrigger();
    void loadNotes();
  });
});

document.addEventListener("click", (e) => {
  if (tabPickerOpen && !e.target.closest(".tab-picker") && !e.target.closest(".note-trigger")) {
    toggleTabPicker(false);
  }
});

// Auto-refresh when the panel returns to the foreground (replaces the manual
// refresh button so the header stays [icon] [view dropdown] [search]).
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadNotes(); });
window.addEventListener("focus", () => void loadNotes());

async function start() {
  try {
    await loadNotes();
    setStatus(null);
  } catch (error) {
    if (!halted) setStatus(error.message, "error");
  }
}

void start();
