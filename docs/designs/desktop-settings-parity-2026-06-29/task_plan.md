# Desktop Settings 功能对齐实施计划

## 目标

让 macOS App Settings 达到 Web 设置页的功能覆盖，同时严格保持 `Momo for Mac (standalone).html` 与 `DESIGN.md` 定义的 macOS UI 风格。

## 成功标准

- Provider 新建与编辑使用同一完整模型，支持多模型、能力标签、上下文窗口、发现和测试。
- 模型路由补齐 Web 的 Subagent 分级、fallback、thinking、compaction 和 timezone。
- Search、Image、Video、TTS 在 App 中可保存、测试，并覆盖 Web 的任务/音色能力。
- P1 模块（错误、用量、Trace、Skill Drafts、Sandbox、Host Bash、System、Runtime Environment）按差异报告逐项补齐。
- 所有设置保存走细粒度 desktop API，不提交整个 settings 对象。
- 中英、Light/Dark/System、移动/窄窗口、固定保存底栏符合设计规范。
- 相关单元测试、构建和桌面测试通过；功能文档同步更新。

## 阶段

1. [complete] 审计设计稿、设计规范、现有 desktop UI 与测试结构
2. [complete] P0-A：Provider 新建/编辑统一与首次引导对齐
3. [complete] P0-B：模型路由高级设置
4. [complete] P0-C：Search / Image / Video / TTS 写入、测试与任务能力
5. [pending] P1：错误、用量、Trace、Skill Drafts、Sandbox、Host Bash、System、运行环境
6. [complete] P0 视觉与交互统一：语义 CSS、响应式、主题、中英、固定底栏
7. [complete] P0 全量验证与 `features.md` / `prd.md` / `CHANGELOG.md` / `readme.md` 更新

## 约束与决策

- 不嵌入 Web 设置页，不复制 Agent/runtime 业务逻辑到 desktop UI。
- 复用共享 settings schema、sanitizer、provider/runtime service；desktop route 只做安全 contract 适配。
- 不把本机绝对路径写进产品代码或文档示例。
- 当前工作树已有大量未提交改动；只做与本任务直接相关的增量修改。
- 实施顺序按可独立验证的垂直切片推进，不一次性重写 `App.svelte`。

## 错误记录

- Provider 定向测试首次失败：本测试文件的轻量 `expect` 不支持 `toMatch`；改用现有 `node:assert.match`，未重复运行同一失败命令。
- Provider 定向测试第二次发现同类断言兼容问题：轻量 `expect` 也不支持 `toHaveLength`；改为比较 `.length`。Svelte check 同时仅报告这一处。
- 模型路由 i18n 首次补丁因既有中文文案“配置模型”与预期“切换模型”不一致而未应用；读取精确上下文后按现有文本重新应用。
- 搜索设置更新测试首次使用了不完整的引擎 fixture，而 sanitizer 按完整引擎集合读取 fallback；测试已改为从默认设置构造完整 fixture，生产路径未改。
