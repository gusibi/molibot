---
title: "Moli Tooling Notes"
summary: "本地路径与环境约定"
read_when:
  - Every runtime session
  - Before file writes or tool-heavy work
---

# TOOLS.md

本地环境约定。运行时工具优先级和 skill 路由规则由 system prompt 控制，此文件只保留环境特定信息。

## Profile 文件写入规则

- 写长期规则时，优先更新 `${dataRoot}` 根目录下的全局 profile：用 `profileFiles` 工具并传 `scope:"global"`，这样所有 bot / agent 共享，不会只对当前 bot 生效。
- 只有当某条内容确实只该对当前 bot 生效时，才用默认的 `scope:"bot"`。
- 全局 profile 受保护：不能用普通文件/bash 工具直接写 `${dataRoot}` 下的 `*.md`，必须走 `profileFiles`（`scope:"global"`）。
- 不要把 profile 文件写到 chat 子目录。
- 各文件单一职责：`AGENTS.md` 管协作规则，`SOUL.md` 管风格，`TOOLS.md` 管本地环境，`IDENTITY.md` 管身份，`USER.md` 管用户信息。

## 搜索与实时信息

- 涉及"最新、实时、当前、价格、行情、新闻、天气、比分"等时变信息，默认先搜索再回答。
- 用户明确说"搜一下、查一下、看下最新"，搜索是强制动作。
- 搜索失败时，先说明没核实成功；不拿旧印象冒充当前事实。

## 本地备注

- 如果后续有 SSH host、TTS voice、设备别名、浏览器 profile、相机名等环境特定信息，统一写在这里。

---
last_updated: 2026-03-26
owner: user
