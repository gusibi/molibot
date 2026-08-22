import { THEMES, DEFAULT_THEME_ID } from "./themes.js";
import { renderThemedHtml } from "./render.js";

/**
 * MD Preview 面板控制器。
 *
 * 核心契约：
 * 1. 复制下拉菜单支持：复制到微信公众号（主要）、复制 HTML 源码、复制 Markdown 原文。
 * 2. 预览即复制内容：渲染产物是全内联样式 DOM，复制只是将 <img src> 替换为 R2 URL 后写入剪贴板。
 * 3. 上传只改映射不改文档：本地图片的公开 URL 存入 DB，Markdown 源文件保留本地路径。
 * 4. 未上传图片检测：复制前提示确认（先上传 / 仍要复制 / 取消）。
 */

const STRINGS = {
  zh: {
    noDocument: "未打开文档",
    theme: "主题",
    upload: "上传图片",
    copy: "复制",
    copyWechat: "复制到微信公众号",
    copyHtml: "复制 HTML 代码",
    copyRaw: "复制 Markdown 原文",
    documents: "已缓存文档",
    openFile: "导入 .md",
    loadSample: "加载排版示例",
    emptyTitle: "开始 Markdown 微信排版",
    emptyBody: "在 Molibot 对话中让 Agent 帮您预览或排版文章，或直接选择本地 Markdown 文件打开。",
    openFile2: "打开本地 .md 文件",
    r2Title: "Cloudflare R2 图床设置",
    r2Hint: "本地图片上传至 R2 后，仅在点击「复制公众号」时替换为公开 URL；Markdown 原文及本地引用路径永不被改写。",
    endpoint: "Endpoint (可选，兼容任意 S3)",
    secret: "Secret Access Key (只写，不回显)",
    publicBase: "公开访问前缀 URL",
    save: "保存设置",
    test: "测试连接",
    back: "返回预览",
    delete: "删除",
    copied: "已复制微信排版，直接在公众号编辑器粘贴即可",
    copiedHtml: "已复制 HTML 代码到剪贴板",
    copiedRaw: "已复制 Markdown 原文到剪贴板",
    copyFailed: "复制失败",
    uploading: "正在上传图片…",
    uploaded: "已成功上传 {n} 张图片",
    uploadNone: "所有本地图片已就绪",
    confirmMissing: "有 {n} 张本地图片尚未上传至图床，直接复制在公众号中将无法显示。",
    confirmUploadFirst: "立即上传并复制",
    confirmCopyAnyway: "直接复制",
    cancel: "取消",
    settingsSaved: "图床设置已保存",
    settingsTestOk: "R2 存储桶连接成功！",
    docDeleted: "已删除文档",
    secretKeep: "已配置 (留空保持不变)",
    secretEmpty: "未配置 Secret",
    wordCount: "{n} 字",
    readTime: "约 {n} 分钟",
    imageCount: "{n} 张图"
  },
  en: {
    noDocument: "No document",
    theme: "Theme",
    upload: "Upload",
    copy: "Copy",
    copyWechat: "Copy for WeChat Official Account",
    copyHtml: "Copy HTML Code",
    copyRaw: "Copy Raw Markdown",
    documents: "Documents",
    openFile: "Import .md",
    loadSample: "Load Sample Demo",
    emptyTitle: "Markdown WeChat Preview",
    emptyBody: "Ask Agent in chat to preview an article, or open a local Markdown file.",
    openFile2: "Open local .md file",
    r2Title: "Cloudflare R2 Image Hosting",
    r2Hint: "Local images are uploaded to R2 and swapped for public URLs at copy time only; Markdown source stays local.",
    endpoint: "Endpoint (optional, any S3)",
    secret: "Secret Access Key (write-only)",
    publicBase: "Public Base URL",
    save: "Save Settings",
    test: "Test Connection",
    back: "Back",
    delete: "Delete",
    copied: "Copied - ready to paste into WeChat editor",
    copiedHtml: "HTML code copied to clipboard",
    copiedRaw: "Raw Markdown copied to clipboard",
    copyFailed: "Copy failed",
    uploading: "Uploading images…",
    uploaded: "Uploaded {n} image(s)",
    uploadNone: "All images are ready",
    confirmMissing: "{n} local image(s) not uploaded. WeChat cannot display them after copy.",
    confirmUploadFirst: "Upload and Copy",
    confirmCopyAnyway: "Copy Anyway",
    cancel: "Cancel",
    settingsSaved: "Settings saved",
    settingsTestOk: "R2 Connection OK!",
    docDeleted: "Document deleted",
    secretKeep: "Configured (leave empty to keep)",
    secretEmpty: "Not configured",
    wordCount: "{n} words",
    readTime: "~{n} min read",
    imageCount: "{n} image(s)"
  }
};

const params = new URLSearchParams(location.search);
const locale = String(params.get("locale") ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en";
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const pendingDeepLink = params.get("path") ?? "";
const t = STRINGS[locale];
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
document.documentElement.dataset.theme = appearance;

/** Short display names for the theme trigger button (menu items carry their own). */
const THEME_TRIGGER_LABELS = {
  "momo-paper": locale === "zh" ? "暖米书卷" : "Momo Paper",
  vercel: locale === "zh" ? "极简黑白" : "Vercel Geist",
  macaron: locale === "zh" ? "甜彩微排" : "Macaron",
  "geek-mint": locale === "zh" ? "极客薄荷" : "Geek Mint",
  "warm-amber": locale === "zh" ? "暖橙知秋" : "Warm Amber"
};

// - State -

const state = {
  documents: [],
  docId: null,
  document: null,
  assets: [],
  imageCache: new Map(),
  themeId: DEFAULT_THEME_ID,
  view: "preview"
};

const el = {
  backdrop: document.getElementById("backdrop"),
  docTrigger: document.getElementById("doc-trigger"),
  docTitle: document.getElementById("doc-title"),
  docMenu: document.getElementById("doc-menu"),
  docList: document.getElementById("doc-list"),
  docCountBadge: document.getElementById("doc-count-badge"),
  themeDropdownWrap: document.getElementById("theme-dropdown-wrap"),
  themeTrigger: document.getElementById("theme-trigger"),
  themeMenu: document.getElementById("theme-menu"),
  themeLabel: document.getElementById("theme-trigger-label"),
  themeSwatch: document.getElementById("theme-swatch"),
  themeChoices: [...document.querySelectorAll(".theme-choice")],
  uploadBtn: document.getElementById("upload-btn"),
  uploadBadge: document.getElementById("upload-badge"),
  copyDropdownWrap: document.getElementById("copy-dropdown-wrap"),
  copyBtn: document.getElementById("copy-btn"),
  copyMenu: document.getElementById("copy-menu"),
  menuCopyWechat: document.getElementById("menu-copy-wechat"),
  menuCopyHtml: document.getElementById("menu-copy-html"),
  menuCopyMd: document.getElementById("menu-copy-md"),
  settingsBtn: document.getElementById("settings-btn"),
  toast: document.getElementById("status"),
  toastText: document.getElementById("status-text"),
  paperWrap: document.getElementById("paper-wrap"),
  articleContainer: document.getElementById("article-container"),
  paper: document.getElementById("paper"),
  empty: document.getElementById("empty"),
  docStats: document.getElementById("doc-stats"),
  statWords: document.getElementById("stat-words"),
  statReadTime: document.getElementById("stat-read-time"),
  statImages: document.getElementById("stat-images"),
  settings: document.getElementById("settings"),
  dialog: document.getElementById("dialog"),
  dialogText: document.getElementById("dialog-text"),
  dialogActions: document.getElementById("dialog-actions"),
  dialogBackdrop: document.getElementById("dialog-backdrop"),
  fileInput: document.getElementById("file-input"),
  openFileBtn: document.getElementById("open-file-btn"),
  emptyOpenBtn: document.getElementById("empty-open-btn"),
  emptySampleBtn: document.getElementById("empty-sample-btn"),
  settingsSave: document.getElementById("settings-save"),
  settingsTest: document.getElementById("settings-test"),
  settingsBack: document.getElementById("settings-back")
};

// - Localization Pass -

document.querySelectorAll("[data-i18n]").forEach((node) => {
  const key = node.getAttribute("data-i18n");
  if (t[key]) node.textContent = t[key];
});

// - API Client -

let halted = false;
async function api(path, init) {
  const response = await fetch(`./api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) }
  });
  if (response.status === 403) {
    halted = true;
    showToast(locale === "zh" ? "小程序已被禁用" : "Mini App disabled.", "error");
    throw new Error("disabled");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.error ?? `Request failed (${response.status})`);
  }
  return response.json();
}

let toastTimer = null;
function showToast(message, tone = "info") {
  if (!message) {
    el.toast.hidden = true;
    return;
  }
  el.toast.hidden = false;
  el.toast.dataset.tone = tone;
  el.toastText.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 3500);
}

// - Popovers / Dropdowns helper -

function closeAllPopovers() {
  el.docMenu.hidden = true;
  el.docTrigger.setAttribute("aria-expanded", "false");
  el.copyMenu.hidden = true;
  el.copyDropdownWrap.classList.remove("open");
  el.copyBtn.setAttribute("aria-expanded", "false");
  el.themeMenu.hidden = true;
  el.themeDropdownWrap.classList.remove("open");
  el.themeTrigger.setAttribute("aria-expanded", "false");
  el.backdrop.hidden = true;
}

el.backdrop.addEventListener("click", closeAllPopovers);

// - Documents Management -

async function refreshDocuments() {
  const data = await api("/documents");
  state.documents = data.documents;
  el.docCountBadge.textContent = String(state.documents.length);
  renderDocMenu();

  if (!state.docId && state.documents.length > 0) {
    await openDocument(state.documents[0].id);
  } else if (state.docId && !state.documents.some((d) => d.id === state.docId)) {
    if (state.documents.length > 0) await openDocument(state.documents[0].id);
    else clearDocument();
  } else {
    renderChrome();
  }
}

async function openDocument(id) {
  const data = await api(`/documents/${encodeURIComponent(id)}`);
  state.docId = id;
  state.document = data.document;
  state.assets = data.assets;
  state.imageCache.clear();
  renderChrome();
  await renderPreview();
}

function clearDocument() {
  state.docId = null;
  state.document = null;
  state.assets = [];
  state.imageCache.clear();
  renderChrome();
  renderPreview();
}

async function deleteDocument(id) {
  await api(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (state.docId === id) clearDocument();
  await refreshDocuments();
  showToast(t.docDeleted, "success");
}

// - Image Resolution -

function isRemoteRef(ref) {
  return /^(https?:)?\/\//i.test(ref) || ref.startsWith("data:");
}

function assetByRef(ref) {
  return state.assets.find((asset) => asset.ref === ref) ?? null;
}

async function previewSrc(ref) {
  if (state.imageCache.has(ref)) return state.imageCache.get(ref);
  if (isRemoteRef(ref)) {
    try {
      const data = await api(`/proxy-image?url=${encodeURIComponent(ref)}`);
      state.imageCache.set(ref, data.dataUri);
      return data.dataUri;
    } catch {
      return null;
    }
  }
  const asset = assetByRef(ref);
  if (!asset || asset.remote) return null;
  try {
    const data = await api(`/documents/${encodeURIComponent(state.docId)}/assets/${encodeURIComponent(asset.id)}`);
    state.imageCache.set(ref, data.dataUri);
    return data.dataUri;
  } catch {
    return null;
  }
}

function copySrcSync(ref, cache) {
  if (isRemoteRef(ref)) return ref;
  const asset = assetByRef(ref);
  if (asset?.uploadedUrl) return asset.uploadedUrl;
  return cache.get(ref) ?? null;
}

// - Render Pipeline -

let renderToken = 0;
async function renderPreview() {
  const hasDoc = Boolean(state.document);
  el.articleContainer.hidden = !hasDoc;
  el.empty.hidden = hasDoc;
  if (el.docStats) el.docStats.hidden = !hasDoc;
  if (!hasDoc) return;

  // Compute stats
  const text = state.document.markdown;
  const words = (text.match(/[一-龥]|\b[a-zA-Z0-9_-]+\b/g) || []).length;
  const readTime = Math.max(1, Math.ceil(words / 300));
  if (el.statWords) el.statWords.textContent = t.wordCount.replace("{n}", String(words));
  if (el.statReadTime) el.statReadTime.textContent = t.readTime.replace("{n}", String(readTime));
  if (el.statImages) el.statImages.textContent = t.imageCount.replace("{n}", String(state.assets.length));

  // Prewarm images
  await Promise.all(state.assets.map((asset) => previewSrc(asset.ref)));

  const token = ++renderToken;
  const html = renderThemedHtml(state.document.markdown, state.themeId, {
    hostElement: el.paper,
    resolveImage: (src) => state.imageCache.get(src) ?? null
  });
  if (token !== renderToken) return;
  el.paper.innerHTML = html;
}

function renderForCopy() {
  return renderThemedHtml(state.document.markdown, state.themeId, {
    hostElement: document.createElement("div"),
    resolveImage: (src) => copySrcSync(src, state.imageCache)
  });
}

function renderChrome() {
  const hasDoc = Boolean(state.document);
  el.docTitle.textContent = state.document?.title ?? t.noDocument;

  const pending = state.assets.filter((a) => !a.remote && !a.uploadedUrl).length;
  el.uploadBtn.disabled = !hasDoc || pending === 0;
  if (pending > 0) {
    el.uploadBadge.hidden = false;
    el.uploadBadge.textContent = String(pending);
  } else {
    el.uploadBadge.hidden = true;
  }
  el.copyBtn.disabled = !hasDoc;

  // Active theme: trigger label + swatch, and the selected menu entry
  el.themeSwatch.classList.toggle("momo-swatch", state.themeId === "momo-paper");
  el.themeSwatch.classList.toggle("vercel-swatch", state.themeId === "vercel");
  el.themeSwatch.classList.toggle("macaron-swatch", state.themeId === "macaron");
  el.themeSwatch.classList.toggle("geek-mint-swatch", state.themeId === "geek-mint");
  el.themeSwatch.classList.toggle("warm-amber-swatch", state.themeId === "warm-amber");
  el.themeLabel.textContent = THEME_TRIGGER_LABELS[state.themeId] ?? state.themeId;
  for (const choice of el.themeChoices) {
    choice.classList.toggle("selected", choice.dataset.theme === state.themeId);
  }
}

function renderDocMenu() {
  el.docList.textContent = "";
  if (state.documents.length === 0) {
    const emptyLi = document.createElement("li");
    emptyLi.className = "doc-item";
    emptyLi.style.justifyContent = "center";
    emptyLi.style.color = "var(--md-on-surface-variant)";
    emptyLi.style.fontSize = "12px";
    emptyLi.textContent = "暂无缓存文档";
    el.docList.append(emptyLi);
    return;
  }

  for (const doc of state.documents) {
    const li = document.createElement("li");
    li.className = "doc-item" + (doc.id === state.docId ? " active" : "");

    const label = document.createElement("span");
    label.className = "doc-item-title";
    label.textContent = doc.title;

    const meta = document.createElement("span");
    meta.className = "doc-item-meta";
    if (doc.localCount > 0) {
      meta.textContent = `${doc.uploadedCount}/${doc.localCount} 图`;
    }

    const remove = document.createElement("button");
    remove.className = "doc-item-delete";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t.delete);
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      void deleteDocument(doc.id);
    });

    li.append(label, meta, remove);
    li.addEventListener("click", () => {
      closeAllPopovers();
      void openDocument(doc.id);
    });
    el.docList.append(li);
  }
}

// - Copy Actions -

async function copyWeChatRichText() {
  closeAllPopovers();
  if (!state.document) return;

  const missing = state.assets.filter((a) => !a.remote && !a.uploadedUrl);
  if (missing.length > 0) {
    const choice = await confirmDialog(
      t.confirmMissing.replace("{n}", String(missing.length)),
      [[t.confirmUploadFirst, "primary"], [t.confirmCopyAnyway, ""], [t.cancel, ""]]
    );
    if (choice === t.confirmUploadFirst) {
      showToast(t.uploading);
      await uploadPending();
      const stillMissing = state.assets.filter((a) => !a.remote && !a.uploadedUrl);
      if (stillMissing.length > 0) {
        showToast(stillMissing.map((a) => a.ref).join(", "), "error");
        return;
      }
    } else if (choice === t.cancel) {
      return;
    }
  }

  const html = renderForCopy();
  const ok = await writeHtmlToClipboard(html);
  showToast(ok ? t.copied : t.copyFailed, ok ? "success" : "error");
}

async function copyHtmlCode() {
  closeAllPopovers();
  if (!state.document) return;
  const html = renderForCopy();
  const ok = await writeTextToClipboard(html);
  showToast(ok ? t.copiedHtml : t.copyFailed, ok ? "success" : "error");
}

async function copyRawMarkdown() {
  closeAllPopovers();
  if (!state.document) return;
  const ok = await writeTextToClipboard(state.document.markdown);
  showToast(ok ? t.copiedRaw : t.copyFailed, ok ? "success" : "error");
}

async function writeHtmlToClipboard(html) {
  const textValue = stripHtml(html);
  try {
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([textValue], { type: "text/plain" })
        })
      ]);
      return true;
    }
  } catch {
    // fallback
  }

  try {
    const holder = document.createElement("div");
    holder.setAttribute("contenteditable", "true");
    holder.style.position = "fixed";
    holder.style.left = "-99999px";
    holder.style.top = "0";
    holder.innerHTML = html;
    document.body.appendChild(holder);
    try {
      const range = document.createRange();
      range.selectNodeContents(holder);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const ok = document.execCommand("copy");
      selection?.removeAllRanges();
      return ok;
    } finally {
      holder.remove();
    }
  } catch {
    return false;
  }
}

async function writeTextToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallback
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-99999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    textarea.remove();
    return ok;
  } catch {
    return false;
  }
}

function stripHtml(html) {
  const scratch = document.createElement("div");
  scratch.innerHTML = html;
  return scratch.textContent || "";
}

// - Upload -

async function uploadPending() {
  if (!state.docId) return;
  showToast(t.uploading);
  const result = await api(`/documents/${encodeURIComponent(state.docId)}/upload`, {
    method: "POST",
    body: "{}"
  });
  const data = await api(`/documents/${encodeURIComponent(state.docId)}`);
  state.assets = data.assets;
  renderChrome();
  await renderPreview();
  if (result.failures?.length > 0) {
    showToast(result.failures.map((f) => `${f.ref}: ${f.error}`).join("; "), "error");
    return;
  }
  const count = result.uploaded?.length ?? 0;
  showToast(count > 0 ? t.uploaded.replace("{n}", String(count)) : t.uploadNone, count > 0 ? "success" : "info");
}

// - Dialog Modal -

function confirmDialog(message, buttons) {
  return new Promise((resolve) => {
    el.dialogText.textContent = message;
    el.dialogActions.textContent = "";
    for (const [label, variant] of buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = variant === "primary" ? "btn btn-primary" : "btn btn-secondary";
      button.textContent = label;
      button.addEventListener("click", () => {
        close();
        resolve(label);
      });
      el.dialogActions.append(button);
    }
    const onBackdrop = () => {
      close();
      resolve(t.cancel);
    };
    function close() {
      el.dialog.hidden = true;
      el.dialogBackdrop.hidden = true;
      el.dialogBackdrop.removeEventListener("click", onBackdrop);
    }
    el.dialogBackdrop.addEventListener("click", onBackdrop);
    el.dialog.hidden = false;
    el.dialogBackdrop.hidden = false;
  });
}

// - Settings -

const settingInputs = {
  accountId: document.getElementById("set-account"),
  bucket: document.getElementById("set-bucket"),
  endpoint: document.getElementById("set-endpoint"),
  region: document.getElementById("set-region"),
  accessKeyId: document.getElementById("set-key"),
  secretAccessKey: document.getElementById("set-secret"),
  publicBaseUrl: document.getElementById("set-public"),
  keyPrefix: document.getElementById("set-prefix")
};

async function loadSettings() {
  const data = await api("/settings");
  const settings = data.settings;
  let savedLocalTheme = null;
  try {
    savedLocalTheme = localStorage.getItem("md_preview_theme");
  } catch {}
  state.themeId = THEMES[settings.theme]
    ? settings.theme
    : (THEMES[savedLocalTheme] ? savedLocalTheme : DEFAULT_THEME_ID);
  renderChrome();

  for (const [key, input] of Object.entries(settingInputs)) {
    if (key === "secretAccessKey") {
      input.value = "";
      input.placeholder = settings.secretSet ? t.secretKeep : t.secretEmpty;
    } else {
      input.value = settings[key] ?? "";
    }
  }
}

async function saveSettings() {
  const patch = { theme: state.themeId };
  for (const [key, input] of Object.entries(settingInputs)) {
    if (key === "secretAccessKey" && !input.value) continue;
    patch[key] = input.value;
  }
  await api("/settings", { method: "PUT", body: JSON.stringify(patch) });
  await loadSettings();
  showToast(t.settingsSaved, "success");
}

async function testSettings() {
  showToast(t.test + "…");
  try {
    await api("/settings/test", { method: "POST", body: "{}" });
    showToast(t.settingsTestOk, "success");
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : String(cause), "error");
  }
}

function showView(view) {
  closeAllPopovers();
  state.view = view;
  el.settings.hidden = view !== "settings";
  el.paperWrap.hidden = view !== "preview";
  if (el.themeDropdownWrap) {
    el.themeDropdownWrap.hidden = view !== "preview";
  }
}

// - Event Listeners -

// Document menu toggle
el.docTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = el.docMenu.hidden;
  closeAllPopovers();
  if (willOpen) {
    renderDocMenu();
    el.docMenu.hidden = false;
    el.docTrigger.setAttribute("aria-expanded", "true");
    el.backdrop.hidden = false;
  }
});

// Copy Dropdown toggle
el.copyBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = el.copyMenu.hidden;
  closeAllPopovers();
  if (willOpen) {
    el.copyMenu.hidden = false;
    el.copyDropdownWrap.classList.add("open");
    el.copyBtn.setAttribute("aria-expanded", "true");
    el.backdrop.hidden = false;
  }
});

// Copy Menu Items
el.menuCopyWechat.addEventListener("click", () => void copyWeChatRichText());
el.menuCopyHtml.addEventListener("click", () => void copyHtmlCode());
el.menuCopyMd.addEventListener("click", () => void copyRawMarkdown());

// Theme dropdown toggle
el.themeTrigger.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = el.themeMenu.hidden;
  closeAllPopovers();
  if (willOpen) {
    el.themeMenu.hidden = false;
    el.themeDropdownWrap.classList.add("open");
    el.themeTrigger.setAttribute("aria-expanded", "true");
    el.backdrop.hidden = false;
  }
});

const SAMPLE_MARKDOWN = `# 甜彩微排：公众号全功能排版示例

这是一份可以直接检查排版效果的**全功能演示文章**。无论是清新明快的马卡龙甜彩风格，还是沉稳的暖米书卷与极简黑白，都能一键生成优美舒展的微信内联排版。

排版不是替内容化妆，而是为长文建立呼吸感与视觉节奏，让读者在指尖滑动时自然捕捉到关键信息。

## 01 先把文章结构搭清楚

### 核心论点梳理

好的排版能够让复杂概念变得井然有序：

- **标题与章节**：负责提示“这一小节在讲什么”，建立全篇结构骨架
- **引用金句**：让重要论断与灵感拥有视觉停顿
- **代码与表格**：承载高密度结构化信息，一目了然

> “让每一份好内容，都有一身好排版。” —— 优秀的视觉呈现，能够成倍放大文字的力量。

### 多级列表与步骤

1. 在 Molibot 中让 Agent 生成或导入 Markdown 文章
2. 自由切换暖米书卷、极简黑白或马卡龙甜彩主题
3. 点击右上角「复制」，直接在微信公众号后台 Cmd/Ctrl + V 粘贴

- 支持嵌套列表结构：
  - 子项目一：自动悬挂缩进与对齐
  - 子项目二：多层级圆点与序号配色

## 02 代码与表格各司其职

### macOS 风格代码块

\`\`\`javascript
// Molibot Mini App · MD Preview
function publishArticle(article) {
  return {
    title: article.title,
    theme: "macaron",
    status: "ready_to_publish",
    copied: true
  };
}
\`\`\`

\`\`\`bash
# 复制排版并快速发布
npm run build
molibot preview article.md
\`\`\`

### 数据表格示例

| 排版元素 | 适合表达 | 默认视觉 |
|---|---|---|
| 章节标题 | 结构划分 | 居中装饰下划线 |
| 引用模块 | 金句观点 | 柔和微色底卡片 |
| 代码围栏 | 程序指令 | macOS 窗口圆点 |
| 行内代码 | 文件名/命令 | 薄荷甜彩胶囊 |

---

最后，点击右上角的「复制到微信公众号」，然后在微信公众号网页编辑器中直接粘贴即可！`;

// Theme menu choices
el.themeChoices.forEach((choice) => {
  choice.addEventListener("click", () => {
    const id = choice.dataset.theme;
    if (!THEMES[id] || state.themeId === id) return;
    closeAllPopovers();
    state.themeId = id;
    try {
      localStorage.setItem("md_preview_theme", id);
    } catch {}
    renderChrome();
    void renderPreview();
    void api("/settings", { method: "PUT", body: JSON.stringify({ theme: state.themeId }) });
  });
});

// Actions
el.uploadBtn.addEventListener("click", () => void uploadPending().catch((c) => showToast(String(c), "error")));
el.settingsBtn.addEventListener("click", () => showView(state.view === "settings" ? "preview" : "settings"));
el.settingsBack.addEventListener("click", () => showView("preview"));
el.settingsSave.addEventListener("click", () => void saveSettings().catch((c) => showToast(String(c), "error")));
el.settingsTest.addEventListener("click", () => void testSettings());

function pickMarkdownFile() {
  closeAllPopovers();
  el.fileInput.click();
}
el.openFileBtn.addEventListener("click", pickMarkdownFile);
el.emptyOpenBtn.addEventListener("click", pickMarkdownFile);
if (el.emptySampleBtn) {
  el.emptySampleBtn.addEventListener("click", async () => {
    try {
      const data = await api("/documents", {
        method: "POST",
        body: JSON.stringify({
          markdown: SAMPLE_MARKDOWN,
          title: "甜彩微排排版示例"
        })
      });
      await refreshDocuments();
      await openDocument(data.document.documentId);
      showToast("已加载排版示例", "success");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : String(cause), "error");
    }
  });
}

el.fileInput.addEventListener("change", async () => {
  const file = el.fileInput.files?.[0];
  el.fileInput.value = "";
  if (!file) return;
  try {
    const markdown = await file.text();
    const data = await api("/documents", {
      method: "POST",
      body: JSON.stringify({
        markdown,
        title: file.name.replace(/\.(md|markdown)$/i, "")
      })
    });
    await refreshDocuments();
    await openDocument(data.document.documentId);
    showToast(`已加载文档 "${file.name}"`, "success");
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : String(cause), "error");
  }
});

// Window focus refresh
window.addEventListener("focus", () => {
  if (!halted) void refreshDocuments().catch(() => {});
});

// - Boot -

(async function boot() {
  try {
    await loadSettings();
    await refreshDocuments();
    if (pendingDeepLink.startsWith("doc/")) {
      const id = decodeURIComponent(pendingDeepLink.slice("doc/".length));
      if (id && id !== state.docId) await openDocument(id);
    }
    showView("preview");
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : String(cause), "error");
  }
})();
