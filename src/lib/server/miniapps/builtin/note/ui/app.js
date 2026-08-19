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
    downloadImage: "Save Image",
    copyImage: "Copy Image",
    imageCopied: "Image Copied!",
    saveImageHint: "Right-click or Long-press image to Save/Copy"
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
    downloadImage: "保存图片",
    copyImage: "复制图片",
    imageCopied: "已复制到剪贴板",
    saveImageHint: "可长按或右键图片另存为/复制"
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
  modalPinBtn: document.getElementById("modal-pin-btn"),
  modalBackBtn: document.getElementById("modal-back-btn"),
  modalSaveBtn: document.getElementById("modal-save-btn"),
  modalShareBtn: document.getElementById("modal-share-btn"),
  modalColorDots: document.querySelectorAll(".modal-color-dot"),

  // 分享预览弹窗元素
  shareModal: document.getElementById("share-modal"),
  sharePreviewImg: document.getElementById("share-preview-img"),
  shareCloseBtn: document.getElementById("share-close-btn")
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

if (elements.modalBackBtn) {
  elements.modalBackBtn.addEventListener("click", closeEditModal);
}
elements.editModal.addEventListener("click", (e) => {
  if (e.target === elements.editModal) {
    closeEditModal();
  }
});

// 分享图片生成与弹窗逻辑
let currentShareBlob = null;
let currentShareDataUrl = "";

function closeShareModal() {
  if (elements.shareModal) {
    elements.shareModal.classList.add("hidden");
  }
  if (elements.sharePreviewImg) {
    elements.sharePreviewImg.src = "";
  }
  currentShareBlob = null;
  currentShareDataUrl = "";
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
  const width = 480;
  const cardWidth = 432;
  const cardPadding = 24;
  const bodyHtml = renderMarkdown(content || "");
  const titleHtml = title ? `<h1 class="share-doc-title">${escapeXml(title)}</h1>` : "";
  const dateStr = new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", { year: "numeric", month: "short", day: "numeric" });

  let styles = "";
  let cardContentHtml = "";
  let outerBg = "";

  if (appThemeName === "smartisan") {
    outerBg = isDark ? "#131113" : "#efe6d6";
    const paperBg = isDark ? "#1c1a1c" : "#fffcf7";
    const frameColor = isDark ? "#332f33" : "#e8e4dc";
    const textColor = isDark ? "#e6ded6" : "#5c4938";
    const headingColor = isDark ? "#f0e6dc" : "rgba(70, 53, 38, 0.96)";
    const quoteBar = isDark ? "#3d3838" : "#d8cebe";
    const codeBg = isDark ? "#282628" : "rgba(125, 78, 32, 0.08)";
    const hrColor = isDark ? "#2a272a" : "#e8e2d7";
    const footerBrand = isDark ? "#8c7e72" : "#a89988";
    const footerDate = isDark ? "#6e6258" : "#c2b5a5";

    styles = `
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        margin: 0;
        padding: 20px 24px;
        background: ${outerBg};
        font-family: "PingFang SC", -apple-system, "Songti SC", serif;
        display: flex;
        justify-content: center;
      }
      .card {
        position: relative;
        width: ${cardWidth}px;
        background: ${paperBg};
        box-shadow: 0 16px 36px ${isDark ? "rgba(0,0,0,0.5)" : "rgba(82,60,34,0.12)"};
        padding: 32px 24px 24px;
        color: ${textColor};
      }
      .frame-outer {
        position: absolute;
        inset: 16px 10px 48px;
        border: 1px solid ${frameColor};
        pointer-events: none;
      }
      .frame-inner {
        position: absolute;
        inset: 18px 12px 50px;
        border: 1px solid ${frameColor};
        pointer-events: none;
      }
      .corner {
        position: absolute;
        width: 4px;
        height: 4px;
        border: 1px solid ${frameColor};
        background: ${paperBg};
        pointer-events: none;
      }
      .c-tl { top: 15px; left: 9px; }
      .c-tr { top: 15px; right: 9px; }
      .c-bl { bottom: 47px; left: 9px; }
      .c-br { bottom: 47px; right: 9px; }
      
      .content {
        position: relative;
        z-index: 1;
        font-size: 15px;
        line-height: 1.75;
        word-break: break-word;
      }
      .share-doc-title {
        font-size: 20px;
        font-weight: bold;
        color: ${headingColor};
        margin-bottom: 16px;
        line-height: 1.35;
      }
      .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
        color: ${headingColor};
        margin: 16px 0 8px;
        font-weight: bold;
        line-height: 1.3;
      }
      .content h1 { font-size: 18px; }
      .content h2 { font-size: 17px; }
      .content h3 { font-size: 16px; }
      .content p { margin: 8px 0; }
      .content ul, .content ol { padding-left: 20px; margin: 8px 0; }
      .content li { margin: 4px 0; }
      .content blockquote {
        margin: 12px 0;
        padding: 6px 14px;
        border-left: 3px solid ${quoteBar};
        color: ${footerBrand};
        background: ${isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)"};
        border-radius: 0 4px 4px 0;
      }
      .content code {
        font-family: Menlo, Monaco, Consolas, monospace;
        font-size: 13px;
        padding: 2px 5px;
        border-radius: 3px;
        background: ${codeBg};
      }
      .content pre {
        margin: 12px 0;
        padding: 10px 12px;
        background: ${codeBg};
        border-radius: 4px;
        overflow-x: auto;
      }
      .content pre code { padding: 0; background: transparent; }
      .content hr { border: none; border-top: 1px solid ${hrColor}; margin: 16px 0; }
      .content strong { font-weight: bold; color: ${headingColor}; }
      .content em { font-style: italic; }
      .content a { color: ${isDark ? "#c99359" : "#a16d36"}; text-decoration: none; }
      
      .footer {
        position: relative;
        z-index: 1;
        margin-top: 32px;
        padding-top: 12px;
        text-align: center;
      }
      .brand {
        font-size: 12px;
        font-weight: bold;
        color: ${footerBrand};
        letter-spacing: 0.04em;
      }
      .date {
        font-size: 11px;
        color: ${footerDate};
        margin-top: 3px;
      }
    `;

    cardContentHtml = `
      <div class="card">
        <div class="frame-outer"></div>
        <div class="frame-inner"></div>
        <span class="corner c-tl"></span>
        <span class="corner c-tr"></span>
        <span class="corner c-bl"></span>
        <span class="corner c-br"></span>
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
    outerBg = isDark ? "#131416" : "#f1f3f4";
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
    const cardBg = colorMap[color] || colorMap.default;
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
        padding: 20px 24px;
        background: ${outerBg};
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        justify-content: center;
      }
      .card {
        width: ${cardWidth}px;
        background: ${cardBg};
        border: 1px solid ${cardBorder};
        border-radius: 12px;
        box-shadow: 0 4px 16px ${isDark ? "rgba(0,0,0,0.4)" : "rgba(0,0,0,0.08)"};
        padding: 24px 20px 16px;
        color: ${textColor};
      }
      .content {
        font-size: 15px;
        line-height: 1.65;
        word-break: break-word;
      }
      .share-doc-title {
        font-size: 19px;
        font-weight: bold;
        color: ${headingColor};
        margin-bottom: 12px;
        line-height: 1.35;
      }
      .content h1, .content h2, .content h3, .content h4, .content h5, .content h6 {
        color: ${headingColor};
        margin: 14px 0 6px;
        font-weight: bold;
        line-height: 1.3;
      }
      .content h1 { font-size: 18px; }
      .content h2 { font-size: 17px; }
      .content h3 { font-size: 16px; }
      .content p { margin: 6px 0; }
      .content ul, .content ol { padding-left: 20px; margin: 6px 0; }
      .content li { margin: 3px 0; }
      .content blockquote {
        margin: 10px 0;
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
        margin: 10px 0;
        padding: 8px 10px;
        background: ${codeBg};
        border-radius: 6px;
        overflow-x: auto;
      }
      .content pre code { padding: 0; background: transparent; }
      .content hr { border: none; border-top: 1px solid ${cardBorder}; margin: 14px 0; }
      .content strong { font-weight: bold; color: ${headingColor}; }
      .content a { color: ${isDark ? "#8ab4f8" : "#1a73e8"}; text-decoration: none; }
      
      .footer {
        margin-top: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: ${footerDate};
        padding-top: 8px;
      }
      .brand {
        font-size: 12px;
        font-weight: 500;
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
          <span class="brand">Google Keep</span>
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
  const measuredHeight = Math.max(220, measureDiv.offsetHeight || measureDiv.scrollHeight || 300);
  measureDiv.remove();

  const totalHeight = measuredHeight + 40;

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

      ctx.fillStyle = outerBg;
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

    try {
      const result = await generateShareImage(title, content, editingColor, currentAppTheme);
      if (!result) return;
      currentShareBlob = result.blob;
      currentShareDataUrl = result.dataUrl;
      if (elements.sharePreviewImg) {
        elements.sharePreviewImg.src = result.dataUrl || (result.blob ? URL.createObjectURL(result.blob) : "");
      }
      if (elements.shareModal) {
        elements.shareModal.classList.remove("hidden");
      }
    } catch (err) {
      console.error("Generate share image failed:", err);
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
