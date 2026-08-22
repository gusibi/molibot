# Molibot Agent Skills

本项目 `.agents/skills/` 下的流程类 Skill 是面向开发助手（agent）的工具，在对话中说出触发词即可加载对应工作流。

## 来源说明

`doc-standards`、`prose-standard`、`trim-cot-leakage`、`doc-lifecycle`、`code-review` 五个 Skill 参考自开源项目 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`.agents/skills/` 下同名文档类 Skill），迁移时按 Molibot 的文档体系（`features.md` / `prd.md` / `CHANGELOG.md` / `docs/` 分层、256KB 季度归档、能力矩阵、渠道层纪律）做了裁切与改写：

| Molibot Skill | 参考自 | 主要改动 |
|---|---|---|
| `doc-standards` | `dsh-doc-standards` | 删除 harness 特有脚本（budget 校验、i18n 配对、Agent Notes、postmortem），替换为 Molibot 文档分层规则与归档约定 |
| `prose-standard` | `dsh-prose-standard` | 排除目录改为 `node_modules`/`build` 等；README/文档引用改指 Molibot 真实文件与 ADR |
| `trim-cot-leakage` | `dsh-trim-cot-leakage` | 决策引用改指真实 ADR；清洁会话痕迹的 recall batteries 保留中英两套 |
| `doc-lifecycle` | `dsh-archive-agent-notes` | 对象从 Agent Notes 三元组改为 `docs/requirements/` 与 `docs/designs/` 的生命周期管理；新增能力矩阵同步 |
| `code-review` | `dsh-code-review` | 删除 harness 特有设施（change-scope、quality-gates），替换为 Molibot 的验证约定与五大阻塞项 |

`release`、`agent-runtime-debug-review` 为 Molibot 自建，与 DeepSeek Harness 无关。

## 五个文档 Skill 的分工

| Skill | 管什么 | 触发词示例 |
|---|---|---|
| `doc-standards` | 文档放哪：根层 vs `docs/` 分层、类型判断、体积与 slop 审计 | “用 doc-standards 规划文档结构”“这份文档该放哪” |
| `prose-standard` | 怎么写：保留契约、按位置补足覆盖、删除叙述与重复 | “用 prose-standard 审/写这份文档” |
| `trim-cot-leakage` | 写完没留痕：清除会话转录、死引用、变更叙述、审查对话 | “清理文档里的会话痕迹” |
| `doc-lifecycle` | 过时怎么办：新旧取代、归档/保留/删除分类、能力矩阵同步 | “这个 plan 过时了吗”“归档 requirements” |
| `code-review` | 改动后文档不漂移：Docs match the code 等五大阻塞项 | “帮我 review 这个改动” |

## 使用流程

新 Skill 加入或改名后需重启 opencode 才会进入索引。典型文档生产线：

1. **规划**：`用 doc-standards 规划完整的项目文档结构` → 产出目录骨架；
2. **逐节写**：`用 prose-standard 写 features 部分，scope 是 <内容>` → 每节写完它自己会审；
3. **收尾清理**：`用 trim-cot-leakage 审计整个 docs/` → 保证文档站在当前代码视角，没有会话残留；
4. **旧文档处理**：`用 doc-lifecycle 处理 docs/requirements 里过期的 plan` → 归档旧版、裁决新旧并存、同步能力矩阵；
5. **每轮改动后**：`用 code-review 审查改动` → 强制配置/默认值/字段/事件与文档同步更新（Docs match the code）。

五个 Skill 是一套闭环：`doc-standards` 管“放哪”，`prose-standard` 管“怎么写”，`trim-cot-leakage` 管“写完没留痕”，`doc-lifecycle` 管“过时怎么办”，`code-review` 管“改动后不漂移”。

首次使用前建议先跑一次 `doc-lifecycle` 处理 `docs/requirements/` 中已知的新旧并存文档（如 `memory-improvement-plan.md` 与 `memory-improvement-plan-v3.md`），再开始整理完整文档。