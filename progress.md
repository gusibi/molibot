# Progress

## 2026-02-11
- 完成 `CustomProviderConfig` 数据结构升级（多模型 + 角色能力）。
- 完成 settings 读写层兼容迁移（旧 `model` 自动兼容）。
- 新增 Provider 测试 API：`POST /api/settings/provider-test`。
- 重构 `/settings/ai` 为双栏布局：左侧可搜索 provider 列表，右侧 provider 详情编辑。
- 右侧详情支持：字段编辑、多模型增删、默认模型、支持角色展示、Provider 测试。
- 实现 Telegram pi 调用 developer 角色不兼容兜底映射。
- 验证：`npm run build` 通过；`npm --prefix web run build` 仍因既有依赖打包问题失败（`@smithy/node-http-handler` browser externalization）。

## 2026-02-25
- 新增 `telegramBots[]` 配置结构（兼容旧单 bot 字段回填）。
- Runtime 改为多实例应用：按 bot id 维护 `TelegramManager` Map，配置变更时增量启动/停止对应 bot。
- Telegram 设置页改为多 bot 列表编辑（增删 bot、bot id/name/token/allowed chat ids）。
- 修复 Telegram 配置热更新边界：token 相同但 allowed chat ids 变化时也会重载。
- 验证：`npm run build` 通过。
- 事件系统新增 `delivery` 模式：`text` 直发文本，`agent` 先执行 AI 再回复；one-shot/immediate 缺省改为 `agent`。
- `EventsWatcher` 的回调升级为支持异步，状态 `completed/error` 现在可基于异步执行结果更新。
- 更新了 runner 事件规范示例与 write 工具提醒规范化输出（默认写入 `delivery: "text"`）。
- 追加修复：event watcher 在读取事件时会自动补全并回写 `delivery`（缺省为 `agent`），避免磁盘文件和实际执行模式不一致。
- 新增可替换 memory 架构：`MemoryGateway`（稳定接口）+ `JsonFileMemoryCore`（首个 core 实现）。
- 新增 `POST /api/memory`，支持 `add/search/flush/delete/update` 五类操作。
- 聊天主链路已接入 memory：命中时注入 prompt 上下文，显式“记住/remember”类输入会自动入库。
- 新增 `/settings/plugins` 页面与 `settings.plugins.memory` 配置，可开关 memory 并选择 core。
- memory v2：新增 memory 分层（`long_term` / `daily`）和 core 能力协商接口（hybrid/incremental/layered）。
- flush 升级为增量扫描：基于 conversation cursor 仅处理新增消息，显著减少重复遍历成本。
- 检索升级为混合模式：关键词匹配 + 时间新鲜度联合评分，并在 prompt 中按分层输出记忆上下文。
- 新增 scope 级可读镜像文件：`memory/scopes/<channel>/<user>/MEMORY.md` 与 `daily/<date>.md`。
- 第二轮治理能力：memory 记录新增 `factKey`、`hasConflict`、`expiresAt` 字段，支持冲突标记与过期记忆过滤。
- API 新增 `list` 动作并扩展 `add/update` 支持 `expiresAt`，便于运营端批量查看和人工修正。
- 新增 `/settings/memory` 管理页：支持按 scope 查看、搜索、flush、编辑（content/tags/expiresAt）与删除。
- Telegram mom memory 路径已统一改为 `${DATA_DIR}/memory` 根目录（含 runtime/chat 子路径），并实现旧路径自动迁移到新路径。
- Telegram runner prompt 已更新为新 memory 路径规范；tools path guard 已允许 shared memory root，避免写入被沙箱误拦截。
- 新增 Telegram `memory` 专用工具（gateway 接口）并接入 runner tools 列表，支持 `add/search/list/update/delete/flush/sync`。
- 已禁止通过 `read/write/edit/bash` 直接访问/修改 `memory` 路径，强制 memory 操作走 gateway。
- runtime 已加入定时同步（每 60 秒）将 Telegram 文件记忆导入 gateway；`/api/memory` 每次请求也会先执行一次同步。
- `/settings/memory` 已改为统一视图：默认可跨 scope 列出记录，并显示来源 scope（channel:userId）与同步统计。
- 验证：`npm run build` 通过。
