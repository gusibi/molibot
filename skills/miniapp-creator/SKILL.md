---
name: miniapp-creator
description: "创建、修改和安装 Molibot Mini App（安装在 ~/.molibot/miniapps/ 下、同时提供 Agent 工具和桌面面板 UI 的可插拔应用）。当用户想做一个新的 Mini App、给 Agent 加一个带界面的能力（待办、记账、书单、习惯打卡等）、修改已有 Mini App 的工具或界面，或询问 manifest/工具/UI/数据目录契约时使用。"
---

# Mini App Creator

一个 Mini App = **Agent 工具 + 宿主托管的 UI + 一份私有数据**，三者共用同一个领域模块。用户在任意渠道说「帮我加个待办」由工具写入，桌面面板打开看到的是同一份数据。

**核心工作方式：永远从 `template/` 复制，不从零开始写。** 模板已经把 SQLite（WAL + 事务）、工具 handler、HTTP handler、轮询刷新、中英文、明暗主题、403/503 降级全部接好了，你只需要改领域逻辑。

完整契约见本 skill 目录下的 [reference.md](reference.md)。另外两份**一定在用户机器上**的活样例：已安装的 Todo 应用 `~/.molibot/miniapps/apps/todo/`（Molibot 首次启动时自动装入），以及本 skill 自带的 `template/`。如果手头有宿主仓库，还有更长的作者指南 `docs/guides/miniapps/authoring.md`。

## 工作流程

### 1. 先把领域问题问清楚

在写任何代码前确认三件事，缺一件就先问用户：

1. **数据长什么样**——一条记录有哪些字段？（这决定表结构，改起来最贵）
2. **Agent 要能做什么**——列出工具清单，每个工具是只读、普通写，还是不可逆删除。
3. **面板要看到什么**——列表？分组？统计？UI 只是同一份数据的第二个入口，不要设计出工具做不到的操作。

不要在用户只说了「做个记账的」就开始建表。字段错了要迁移数据，工具名错了只要改 manifest。

### 2. 生成骨架

脚本和模板都在**本 skill 自己的目录**里（提示词里的 `skill_file` 就是它的路径；标准安装位置是 `~/.molibot/skills/miniapp-creator/`）：

```bash
node ~/.molibot/skills/miniapp-creator/scripts/scaffold.mjs expenses "Expenses" ./expenses
```

用法是 `scaffold.mjs <app-id> "<显示名>" <目标目录>`。在当前 Session scratch 目录构建，不要把尚未验证的源码直接生成到正式安装目录。脚本会复制 `template/` 并分别转换 app id、名称、CSS 类前缀与 SQLite 安全表名，产物是**可以直接跑起来的完整应用**。目标目录必须不存在，且目录名必须等于 app id——脚本会当场拒绝，省得重启后才看到加载错误。

手工做也可以：复制本 skill 目录下的 `template/`，再把里面所有 `starter` / `Starter` 替换成你的 app id 与显示名。实在找不到模板时，退而复制 `~/.molibot/miniapps/apps/todo/`——那是随 Molibot 一起装好的参考实现，结构完全一样，只是内容是待办领域的。

**脚本跑完之后，用它打印出来的绝对路径继续。** 文件工具（`read`/`write`/`edit`/`ls`）能修改 scratch 构建；`miniapps/data/` 是各 App 自己的 SQLite 私有数据，不在可写范围内——那份数据只能通过 App 自己的工具和 HTTP 接口改。

### 3. 改领域层，而不是四处改

`server/index.mjs` 里只有一个 `Store` 类是领域层。按这个顺序改：

1. `SCHEMA` 常量——表结构、索引。
2. `Store` 的方法——校验、业务规则、事务，全部在这里。
3. `tools` 里的 handler——只做「调 Store + 组织给 Agent 看的文本」。
4. `handleHttp` 的 `route()`——只做「调 Store + 组织给 UI 看的 JSON」。

**最重要的一条规则**：工具 handler 和 HTTP handler 必须调同一批 Store 方法。任何一边自己写 SQL，Agent 和面板迟早会看到不一样的数据，而且只有同时用两个入口的用户会遇到。

### 4. 同步 manifest

`manifest.json` 的 `tools` 必须与 `tools` handler **完全一一对应**——少一个是 Agent 能调却必然失败的工具，多一个是没有 schema、没有风险分级的暗能力，两种情况都会让整个 App 加载失败并在设置里显示错误。

每个工具还要给对：

- `keywords`：工具是延迟加载的，Agent 靠 `toolSearch` 用领域关键词找到它们。**必须覆盖用户真正会说的词，中英文都要**（`["expense", "spend", "记账", "花了", "多少钱"]`），只写英文等于不可发现。
- `readOnlyHint: true` → 低风险；`destructiveHint: true` → 高风险，每次调用都要 owner 审批；都不写 → 中风险。两者不能同时为 true。**永久删除数据的工具必须标 `destructiveHint: true`。**
- `description`：写清楚「什么时候该调用我」，这是 Agent 唯一的判断依据。

### 5. 改 UI

`ui/app.js` 已经接好了轮询、错误降级和中英文表；改 `STRINGS`、`renderItem()` 和请求的 API 路径即可。

- 界面在独立 origin 的 sandboxed iframe 里，**拿不到宿主 DOM、Tauri IPC、Molibot 的设计 token**，这是设计如此，不可配置。
- 只能用相对路径 `./api/*` 访问自己的 API。
- 内联 `<script>` 不会执行（CSP），代码必须放在 `.js` 文件里。
- 语言和主题从 `location.search` 的 `locale` / `theme` 读，启动时读一次就够（切换会重载 iframe）。

### 6. 校验、安装并冷启动验证

源码完成后必须调用 `miniAppManage`：先用 `validate` 在临时数据库中加载 Runtime，校验 manifest、SQL 与工具 handler；通过后用 `install` 原子安装或更新，再用 `inspect` 从正式目录回读 app id、version 和 manifest hash。也可以由用户在侧边栏 **Mini Apps** 管理器安装本地文件夹 / ZIP / GitHub 仓库。

**证据规则：**没有成功的文件写结果，不得说已经改源码；没有成功的 `miniAppManage install`，不得说已经安装；没有 `inspect` 回读，不得声称正式目录版本；展示代码块不算执行。任何工具失败都要原样报告，不能用文字模拟成功。

**装完必须重启 Molibot 服务，V1 没有热更新。** 数据目录 `~/.molibot/miniapps/data/<app-id>/` 不受安装和升级影响。

如果当前会话没有真实重启和打开面板的能力，只能报告「安装完成，等待重启验证」，不得勾选下面的冷启动项目或说「可以正常加载」。

重启后按这条清单走一遍真实链路，不要只看代码通过：

- [ ] 设置里 App 状态是 active，不是 error（error 行会写明原因）。
- [ ] **冷启动首开面板不是空白**（历史上最常见的失败）。
- [ ] 在对话里让 Agent 写一条 → 面板 2 秒内自动刷新出来。
- [ ] 在面板里改一条 → 让 Agent 列一次 → 能看到改动。
- [ ] 在设置里关掉这个 App → 面板显示「已禁用」而不是转圈或报错。

### 7. 收尾检查

- [ ] 目录名 == `manifest.id`；`runtime.entry` 是 `.mjs`。
- [ ] 工具 handler 与 manifest 完全一致，不多不少。
- [ ] 两个入口共用同一个领域模块。
- [ ] 会改数据的调用返回 `changed: true`（这是面板刷新的唯一触发源）。
- [ ] HTTP 响应里没有宿主绝对路径、没有密钥，只有不透明 ID。
- [ ] 改了表结构就 bump `data.schemaVersion`，并**自己**先迁移数据——宿主不会替你迁移，它会直接停掉 App 报错。

## 边界

- 不要为 App 引入需要 `npm install` 的依赖：宿主不编译 TypeScript、不跑安装脚本，第三方依赖必须自带。SQLite 用 Node 内置的 `node:sqlite`。
- 不要试图让 UI 调 Agent 工具或走 MCP bridge——UI 直连自己的 API 是既定架构。
- App 服务端代码在 Molibot 进程内运行且**完全不做沙箱**。给用户装第三方 App 前必须说明：这等于用自己的权限运行别人的代码。
