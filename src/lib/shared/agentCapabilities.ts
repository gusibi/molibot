/** Agent switches control direct tool availability, not OS/network isolation. */
export const AGENT_TOOL_GROUPS = [
  { id: "search", zh: "联网搜索与阅读", en: "Web search and reading", tools: ["webSearch", "webFetch"] },
  { id: "files", zh: "文件修改", en: "File changes", tools: ["write", "edit"] },
  { id: "bash", zh: "命令执行", en: "Command execution", tools: ["bash"] },
  { id: "media", zh: "图片、视频与语音生成", en: "Image, video and speech generation", tools: ["imageGenerate", "videoGenerate", "ttsGenerate"] },
  { id: "mcp", zh: "MCP 工具", en: "MCP tools", tools: ["loadMcp", "mcpInvoke"] },
  { id: "subagent", zh: "委派子 Agent", en: "Delegate to subagents", tools: ["subagent"] },
  { id: "memory", zh: "记忆工具", en: "Memory tool", tools: ["memory"] }
] as const;
