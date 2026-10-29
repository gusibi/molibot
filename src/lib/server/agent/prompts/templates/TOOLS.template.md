---
title: "本地环境约定"
summary: "本地路径与环境约定"
read_when:
  - Every runtime session
  - Before file writes or tool-heavy work
---

# TOOLS.md

本地环境约定。工具优先级、skill 路由和实时信息核实规则由系统提示词控制，此文件只保留环境特定信息。

## Profile 文件写入规则

- 写长期规则时，优先更新全局 profile：用 `profileFiles` 工具并传 `scope:"global"`，这样所有 bot / agent 共享，不会只对当前 bot 生效。
- 只有当某条内容确实只该对当前 bot 生效时，才用默认的 `scope:"bot"`。
- 全局 profile 受保护：不能用普通文件/bash 工具直接写，必须走 `profileFiles`（`scope:"global"`）。
- 不要把 profile 文件写到 chat 子目录。

## 本地备注

- SSH host、TTS voice、设备别名、浏览器 profile、相机名等环境特定信息统一写在这里。
