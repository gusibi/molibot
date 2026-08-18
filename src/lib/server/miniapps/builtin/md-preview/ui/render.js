import { Marked, Renderer } from "./vendor/marked.esm.js";
import { THEMES } from "./themes.js";

/**
 * Markdown -> 公众号 HTML 渲染管线,移植自参考实现(Obsidian markdown-to-mp):
 *
 * 1. marked 解析(含 Prism 代码高亮,产出带 token class 的 <span>);
 * 2. walk DOM,把主题样式内联到每个元素,并给列表注入真实 marker 元素
 *    (公众号丢弃 <style>/class/伪元素);
 * 3. 图片 src 由调用方在渲染前替换好(本地图 -> data: 预览 / R2 URL 复制)。
 *
 * 预览与复制共用同一份输出:预览 DOM 即复制内容,所见即所得。
 */

// - Markdown 解析 - -------------------------------------------------------------

const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function safeHref(value) {
  try {
    const url = new URL(String(value));
    return SAFE_PROTOCOLS.has(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

/** 代码围栏语言 -> Prism grammar;找不到时按纯文本处理,不报错。 */
function highlightCode(code, lang) {
  const prism = window.Prism;
  const name = prism ? prism.languages[lang || ""] : null;
  if (prism && name) return prism.highlight(code, name, lang);
  return escapeHtml(code);
}

const renderer = new Renderer();

// 输入是 Agent/用户内容:原始 HTML 不进预览(预览即复制内容,放进剪贴板的
// 必须是这里生成、全部内联的标记),链接只保留显式 web/mail 协议。
renderer.html = () => "";
renderer.code = ({ text, lang }) =>
  `<pre><code>${highlightCode(String(text ?? ""), String(lang ?? "").trim().toLowerCase())}</code></pre>`;
renderer.image = ({ href, text }) =>
  `<img src="${escapeHtml(String(href ?? ""))}" alt="${escapeHtml(String(text ?? ""))}" />`;
renderer.link = function ({ href, title, tokens }) {
  const label = this.parser.parseInline(tokens);
  const safe = safeHref(href);
  if (!safe) return label;
  return `<a href="${escapeHtml(safe)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${label}</a>`;
};

const parser = new Marked({ gfm: true, breaks: false, renderer });

export function renderMarkdown(source) {
  return parser.parse(String(source ?? ""), { async: false });
}

// - 内联样式 - -------------------------------------------------------------------

const TAG_TO_KEY = {
  H1: "h1", H2: "h2", H3: "h3", H4: "h4", H5: "h5", H6: "h6",
  P: "p", A: "a", STRONG: "strong", B: "strong", EM: "em", I: "em",
  DEL: "del", S: "del", BLOCKQUOTE: "blockquote", HR: "hr", IMG: "img",
  FIGCAPTION: "figcaption", TABLE: "table", TH: "th", TD: "td"
};

/** Prism token class -> 主题色,映射顺序与参考实现一致(先匹配先赢)。 */
function tokenColor(classList, colors) {
  const has = (name) => classList.contains(name);
  if (has("comment") || has("prolog") || has("doctype") || has("cdata")) return colors.comment;
  if (has("keyword") || has("boolean") || has("important") || has("atrule") || has("selector")) return colors.keyword;
  if (has("string") || has("char") || has("attr-value") || has("regex") || has("url") || has("inserted")) return colors.string;
  if (has("number") || has("constant") || has("symbol")) return colors.number;
  if (has("function") || has("function-name")) return colors.function;
  if (has("class-name") || has("builtin") || has("namespace")) return colors.className;
  if (has("operator") || has("entity")) return colors.operator;
  if (has("punctuation")) return colors.punctuation;
  if (has("variable") || has("deleted")) return colors.variable;
  if (has("property") || has("attr-name") || has("tag") || has("property-access")) return colors.property;
  return null;
}

function styleCodeBlock(pre, theme) {
  const colors = theme.code;
  if (theme.macCode) {
    const wrapper = document.createElement("section");
    wrapper.setAttribute(
      "style",
      `border:1px solid ${colors.border};background:${colors.background};border-radius:8px;margin:22px 0;overflow:hidden;box-shadow:0 3px 12px rgba(56,163,165,0.06);`
    );
    const macBar = document.createElement("div");
    macBar.setAttribute(
      "style",
      `background:#EBF4F0;border-bottom:1px solid ${colors.border};height:28px;line-height:28px;padding:0 12px;box-sizing:border-box;`
    );
    macBar.innerHTML = `<span style="display:inline-block;vertical-align:middle;"><span style="width:9px;height:9px;border-radius:50%;background:#FF9AA2;display:inline-block;margin-right:5px;vertical-align:middle;"></span><span style="width:9px;height:9px;border-radius:50%;background:#FFE29A;display:inline-block;margin-right:5px;vertical-align:middle;"></span><span style="width:9px;height:9px;border-radius:50%;background:#B5EAD7;display:inline-block;vertical-align:middle;"></span></span><span style="float:right;font-size:10px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;color:#7B9E94;font-weight:700;letter-spacing:1px;line-height:28px;">CODE</span>`;

    pre.setAttribute(
      "style",
      `${theme.styles.pre}background:${colors.background};border:none;color:${colors.text};`
    );
    pre.querySelectorAll("code").forEach((code) => {
      code.setAttribute(
        "style",
        `background:transparent;padding:0;color:${colors.text};font-family:inherit;font-size:inherit;`
      );
    });
    pre.querySelectorAll("span").forEach((span) => {
      const color = tokenColor(span.classList, colors);
      span.setAttribute("style", color ? `color:${color};` : `color:${colors.text};`);
      span.removeAttribute("class");
    });

    pre.parentNode?.replaceChild(wrapper, pre);
    wrapper.appendChild(macBar);
    wrapper.appendChild(pre);
    return;
  }

  pre.setAttribute(
    "style",
    `${theme.styles.pre}background:${colors.background};border:1px solid ${colors.border};color:${colors.text};`
  );
  pre.querySelectorAll("code").forEach((code) => {
    code.setAttribute(
      "style",
      `background:transparent;padding:0;color:${colors.text};font-family:inherit;font-size:inherit;`
    );
  });
  pre.querySelectorAll("span").forEach((span) => {
    const color = tokenColor(span.classList, colors);
    span.setAttribute("style", color ? `color:${color};` : `color:${colors.text};`);
    span.removeAttribute("class");
  });
}

function applyStyles(root, theme, resolveImage) {
  const colors = theme.code;
  const walk = (element) => {
    const tag = element.tagName;

    if (tag === "PRE") {
      styleCodeBlock(element, theme);
      return;
    }
    if (tag === "CODE") {
      element.setAttribute(
        "style",
        `background:${colors.inlineBg};color:${colors.inlineText};padding:2px 6px;border-radius:5px;border:1px solid ${colors.border};font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:0.92em;`
      );
      element.removeAttribute("class");
      return;
    }

    const key = TAG_TO_KEY[tag];
    if (key) {
      if (tag === "IMG") {
        const resolved = resolveImage?.(element.getAttribute("src") || "");
        if (resolved) element.setAttribute("src", resolved);
      }
      element.setAttribute("style", theme.styles[key]);

      if (tag === "H1" && theme.decorateH1) {
        const bar = document.createElement("div");
        bar.setAttribute(
          "style",
          "width:40px;height:4px;background:#FF9AA2;border-radius:2px;margin:10px auto 0;"
        );
        element.appendChild(bar);
        element.removeAttribute("class");
        return;
      }
      if (tag === "H2" && theme.decorateH2) {
        const titleHtml = element.innerHTML;
        const innerSpan = document.createElement("span");
        innerSpan.setAttribute("style", "display:inline-block;padding:0 8px 4px;border-bottom:3px solid #FF9AA2;");
        innerSpan.innerHTML = titleHtml;
        element.innerHTML = "";
        element.appendChild(innerSpan);
        element.removeAttribute("class");
        return;
      }
    } else if (tag === "SPAN" || tag === "DIV" || tag === "SECTION") {
      element.removeAttribute("style");
    }
    element.removeAttribute("class");

    for (const child of Array.from(element.children)) walk(child);
  };
  for (const child of Array.from(root.children)) walk(child);
}

// - 列表 marker 注入 - -------------------------------------------------------------

function listDepth(list, root) {
  let depth = 0;
  let parent = list.parentElement;
  while (parent && parent !== root) {
    if (parent.tagName === "UL" || parent.tagName === "OL") depth += 1;
    parent = parent.parentElement;
  }
  return depth;
}

function isListBlockBoundary(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  return ["UL", "OL", "P", "DIV", "SECTION", "BLOCKQUOTE", "PRE", "TABLE"].includes(node.tagName);
}

/**
 * 重排列表:清掉原生 marker,给每个 <li> 注入内联样式的 marker,用
 * text-indent 悬挂缩进保证换行对齐。公众号会丢弃 ::marker / 伪元素,所以
 * 必须注入真实元素;marker 与行内正文包进同一个 <section>,防止公众号把
 * 规范化后的 DOM 拆成两行。
 */
export function styleLists(root, theme) {
  const listStyle = theme.list;
  root.querySelectorAll("ul, ol").forEach((listNode) => {
    const list = listNode;
    const ordered = list.tagName === "OL";
    list.setAttribute("style", ordered ? listStyle.ol : listStyle.ul);

    const level = listDepth(list, root);
    let index = ordered ? parseInt(list.getAttribute("start") || "1", 10) || 1 : 1;

    for (const child of Array.from(list.children)) {
      const li = child;
      if (li.tagName !== "LI") continue;

      // 任务列表(直接子级含 checkbox):不注入 marker,保留勾选框。
      if (li.querySelector(":scope > input[type=checkbox]")) {
        li.setAttribute("style", listStyle.liTask);
        continue;
      }
      li.setAttribute("style", listStyle.li);

      const marker = document.createElement("span");
      if (ordered) {
        marker.setAttribute(
          "style",
          `${listStyle.marker}${listStyle.orderedExtra}color:${listStyle.orderedColor};`
        );
        marker.textContent = `${index}.`;
        index += 1;
      } else {
        const tier = Math.min(level, listStyle.bullets.length - 1);
        marker.setAttribute(
          "style",
          `${listStyle.marker}font-size:${listStyle.bulletSize};color:${listStyle.bulletColors[tier]};`
        );
        marker.textContent = listStyle.bullets[tier];
      }

      const lineNodes = [];
      for (const node of Array.from(li.childNodes)) {
        if (isListBlockBoundary(node)) break;
        lineNodes.push(node);
      }
      const line = document.createElement("section");
      li.insertBefore(line, li.firstChild);
      line.appendChild(marker);
      for (const node of lineNodes) line.appendChild(node);
    }
  });
}

// - 组装 - -------------------------------------------------------------------------

/**
 * 把 Markdown 渲染为主题化、全内联样式的 HTML 片段。`resolveImage(ref)` 在
 * 遇到每个 <img> 时被调用,返回替换后的 src(本地图 -> data: 预览 / R2 URL
 * 复制 / 远程图代理),返回空值则保留原样。返回 <section> 包裹的完整字符串,
 * 可直接作为 text/html 写入剪贴板。
 */
export function renderThemedHtml(markdown, themeId, { hostElement, resolveImage }) {
  const theme = THEMES[themeId] ?? THEMES["momo-paper"];
  const sandbox = hostElement;
  sandbox.innerHTML = renderMarkdown(markdown);
  applyStyles(sandbox, theme, resolveImage);
  styleLists(sandbox, theme);

  const section = document.createElement("section");
  section.setAttribute("style", theme.container);
  section.innerHTML = sandbox.innerHTML;
  return section.outerHTML;
}
