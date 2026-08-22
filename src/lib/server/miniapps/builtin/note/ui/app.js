import { renderMarkdown } from "./markdown.js";

const POLL_INTERVAL_MS = 2000;

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
    offline: "Molibot is not reachable.",
    toggleView: "Toggle view (Cards / List)",
    toggleTheme: "Switch theme",
    themeDefault: "Keep",
    themeSmartisan: "锤子",
    back: "Back",
    editNote: "Edit Note",
    pinNote: "Pin note",
    share: "Share",
    shareNote: "Share note as image",
    sharePreviewTitle: "Note Card Preview",
    saveImage: "Save Image",
    downloadImage: "Save Image",
    copyImage: "Copy Image",
    copyText: "Copy Text",
    imageCopied: "Image Copied!",
    textCopied: "Text Copied!",
    imageSaved: "Saved!",
    savedAndCopied: "Saved! Image also copied to clipboard",
    copyImageFailed: "Direct copy failed. Please right-click or long-press to save",
    saveImageHint: "Right-click or Long-press image to Save/Copy",
    allTags: "All",
    tagsHeader: "Tags",
    wordsCount: "{n} chars",
    previewMarkdown: "Preview Markdown",
    previewNote: "Preview Note",
    edit: "Edit",
    emptyContent: "(No content)"
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
    saveEdit: "保存",
    takeNote: "添加笔记...",
    tabActive: "笔记",
    tabArchived: "归档",
    pinnedSection: "置顶",
    notesSection: "其他",
    archivedSection: "归档",
    noNotes: "暂无笔记",
    disabled: "该 Mini App 已被禁用。",
    unavailable: "应用启动失败。",
    offline: "无法连接 Molibot。",
    toggleView: "切换视图 (卡片 / 列表)",
    toggleTheme: "切换主题",
    themeDefault: "Keep",
    themeSmartisan: "锤子",
    back: "返回",
    editNote: "编辑便签",
    pinNote: "固定笔记",
    share: "分享",
    shareNote: "生成分享图片",
    sharePreviewTitle: "便签分享图",
    saveImage: "保存图片",
    downloadImage: "保存图片",
    copyImage: "复制图片",
    copyText: "复制文本",
    imageCopied: "已复制到剪贴板",
    textCopied: "已复制文本",
    imageSaved: "已保存！",
    savedAndCopied: "已保存（同时已复制到剪贴板）",
    copyImageFailed: "直接复制失败，可右键或长按图片另存为",
    saveImageHint: "可长按或右键图片另存为/复制",
    allTags: "全部",
    tagsHeader: "标签",
    wordsCount: "{n} 字",
    previewMarkdown: "预览 Markdown",
    previewNote: "预览便签",
    edit: "编辑",
    emptyContent: "（暂无内容）"
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
 * host comparing `event.source` against this iframe. An older host浮 ignores the message, so nothing here may depend on it working.
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
  tpTabActive: document.getElementById("tp-tab-active"),
  tpTabArchived: document.getElementById("tp-tab-archived"),
  tpNotesCount: document.getElementById("tp-notes-count"),
  tpArchivedCount: document.getElementById("tp-archived-count"),
  tpTagsDivider: document.getElementById("tp-tags-divider"),
  tpTagsHeader: document.getElementById("tp-tags-header"),
  tpTagsList: document.getElementById("tp-tags-list"),
  status: document.getElementById("status"),
  pinnedGroup: document.getElementById("pinned-group"),
  pinnedList: document.getElementById("pinned-list"),
  otherGroupTitle: document.getElementById("other-group-title"),
  otherList: document.getElementById("other-list"),
  emptyMsg: document.getElementById("empty-msg"),
  colorDots: document.querySelectorAll(".color-dot"),
  viewToggleBtn: document.getElementById("view-toggle-btn"),
  themeToggleBtn: document.getElementById("theme-toggle-btn"),
  themeBadge: document.getElementById("theme-badge"),
  viewIconGrid: document.getElementById("view-icon-grid"),
  viewIconList: document.getElementById("view-icon-list"),
  noteApp: document.querySelector(".note-app"),
  
  // 编辑弹窗元素
  editModal: document.getElementById("edit-modal"),
  modalCard: document.getElementById("modal-card"),
  editTitle: document.getElementById("edit-title"),
  editContent: document.getElementById("edit-content"),
  editLabels: document.getElementById("edit-labels"),
  editorEditFields: document.getElementById("editor-edit-fields"),
  editorPreviewView: document.getElementById("editor-preview-view"),
  previewTitle: document.getElementById("preview-title"),
  previewContent: document.getElementById("preview-content"),
  modalPreviewBtn: document.getElementById("modal-preview-btn"),
  editorTitleText: document.querySelector(".editor-title-text"),
  modalPinBtn: document.getElementById("modal-pin-btn"),
  modalBackBtn: document.getElementById("modal-back-btn"),
  modalSaveBtn: document.getElementById("modal-save-btn"),
  modalShareBtn: document.getElementById("modal-share-btn"),
  modalColorDots: document.querySelectorAll(".modal-color-dot"),
  editorWordCount: document.getElementById("editor-word-count"),

  // 分享预览弹窗元素
  shareModal: document.getElementById("share-modal"),
  sharePreviewImg: document.getElementById("share-preview-img"),
  shareCloseBtn: document.getElementById("share-close-btn"),
  shareCopyTextBtn: document.getElementById("share-copy-text-btn"),
  shareCopyImgBtn: document.getElementById("share-copy-img-btn"),
  shareSaveImgBtn: document.getElementById("share-save-img-btn"),
  sharePreviewHint: document.getElementById("share-preview-hint")
};

for (const node of document.querySelectorAll("[data-i18n]")) {
  node.textContent = t[node.dataset.i18n] ?? node.textContent;
}
for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
  node.placeholder = t[node.dataset.i18nPlaceholder] ?? node.placeholder;
}
for (const node of document.querySelectorAll("[data-i18n-title]")) {
  node.title = t[node.dataset.i18nTitle] ?? node.title;
}

let halted = false;
let currentTab = "active";
let editingNoteId = null;
let editingIsPinned = false;
let editingColor = "default";
let openDropdown = null;
let lastRevision = null;
let pollTimer = null;
let polling = false;

// 视图模式: 'card' (卡片) | 'list' (列表)
const STORAGE_KEY_VIEW = "molibot_note_view_mode";
let currentViewMode = localStorage.getItem(STORAGE_KEY_VIEW) === "list" ? "list" : "card";

// 应用皮肤/主题: 'default' (Google Keep) | 'smartisan' (锤子便签)
const STORAGE_KEY_THEME = "molibot_note_ui_theme";
let currentAppTheme = localStorage.getItem(STORAGE_KEY_THEME) === "smartisan" ? "smartisan" : "default";

function applyViewMode(mode) {
  currentViewMode = mode === "list" ? "list" : "card";
  localStorage.setItem(STORAGE_KEY_VIEW, currentViewMode);
  if (elements.noteApp) {
    elements.noteApp.dataset.view = currentViewMode;
  }
  if (elements.viewIconGrid && elements.viewIconList) {
    if (currentViewMode === "list") {
      elements.viewIconGrid.classList.remove("hidden");
      elements.viewIconList.classList.add("hidden");
    } else {
      elements.viewIconGrid.classList.add("hidden");
      elements.viewIconList.classList.remove("hidden");
    }
  }
}

function applyAppTheme(themeName) {
  currentAppTheme = themeName === "smartisan" ? "smartisan" : "default";
  localStorage.setItem(STORAGE_KEY_THEME, currentAppTheme);
  document.documentElement.dataset.appTheme = currentAppTheme;
  if (elements.themeBadge) {
    elements.themeBadge.textContent = currentAppTheme === "smartisan" ? t.themeSmartisan : t.themeDefault;
  }
}

applyViewMode(currentViewMode);
applyAppTheme(currentAppTheme);

if (elements.viewToggleBtn) {
  elements.viewToggleBtn.addEventListener("click", () => {
    applyViewMode(currentViewMode === "card" ? "list" : "card");
  });
}

if (elements.themeToggleBtn) {
  elements.themeToggleBtn.addEventListener("click", () => {
    applyAppTheme(currentAppTheme === "default" ? "smartisan" : "default");
  });
}

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

// 编辑弹窗与预览逻辑
let isPreviewMode = false;

function updatePreviewContent() {
  if (!elements.previewContent) return;
  const title = elements.editTitle ? elements.editTitle.value.trim() : "";
  const content = elements.editContent ? elements.editContent.value.trim() : "";

  if (elements.previewTitle) {
    if (title) {
      elements.previewTitle.textContent = title;
      elements.previewTitle.classList.remove("hidden");
    } else {
      elements.previewTitle.textContent = "";
      elements.previewTitle.classList.add("hidden");
    }
  }

  if (content) {
    elements.previewContent.innerHTML = renderMarkdown(content);
  } else {
    elements.previewContent.innerHTML = `<p class="note-empty-preview" style="opacity: 0.6; font-style: italic;">${t.emptyContent || "(暂无内容)"}</p>`;
  }
}

function setPreviewMode(preview) {
  isPreviewMode = preview;
  if (!elements.modalPreviewBtn) return;
  const previewIcon = elements.modalPreviewBtn.querySelector(".preview-icon");
  const editIcon = elements.modalPreviewBtn.querySelector(".edit-icon");

  if (isPreviewMode) {
    updatePreviewContent();
    if (elements.editorEditFields) elements.editorEditFields.classList.add("hidden");
    if (elements.editorPreviewView) elements.editorPreviewView.classList.remove("hidden");
    elements.modalPreviewBtn.classList.add("active");
    elements.modalPreviewBtn.title = t.edit || "编辑";
    if (previewIcon) previewIcon.classList.add("hidden");
    if (editIcon) editIcon.classList.remove("hidden");
    if (elements.editorTitleText) elements.editorTitleText.textContent = t.previewNote || "预览便签";
  } else {
    if (elements.editorPreviewView) elements.editorPreviewView.classList.add("hidden");
    if (elements.editorEditFields) elements.editorEditFields.classList.remove("hidden");
    elements.modalPreviewBtn.classList.remove("active");
    elements.modalPreviewBtn.title = t.previewMarkdown || "预览 Markdown";
    if (previewIcon) previewIcon.classList.remove("hidden");
    if (editIcon) editIcon.classList.add("hidden");
    if (elements.editorTitleText) elements.editorTitleText.textContent = t.editNote || "编辑便签";
  }
}

if (elements.modalPreviewBtn) {
  elements.modalPreviewBtn.addEventListener("click", () => {
    setPreviewMode(!isPreviewMode);
    if (!isPreviewMode && elements.editContent) {
      elements.editContent.focus();
    }
  });
}

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

  setPreviewMode(false);
  elements.editModal.classList.remove("hidden");
  updateWordCount();
  elements.editContent.focus();
}

function closeEditModal() {
  elements.editModal.classList.add("hidden");
  elements.editTitle.blur();
  elements.editContent.blur();
  elements.editLabels.blur();
  setPreviewMode(false);
  editingNoteId = null;
}

if (elements.modalBackBtn) {
  elements.modalBackBtn.addEventListener("click", closeEditModal);
}
elements.editModal.addEventListener("click", (e) => {
  if (e.target === elements.editModal) {
    closeEditModal();
  }
});

// 字数统计与编辑状态
function updateWordCount() {
  if (!elements.editorWordCount) return;
  const titleLen = elements.editTitle ? elements.editTitle.value.trim().length : 0;
  const contentLen = elements.editContent ? elements.editContent.value.trim().length : 0;
  const total = titleLen + contentLen;
  elements.editorWordCount.textContent = (t.wordsCount || "{n} 字").replace("{n}", String(total));
}

if (elements.editTitle) {
  elements.editTitle.addEventListener("input", updateWordCount);
}
if (elements.editContent) {
  elements.editContent.addEventListener("input", updateWordCount);
}

// 分享图片生成与弹窗逻辑
let currentShareBlob = null;
let currentShareDataUrl = "";
let currentShareTitle = "";
let currentShareContent = "";

function closeShareModal() {
  if (elements.shareModal) {
    elements.shareModal.classList.add("hidden");
  }
  if (elements.sharePreviewImg) {
    elements.sharePreviewImg.src = "";
  }
  currentShareBlob = null;
  currentShareDataUrl = "";
  currentShareTitle = "";
  currentShareContent = "";
}

if (elements.shareCloseBtn) {
  elements.shareCloseBtn.addEventListener("click", closeShareModal);
}
if (elements.shareModal) {
  elements.shareModal.addEventListener("click", (e) => {
    if (e.target === elements.shareModal) {
      closeShareModal();
    }
  });
}

// 辅助函数：将 dataUrl 转换为 Blob
async function dataUrlToBlob(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    return await res.blob();
  } catch (e) {
    const parts = dataUrl.split(";base64,");
    const contentType = parts[0].split(":")[1] || "image/png";
    const raw = window.atob(parts[1]);
    const uInt8Array = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) {
      uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: contentType });
  }
}

// 保存图片到本地 (PNG) + 自动复制到剪贴板双保险
if (elements.shareSaveImgBtn) {
  elements.shareSaveImgBtn.addEventListener("click", async () => {
    let blob = currentShareBlob;
    if (!blob && currentShareDataUrl) {
      blob = await dataUrlToBlob(currentShareDataUrl).catch(() => null);
    }

    const dateStr = new Date().toISOString().slice(0, 10);
    const safeTitle = (currentShareTitle || (locale === "zh" ? "便签" : "Note")).replace(/[\\/:*?"<>|]/g, "_");
    const filename = `${safeTitle}_${dateStr}.png`;

    // 1. 尝试常规 a download 触发下载
    try {
      const a = document.createElement("a");
      a.download = filename;
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        a.href = objectUrl;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(objectUrl);
        }, 2000);
      } else if (currentShareDataUrl) {
        a.href = currentShareDataUrl;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
      }
    } catch (err) {
      console.warn("Direct download link click failed:", err);
    }

    // 2. 同时自动将图片写入系统剪贴板 (解决沙箱 iframe / 桌面端拦截文件下载问题)
    let clipboardCopied = false;
    if (blob && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        clipboardCopied = true;
      } catch (err) {
        console.warn("Auto clipboard write on save failed:", err);
      }
    }

    // 3. UI 即时高亮反馈
    const originalText = elements.shareSaveImgBtn.textContent;
    elements.shareSaveImgBtn.textContent = t.imageSaved || "已保存！";
    elements.shareSaveImgBtn.classList.add("success");

    if (elements.sharePreviewHint) {
      elements.sharePreviewHint.textContent = clipboardCopied
        ? (t.savedAndCopied || "已保存（同时已复制到剪贴板）")
        : (t.saveImageHint || "可长按或右键图片另存为/复制");
    }

    setTimeout(() => {
      elements.shareSaveImgBtn.textContent = originalText;
      elements.shareSaveImgBtn.classList.remove("success");
    }, 2500);
  });
}

// 复制图片到剪贴板
if (elements.shareCopyImgBtn) {
  elements.shareCopyImgBtn.addEventListener("click", async () => {
    let blob = currentShareBlob;
    if (!blob && currentShareDataUrl) {
      blob = await dataUrlToBlob(currentShareDataUrl).catch(() => null);
    }

    if (blob && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob })
        ]);
        const originalText = elements.shareCopyImgBtn.textContent;
        elements.shareCopyImgBtn.textContent = t.imageCopied || "已复制！";
        elements.shareCopyImgBtn.classList.add("success");
        if (elements.sharePreviewHint) {
          elements.sharePreviewHint.textContent = t.imageCopied || "已复制到剪贴板";
        }
        setTimeout(() => {
          elements.shareCopyImgBtn.textContent = originalText;
          elements.shareCopyImgBtn.classList.remove("success");
        }, 2000);
        return;
      } catch (err) {
        console.warn("Clipboard write image failed:", err);
      }
    }
    // 降级提示
    if (elements.sharePreviewHint) {
      elements.sharePreviewHint.textContent = t.copyImageFailed || t.saveImageHint;
    }
  });
}

// 复制纯文本
if (elements.shareCopyTextBtn) {
  elements.shareCopyTextBtn.addEventListener("click", async () => {
    const fullText = [currentShareTitle, currentShareContent].filter(Boolean).join("\n\n");
    if (!fullText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullText);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = fullText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      const originalText = elements.shareCopyTextBtn.textContent;
      elements.shareCopyTextBtn.textContent = t.textCopied || "已复制文本";
      elements.shareCopyTextBtn.classList.add("success");
      setTimeout(() => {
        elements.shareCopyTextBtn.textContent = originalText;
        elements.shareCopyTextBtn.classList.remove("success");
      }, 2000);
    } catch (err) {
      console.warn("Copy text failed:", err);
    }
  });
}

function escapeXml(unsafe) {
  return String(unsafe ?? "").replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case "'": return "&apos;";
      case '"': return "&quot;";
    }
  });
}

async function generateShareImage(title, content, color, appThemeName) {
  const isDark = document.documentElement.dataset.theme === "dark";
  const scale = 2; // retina 2x
  const width = 360;
  const bodyHtml = renderMarkdown(content || "");
  const titleHtml = title ? `<h1 class="share-doc-title">${escapeXml(title)}</h1>` : "";
  const dateStr = new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });

  let styles = "";
  let cardContentHtml = "";
  let paperBg = "";

  if (appThemeName === "smartisan") {
    paperBg = isDark ? "#1f1d1f" : "#fffdf8";
    const textColor = isDark ? "#ded6ce" : "#4a3c30";
    const headingColor = isDark ? "#f5ede4" : "#2d2218";
    const quoteBar = isDark ? "#4d4444" : "#cfc3b2";
    const codeBg = isDark ? "rgba(255,255,255,0.06)" : "rgba(125,78,32,0.06)";
    const hrColor = isDark ? "#332f33" : "#ece6dc";
    const footerBrand = isDark ? "#8c7e72" : "#9e8e7e";
    const footerDate = isDark ? "#6e6258" : "#b8ab9b";

    styles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        margin: 0;
        padding: 0;
        width: ${width}px;
        background: ${paperBg};
        font-family: "PingFang SC", -apple-system, "Songti SC", serif;
      }
      .card {
        width: ${width}px;
        background: ${paperBg};
        padding: 24px 20px 18px;
        color: ${textColor};
      }
      .content {
        font-size: 14.5px;
        line-height: 1.65;
        word-break: break-word;
      }
      .share-doc-title {
        font-size: 18px;
        font-weight: 700;
        color: ${headingColor};
        margin-bottom: 12px;
        line-height: 1.35;
      }
      .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
        color: ${headingColor};
        margin: 12px 0 6px;
        font-weight: 700;
        line-height: 1.3;
      }
      .content h1 { font-size: 17px; }
      .content h2 { font-size: 16px; }
      .content h3 { font-size: 15px; }
      .content p { margin: 6px 0; }
      .content ul, .content ol { padding-left: 18px; margin: 6px 0; }
      .content li { margin: 3px 0; }
      .content blockquote {
        margin: 8px 0;
        padding: 4px 12px;
        border-left: 3px solid ${quoteBar};
        color: ${footerBrand};
        background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"};
        border-radius: 0 4px 4px 0;
      }
      .content code {
        font-family: Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 3px;
        background: ${codeBg};
      }
      .content pre {
        margin: 8px 0;
        padding: 8px 10px;
        background: ${codeBg};
        border-radius: 4px;
        overflow-x: auto;
      }
      .content pre code { padding: 0; background: transparent; }
      .content hr { border: none; border-top: 1px solid ${hrColor}; margin: 12px 0; }
      .content strong { font-weight: 700; color: ${headingColor}; }
      .content em { font-style: italic; }
      .content a { color: ${isDark ? "#c99359" : "#a16d36"}; text-decoration: none; }
      
      .footer {
        margin-top: 22px;
        padding-top: 10px;
        border-top: 1px dashed ${hrColor};
        text-align: center;
      }
      .brand {
        font-size: 12px;
        font-weight: 600;
        color: ${footerBrand};
        letter-spacing: 0.03em;
      }
      .date {
        font-size: 11px;
        color: ${footerDate};
        margin-top: 2px;
      }
    `;

    cardContentHtml = `
      <div class="card">
        <div class="content">
          ${titleHtml}
          ${bodyHtml}
        </div>
        <div class="footer">
          <div class="brand">Smartisan Notes</div>
          <div class="date">${escapeXml(dateStr)}</div>
        </div>
      </div>
    `;
  } else {
    // Keep 主题
    const LIGHT_COLOR_MAP = {
      default: "#ffffff",
      yellow: "#fff8e1",
      blue: "#e3f2fd",
      green: "#e8f5e9",
      red: "#ffebee",
      purple: "#f3e5f5",
      gray: "#f5f5f5"
    };
    const DARK_COLOR_MAP = {
      default: "#25272a",
      yellow: "#42381b",
      blue: "#16334a",
      green: "#193620",
      red: "#3e1e20",
      purple: "#361f40",
      gray: "#303236"
    };

    const colorMap = isDark ? DARK_COLOR_MAP : LIGHT_COLOR_MAP;
    paperBg = colorMap[color] || colorMap.default;
    const textColor = isDark ? "#bdc1c6" : "#3c4043";
    const headingColor = isDark ? "#e8eaed" : "#202124";
    const cardBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
    const quoteBar = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";
    const codeBg = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
    const footerBrand = isDark ? "#9aa0a6" : "#80868b";
    const footerDate = isDark ? "#70757a" : "#9aa0a6";

    styles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        margin: 0;
        padding: 0;
        width: ${width}px;
        background: ${paperBg};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .card {
        width: ${width}px;
        background: ${paperBg};
        padding: 20px 18px 14px;
        color: ${textColor};
      }
      .content {
        font-size: 14.5px;
        line-height: 1.6;
        word-break: break-word;
      }
      .share-doc-title {
        font-size: 18px;
        font-weight: 700;
        color: ${headingColor};
        margin-bottom: 10px;
        line-height: 1.35;
      }
      .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
        color: ${headingColor};
        margin: 12px 0 6px;
        font-weight: 700;
        line-height: 1.3;
      }
      .content h1 { font-size: 17px; }
      .content h2 { font-size: 16px; }
      .content h3 { font-size: 15px; }
      .content p { margin: 6px 0; }
      .content ul, .content ol { padding-left: 18px; margin: 6px 0; }
      .content li { margin: 3px 0; }
      .content blockquote {
        margin: 8px 0;
        padding: 4px 12px;
        border-left: 3px solid ${quoteBar};
        color: ${footerBrand};
      }
      .content code {
        font-family: monospace;
        font-size: 13px;
        padding: 2px 4px;
        border-radius: 4px;
        background: ${codeBg};
      }
      .content pre {
        margin: 8px 0;
        padding: 8px 10px;
        background: ${codeBg};
        border-radius: 6px;
        overflow-x: auto;
      }
      .content pre code { padding: 0; background: transparent; }
      .content hr { border: none; border-top: 1px solid ${cardBorder}; margin: 12px 0; }
      .content strong { font-weight: 700; color: ${headingColor}; }
      .content a { color: ${isDark ? "#8ab4f8" : "#1a73e8"}; text-decoration: none; }
      
      .footer {
        margin-top: 18px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: ${footerDate};
        padding-top: 8px;
        border-top: 1px solid ${cardBorder};
      }
      .brand {
        font-size: 12px;
        font-weight: 600;
        color: ${footerBrand};
      }
    `;

    cardContentHtml = `
      <div class="card">
        <div class="content">
          ${titleHtml}
          ${bodyHtml}
        </div>
        <div class="footer">
          <span class="date">${escapeXml(dateStr)}</span>
          <span class="brand">Note</span>
        </div>
      </div>
    `;
  }

  // 1. 先在一个隐藏容器中渲染 DOM 以精确测量实际渲染高度
  const measureDiv = document.createElement("div");
  measureDiv.style.position = "absolute";
  measureDiv.style.visibility = "hidden";
  measureDiv.style.left = "-9999px";
  measureDiv.style.top = "-9999px";
  measureDiv.style.width = `${width}px`;
  measureDiv.innerHTML = `<style>${styles}</style>${cardContentHtml}`;
  document.body.appendChild(measureDiv);
  const cardElem = measureDiv.querySelector(".card");
  const totalHeight = Math.ceil(cardElem ? cardElem.offsetHeight || cardElem.scrollHeight : measureDiv.offsetHeight || 200);
  measureDiv.remove();

  // 2. 构建自包含 SVG ForeignObject
  const svgDoc = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}">
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">
          <style>${styles}</style>
          ${cardContentHtml}
        </div>
      </foreignObject>
    </svg>
  `;

  const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgDoc);

  // 3. 载入 SVG Image 并在 2x Canvas 上栅格化为高质量 PNG
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = totalHeight * scale;
      const ctx = canvas.getContext("2d");
      ctx.scale(scale, scale);

      ctx.fillStyle = paperBg;
      ctx.fillRect(0, 0, width, totalHeight);
      ctx.drawImage(img, 0, 0, width, totalHeight);

      try {
        const dataUrl = canvas.toDataURL("image/png");
        canvas.toBlob((blob) => {
          resolve({ blob, dataUrl });
        }, "image/png");
      } catch (e) {
        console.error("Canvas export failed:", e);
        resolve({ blob: null, dataUrl: svgDataUrl });
      }
    };
    img.onerror = (e) => {
      console.error("SVG image load failed:", e);
      resolve(null);
    };
    img.src = svgDataUrl;
  });
}

if (elements.modalShareBtn) {
  elements.modalShareBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const title = elements.editTitle ? elements.editTitle.value.trim() : "";
    const content = elements.editContent ? elements.editContent.value.trim() : "";
    if (!title && !content) return;

    elements.modalShareBtn.disabled = true;
    elements.modalShareBtn.style.opacity = "0.5";

    try {
      const result = await generateShareImage(title, content, editingColor, currentAppTheme);
      if (!result) return;
      currentShareBlob = result.blob;
      currentShareDataUrl = result.dataUrl;
      currentShareTitle = title;
      currentShareContent = content;
      if (elements.sharePreviewImg) {
        elements.sharePreviewImg.src = result.dataUrl || (result.blob ? URL.createObjectURL(result.blob) : "");
      }
      if (elements.shareModal) {
        elements.shareModal.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Generate share image failed:", err);
    } finally {
      elements.modalShareBtn.disabled = false;
      elements.modalShareBtn.style.opacity = "";
    }
  });
}

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
    if (event.target.closest("a") || event.target.closest(".card-header-actions") || event.target.closest(".card-dropdown")) return;
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
  content.innerHTML = renderMarkdown(note.content);
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

let activeTag = "";
let cachedNotes = [];

function renderTagMenu(notes) {
  if (!elements.tpTagsList) return;
  const tagCounts = new Map();
  for (const n of notes) {
    for (const lbl of n.labels || []) {
      if (!lbl) continue;
      tagCounts.set(lbl, (tagCounts.get(lbl) || 0) + 1);
    }
  }

  if (tagCounts.size === 0) {
    if (elements.tpTagsDivider) elements.tpTagsDivider.hidden = true;
    if (elements.tpTagsHeader) elements.tpTagsHeader.hidden = true;
    elements.tpTagsList.replaceChildren();
    return;
  }

  if (elements.tpTagsDivider) elements.tpTagsDivider.hidden = false;
  if (elements.tpTagsHeader) elements.tpTagsHeader.hidden = false;
  elements.tpTagsList.replaceChildren();

  for (const [tag, count] of tagCounts) {
    const item = document.createElement("button");
    item.type = "button";
    const isTagActive = currentTab === "active" && activeTag === tag;
    item.className = `tp-item ${isTagActive ? "active" : ""}`;
    item.innerHTML = `
      <svg class="tp-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z"/>
      </svg>
      <span class="tp-label">#${escapeXml(tag)}</span>
      <span class="tp-count">${count}</span>
    `;
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      activeTag = tag;
      currentTab = "active";
      updateTabTrigger();
      applyFilteredNotes();
      toggleTabPicker(false);
    });
    elements.tpTagsList.append(item);
  }
}

function applyFilteredNotes() {
  const isArchived = currentTab === "archived";
  const notes = currentTab === "active" && activeTag
    ? cachedNotes.filter((n) => (n.labels || []).includes(activeTag))
    : cachedNotes;

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

    elements.otherGroupTitle.textContent = activeTag ? `#${activeTag}` : t.notesSection;
    elements.otherList.replaceChildren(...others.map(renderCard));

    elements.emptyMsg.hidden = notes.length > 0;
  }
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
  cachedNotes = notes || [];

  if (!isArchived && !query && elements.tpNotesCount) {
    elements.tpNotesCount.textContent = String(cachedNotes.length);
  }

  updateTabTrigger();
  applyFilteredNotes();
  followDeepLink();
}

async function mutate(run) {
  if (halted) return;
  try {
    await run();
    setStatus(null);
    const revision = await currentRevision();
    await loadNotes();
    lastRevision = revision;
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
  if (currentTab === "archived") {
    elements.currentTabName.textContent = t.tabArchived;
  } else if (activeTag) {
    elements.currentTabName.textContent = `#${activeTag}`;
  } else {
    elements.currentTabName.textContent = t.tabActive;
  }
  if (elements.tpTabActive) {
    elements.tpTabActive.classList.toggle("active", currentTab === "active" && !activeTag);
  }
  if (elements.tpTabArchived) {
    elements.tpTabArchived.classList.toggle("active", currentTab === "archived");
  }
  renderTagMenu(cachedNotes);
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

if (elements.tpTabActive) {
  elements.tpTabActive.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTabPicker(false);
    activeTag = "";
    if (currentTab === "active") {
      updateTabTrigger();
      applyFilteredNotes();
    } else {
      currentTab = "active";
      updateTabTrigger();
      void loadNotes();
    }
  });
}

if (elements.tpTabArchived) {
  elements.tpTabArchived.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleTabPicker(false);
    activeTag = "";
    if (currentTab === "archived") {
      updateTabTrigger();
      applyFilteredNotes();
    } else {
      currentTab = "archived";
      updateTabTrigger();
      void loadNotes();
    }
  });
}

document.addEventListener("click", (e) => {
  if (tabPickerOpen && !e.target.closest(".tab-picker") && !e.target.closest(".note-trigger")) {
    toggleTabPicker(false);
  }
});

async function currentRevision() {
  const state = await api("/_host/state");
  return state.revision;
}

async function poll() {
  if (halted || document.hidden || polling) return;
  polling = true;
  try {
    const revision = await currentRevision();
    if (revision !== lastRevision) {
      await loadNotes();
      lastRevision = revision;
    }
    setStatus(null);
  } catch {
    if (!halted) setStatus(t.offline, "error");
  } finally {
    polling = false;
  }
}

// The Agent and the UI share one host revision. Polling that cheap state keeps
// an already-open panel fresh; hidden panels skip work, and foreground/focus
// events perform an immediate check instead of waiting for the next interval.
document.addEventListener("visibilitychange", () => { if (!document.hidden) void poll(); });
window.addEventListener("focus", () => void poll());

async function start() {
  try {
    lastRevision = await currentRevision();
    await loadNotes();
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
