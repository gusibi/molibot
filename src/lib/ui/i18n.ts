import { browser } from "$app/environment";
import { writable } from "svelte/store";

export type LocaleKey = "zh-CN" | "en-US";

const LS_LOCALE = "molibot-web-locale";

export const locale = writable<LocaleKey>("zh-CN");

function normalizeLocale(value: unknown): LocaleKey {
  return value === "en-US" ? "en-US" : "zh-CN";
}

function applyDocumentLocale(nextLocale: LocaleKey): void {
  if (!browser) return;
  document.documentElement.setAttribute("lang", nextLocale);
}

export function initLocale(): void {
  if (!browser) return;
  const stored = normalizeLocale(localStorage.getItem(LS_LOCALE));
  locale.set(stored);
  applyDocumentLocale(stored);
}

export function setLocale(nextLocale: LocaleKey): void {
  const normalized = normalizeLocale(nextLocale);
  locale.set(normalized);
  if (!browser) return;
  localStorage.setItem(LS_LOCALE, normalized);
  applyDocumentLocale(normalized);
}

const ZH_SETTINGS_TEXT: Record<string, string> = {
  "System": "跟随系统",
  "Light": "明色",
  "Dark": "暗色",
  "Open Chat": "打开聊天",
  "Back To Chat": "返回聊天",
  "Settings": "设置",
  "Configuration Workspace": "配置工作台",
  "Navigate Settings": "设置导航",
  "Overview": "总览",
  "AI Engine": "AI 引擎",
  "Routing & Prompt": "路由与提示词",
  "Providers & Models": "模型与提供方",
  "Usage Stats": "用量统计",
  "Model Error Logs": "模型报错记录",
  "MCP Servers": "MCP 服务",
  "ACP Targets": "ACP 目标",
  "Channels": "渠道",
  "Web Profiles": "Web 配置",
  "Telegram Bot": "Telegram 机器人",
  "WeChat Bot": "微信机器人",
  "Feishu Bot": "飞书机器人",
  "QQ Bot": "QQ 机器人",
  "Agent Data": "助手数据",
  "Agents": "Agents",
  "Memory": "记忆",
  "Memory Rejections": "记忆拒绝记录",
  "Skills": "技能",
  "Skill Drafts": "技能草稿",
  "Run History": "运行历史",
  "Tasks": "任务",
  "Plugins & Core": "插件与核心",
  "Refresh": "刷新",
  "Save": "保存",
  "Delete": "删除",
  "Edit": "编辑",
  "Cancel": "取消",
  "Search": "搜索",
  "Create": "创建",
  "Add": "添加",
  "Remove": "移除",
  "Enable": "启用",
  "Enabled": "已启用",
  "Disable": "禁用",
  "Disabled": "已禁用",
  "Loading": "加载中",
  "Loading...": "加载中...",
  "Saving...": "保存中...",
  "Save Settings": "保存设置",
  "Save Provider Settings": "保存提供方设置",
  "Save This Bot": "保存这个 Bot",
  "Save This Agent": "保存这个 Agent",
  "Save This Profile": "保存这个配置",
  "Current bot has unsaved changes.": "当前 Bot 有未保存变更。",
  "Current agent has unsaved changes.": "当前 Agent 有未保存变更。",
  "Current profile has unsaved changes.": "当前配置有未保存变更。",
  "Bots": "Bots",
  "Bot Configuration": "Bot 配置",
  "Bot ID": "Bot ID",
  "Bot Name": "Bot 名称",
  "Linked Agent": "绑定 Agent",
  "No agent (global fallback only)": "不绑定 Agent（只使用全局兜底）",
  "Bot token": "Bot Token",
  "App ID": "App ID",
  "App Secret": "App Secret",
  "Allowed chat IDs (comma-separated)": "允许的 chat ID（逗号分隔）",
  "Allowed user IDs (comma-separated)": "允许的用户 ID（逗号分隔）",
  "Bot Markdown Overrides": "Bot Markdown 覆盖文件",
  "Profile Configuration": "配置详情",
  "Profile ID": "配置 ID",
  "Profile Name": "配置名称",
  "Profile Markdown Overrides": "配置 Markdown 覆盖文件",
  "Agent List": "Agent 列表",
  "Agent Metadata": "Agent 元数据",
  "Agent ID": "Agent ID",
  "Agent Name": "Agent 名称",
  "Description": "描述",
  "Agent Markdown Files": "Agent Markdown 文件",
  "Enable this agent": "启用这个 Agent",
  "Enable this plugin instance": "启用这个插件实例",
  "Login QR Tool": "登录二维码工具",
  "Login Link": "登录链接",
  "API Base URL (optional)": "API Base URL（可选）",
  "Card Verification Token": "卡片回调校验 Token",
  "Card Encrypt Key": "卡片回调加密 Key",
  "Optional, for card callback security": "可选，用于卡片回调安全校验",
  "Optional, for encrypted callbacks": "可选，用于加密回调",
  "Global Switch": "全局开关",
  "Targets": "目标",
  "Target ID": "目标 ID",
  "Display Name": "显示名称",
  "Adapter": "适配器",
  "Command": "命令",
  "Args (one per line)": "参数（每行一个）",
  "Env (KEY=VALUE per line)": "环境变量（每行 KEY=VALUE）",
  "Working Directory Override": "工作目录覆盖",
  "Projects": "项目",
  "Project ID": "项目 ID",
  "Absolute Path": "绝对路径",
  "Default Approval Mode": "默认审批模式",
  "Allowed Targets": "允许目标",
  "Plugin Settings": "插件设置",
  "Memory backend": "记忆后端",
  "MCP JSON": "MCP JSON",
  "Parsed Servers": "已解析服务",
  "No parsed MCP servers.": "没有解析到 MCP 服务。",
  "Memory Management": "记忆管理",
  "Search memory content...": "搜索记忆内容...",
  "conflict": "冲突",
  "Search reason or content...": "搜索原因或内容...",
  "Total:": "总数：",
  "Add blocked:": "新增被拦截：",
  "Update blocked:": "更新被拦截：",
  "Data root:": "数据根目录：",
  "Global skills dir:": "全局技能目录：",
  "Global skills:": "全局技能：",
  "Chat skills:": "会话技能：",
  "Bot skills:": "Bot 技能：",
  "Global Skills": "全局技能",
  "Chat Skills": "会话技能",
  "Bot Skills": "Bot 技能",
  "Skill Search": "技能搜索",
  "Enable local search": "启用本地搜索",
  "Enable API search": "启用 API 搜索",
  "AI Provider": "AI 提供方",
  "No available provider": "没有可用提供方",
  "Model": "模型",
  "No available model": "没有可用模型",
  "Max Tokens": "最大 Token 数",
  "Temperature": "温度",
  "Timeout (ms)": "超时（毫秒）",
  "Min Confidence": "最低置信度",
  "Diagnostics": "诊断信息",
  "Draft Generation Rules": "草稿生成规则",
  "Enable automatic draft saving": "启用自动保存草稿",
  "Minimum Tool Calls": "最少工具调用次数",
  "Save draft when the run recovered from tool failures": "运行从工具失败中恢复时保存草稿",
  "Save draft when the run needed model retries or fallback": "运行发生模型重试或 fallback 时保存草稿",
  "Workflow Skill Path": "工作流技能路径",
  "Skill Name": "技能名称",
  "Promote Scope": "提升范围",
  "Chat": "会话",
  "Bot": "Bot",
  "Global": "全局",
  "Draft Content": "草稿内容",
  "Total": "总数",
  "Bots:": "Bots：",
  "Chats:": "会话：",
  "Success:": "成功：",
  "Partial:": "部分成功：",
  "Failed:": "失败：",
  "Summary": "摘要",
  "Output Snapshot": "输出快照",
  "Tools": "工具",
  "Failures": "失败项",
  "Explicit Skills": "显式技能",
  "Fallback": "Fallback",
  "Total tasks:": "任务总数：",
  "Workspace tasks:": "工作区任务：",
  "Chat scratch tasks:": "会话 scratch 任务：",
  "Pending:": "待执行：",
  "Running:": "运行中：",
  "Completed:": "已完成：",
  "Skipped:": "已跳过：",
  "Error:": "错误：",
  "Telegram:": "Telegram：",
  "Feishu:": "飞书：",
  "QQ:": "QQ：",
  "WeChat:": "微信：",
  "Select": "选择",
  "Task": "任务",
  "Channel / Bot / Chat": "渠道 / Bot / 会话",
  "Schedule": "计划",
  "Delivery": "投递",
  "Status": "状态",
  "Run Count": "运行次数",
  "Updated": "更新时间",
  "Actions": "操作",
  "Channel": "渠道",
  "Provider": "提供方",
  "State": "状态",
  "All": "全部",
  "Recovered": "已恢复",
  "Failed": "失败",
  "Error Reason": "错误原因",
  "Context": "上下文",
  "Unified model pool": "统一模型池",
  "AI Routing & Prompt": "AI 路由与提示词",
  "Manage providers": "管理提供方",
  "Loading routing settings...": "正在加载路由设置...",
  "Active pool": "当前模型池",
  "One routing surface": "一个统一路由面板",
  "Built-in providers": "内置提供方",
  "Custom providers": "自定义提供方",
  "Fallback policy": "Fallback 策略",
  "How it works:": "工作方式：",
  "Capability routing": "能力路由",
  "Choose concrete models": "选择具体模型",
  "Runtime defaults": "运行时默认值",
  "Fallback, thinking, and context": "Fallback、思考与上下文",
  "Model fallback policy": "模型 fallback 策略",
  "Off - fail on the selected model": "关闭：选中模型失败就报错",
  "Same provider only": "仅同提供方",
  "Any enabled provider": "任意已启用提供方",
  "Default thinking": "默认思考档位",
  "Off": "关闭",
  "Low": "低",
  "Medium": "中",
  "High": "高",
  "Automatic compaction": "自动压缩上下文",
  "Summarize older turns when context gets tight.": "上下文变紧时总结较早轮次。",
  "Reserve tokens": "预留 Token",
  "Headroom kept for the next model response.": "为下一次模型回复保留的空间。",
  "Keep recent tokens": "保留最近 Token",
  "Recent turns preserved verbatim.": "最近轮次会原样保留。",
  "Compatibility fallback": "兼容兜底",
  "Legacy default anchor": "旧版默认锚点",
  "Legacy default source": "旧版默认来源",
  "Built-in transport fallback": "内置传输兜底",
  "Custom provider fallback": "自定义提供方兜底",
  "Built-in fallback provider": "内置兜底提供方",
  "Built-in fallback model": "内置兜底模型",
  "Agent persona": "Agent 人设",
  "Global system prompt": "全局系统提示词",
  "Provider Source": "提供方来源",
  "Create Custom Provider": "创建自定义提供方",
  "Search provider...": "搜索提供方...",
  "Unnamed Provider": "未命名提供方",
  "Provider ID": "提供方 ID",
  "API Key Override (Optional)": "API Key 覆盖（可选）",
  "Leave empty to use env/OAuth source": "留空则使用环境变量或 OAuth 来源",
  "API Base URL": "API Base URL",
  "Path Endpoint": "路径端点",
  "Thinking Support": "思考支持",
  "Thinking Format": "思考格式",
  "Reasoning Effort Value Mapping": "Reasoning Effort 参数映射",
  "API Signature / Key": "API 签名 / Key",
  "Attached Models": "挂载模型",
  "Add Model": "添加模型",
  "Model ID": "模型 ID",
  "Native Provider": "原生提供方",
  "Built-in": "内置",
  "Custom": "自定义",
  "Default custom provider": "默认自定义提供方",
  "Set as default": "设为默认",
  "Already default": "当前默认",
  "Provider test failed": "提供方测试失败",
  "Custom Providers settings saved.": "自定义提供方设置已保存。",
  "Show all built-in models": "显示全部内置模型",
  "Default model in this provider:": "此提供方默认模型：",
  "(None)": "（无）",
  "No Provider Selected": "未选择提供方",
  "All Models": "全部模型",
  "All Bots": "全部 Bots",
  "Tokens": "Tokens",
  "Hits": "命中",
  "Date Bracket": "日期区间",
  "Requests": "请求数",
  "Total Tokens": "总 Token 数",
  "Integration ID": "集成 ID",
  "Hit Count": "命中次数",
  "Inputs": "输入",
  "Outputs": "输出",
  "Tokens Used": "已用 Token",
  "Loading Analytics...": "正在加载分析数据..."
};

const TEXT_OR_ATTRIBUTE_ORIGINAL = new WeakMap<Node, string>();
const ATTRIBUTE_ORIGINAL = new WeakMap<Element, Record<string, string>>();
const LOCALIZABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"] as const;

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function translateDynamicValue(value: string, nextLocale: LocaleKey): string | undefined {
  if (nextLocale !== "zh-CN") return undefined;
  const compact = compactText(value);
  const showMoreMatch = compact.match(/^Show (\d+) more built-in models$/);
  if (showMoreMatch) return `显示另外 ${showMoreMatch[1]} 个内置模型`;
  const savedAgentMatch = compact.match(/^Saved agent: (.+)$/);
  if (savedAgentMatch) return `已保存 Agent：${savedAgentMatch[1]}`;
  const savedBotMatch = compact.match(/^Saved bot: (.+)$/);
  if (savedBotMatch) return `已保存 Bot：${savedBotMatch[1]}`;
  const savedProfileMatch = compact.match(/^Saved profile: (.+)$/);
  if (savedProfileMatch) return `已保存配置：${savedProfileMatch[1]}`;
  return undefined;
}

function shouldSkip(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest("script, style, code, pre, textarea"));
}

function translateValue(value: string, nextLocale: LocaleKey): string {
  if (nextLocale !== "zh-CN") return value;
  return translateDynamicValue(value, nextLocale) ?? ZH_SETTINGS_TEXT[compactText(value)] ?? value;
}

function translateTextNode(node: Text, nextLocale: LocaleKey): void {
  if (shouldSkip(node)) return;
  const current = node.nodeValue ?? "";
  const stored = TEXT_OR_ATTRIBUTE_ORIGINAL.get(node);
  const storedZh = stored ? translateValue(stored, "zh-CN") : "";
  const original =
    stored && compactText(current) !== compactText(stored) && compactText(current) !== compactText(storedZh)
      ? current
      : (stored ?? current);
  TEXT_OR_ATTRIBUTE_ORIGINAL.set(node, original);
  const trimmed = compactText(original);
  if (!trimmed) return;
  const translated = translateValue(original, nextLocale);
  const nextValue = translated === original ? original : original.replace(trimmed, translated);
  if (node.nodeValue !== nextValue) node.nodeValue = nextValue;
}

function translateElementAttributes(element: Element, nextLocale: LocaleKey): void {
  if (shouldSkip(element)) return;
  const originals = ATTRIBUTE_ORIGINAL.get(element) ?? {};
  for (const attr of LOCALIZABLE_ATTRIBUTES) {
    const current = element.getAttribute(attr);
    if (current == null) continue;
    const stored = originals[attr];
    const storedZh = stored ? translateValue(stored, "zh-CN") : "";
    if (!stored || (compactText(current) !== compactText(stored) && compactText(current) !== compactText(storedZh))) {
      originals[attr] = current;
    }
    const translated = translateValue(originals[attr], nextLocale);
    if (element.getAttribute(attr) !== translated) element.setAttribute(attr, translated);
  }
  ATTRIBUTE_ORIGINAL.set(element, originals);
}

function translateTree(node: Node, nextLocale: LocaleKey): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateTextNode(node as Text, nextLocale);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  translateElementAttributes(element, nextLocale);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      translateTextNode(current as Text, nextLocale);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(current as Element, nextLocale);
    }
    current = walker.nextNode();
  }
}

export function localizeSettings(node: HTMLElement, nextLocale: LocaleKey) {
  let currentLocale = nextLocale;
  let scheduled = false;

  const run = () => {
    scheduled = false;
    translateTree(node, currentLocale);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(run);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList" || mutation.type === "characterData" || mutation.type === "attributes") {
        schedule();
        break;
      }
    }
  });

  observer.observe(node, {
    attributes: true,
    attributeFilter: [...LOCALIZABLE_ATTRIBUTES],
    characterData: true,
    childList: true,
    subtree: true
  });
  schedule();

  return {
    update(localeKey: LocaleKey) {
      currentLocale = localeKey;
      schedule();
    },
    destroy() {
      observer.disconnect();
    }
  };
}
