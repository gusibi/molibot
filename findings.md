# Findings

## AI Settings Fusion
- Browser Use 当前无法连接可用的 in-app browser pane；先基于源码和现有 theme 规则推进。
- 后端 `src/lib/server/settings/modelSwitch.ts` 已经支持混合模型池：enabled built-in provider 生成 `pi|provider|model`，enabled custom provider 生成 `custom|provider|model`。
- Routing 页仍暴露 `Fallback mode (legacy)`、`PI provider`、`PI model fallback`，用户会感知成两套逻辑；更合适的表达是统一模型池 + 兜底锚点。
- Routing 页存在大量 `text-white` / `bg-black/20` / `border-white/10` 等硬编码，依赖全局 `.settings-theme` 覆盖，不利于页面自身在明暗主题下保持一致。
- Providers 页已经做了初步两栏和 built-in 模型折叠，但页面文案仍说 built-in/custom configured separately，和“可以混着用”的产品模型冲突。

## 2026-05-01 QQBot SDK upgrade findings

- Upstream openclaw-qqbot is v1.7.1; local package/qqbot is v1.5.3.
- Upstream adds modules for slash commands, approval interaction, group gating/history, quoted-message refs, STT attachment processing, typing keepalive, streaming, chunked upload, media-send queue helpers, SSRF guard, package version checks, update/hot-upgrade, startup greetings, and plugin tools.
- Molibot local SDK already has rich outbound/media code but lacks many v1.7.1 modules and newer type/config fields.
- Direct full package replacement would be risky because upstream registers OpenClaw plugin tools/hot-upgrade behavior and imports openclaw/plugin-sdk/core, while Molibot uses package/qqbot as a local SDK under its own shared channel runtime.

## 2026-05-01 QQBot SDK upgrade result

- Upgraded package/qqbot to v1.7.1 source parity for SDK-level capabilities.
- Kept upstream plugin tool registration out of Molibot index.ts, so Molibot does not silently expose OpenClaw-specific channel/remind tools through this local SDK.
- Patched channel.ts to avoid a runtime dependency on openclaw/plugin-sdk/core; local config-section helpers preserve the existing account setup behavior.
- Tests run: npm --prefix package/qqbot run build; npx tsx --test package/qqbot/src/outbound.test.ts; npm run build.

- 2026-05-01 follow-up: fixed QQ direct onEvent mode after v1.7.1 sync. Root cause was an unconditional getQQBotRuntime() in connect(), plus SDK slash/approval setup running even when Molibot owns commands/ACP.
