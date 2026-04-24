# Findings

## AI Settings Fusion
- Browser Use 当前无法连接可用的 in-app browser pane；先基于源码和现有 theme 规则推进。
- 后端 `src/lib/server/settings/modelSwitch.ts` 已经支持混合模型池：enabled built-in provider 生成 `pi|provider|model`，enabled custom provider 生成 `custom|provider|model`。
- Routing 页仍暴露 `Fallback mode (legacy)`、`PI provider`、`PI model fallback`，用户会感知成两套逻辑；更合适的表达是统一模型池 + 兜底锚点。
- Routing 页存在大量 `text-white` / `bg-black/20` / `border-white/10` 等硬编码，依赖全局 `.settings-theme` 覆盖，不利于页面自身在明暗主题下保持一致。
- Providers 页已经做了初步两栏和 built-in 模型折叠，但页面文案仍说 built-in/custom configured separately，和“可以混着用”的产品模型冲突。
