可以，结合 `anthropic-experimental/sandbox-runtime` 之后，方案要稍微调整：**不要把它当成完整权限系统，而要把它当成“底层强制执行层”。** 你的 pi Agent 仍然需要自己实现上层的 **Task Grant / Subagent Grant / 审批聚合 / 命令策略 / fallback 机制**。

`sandbox-runtime` 本身的定位是轻量级 OS sandbox：用 macOS `sandbox-exec`、Linux `bubblewrap` 做文件系统隔离，用代理做网络 allowlist 过滤；它可以作为 CLI `srt` 包裹命令，也可以作为 TypeScript library 使用。它还支持 filesystem、network、Unix socket 限制，以及 macOS 上的 violation monitoring。([GitHub][1])

---

## 1. 新的定位：pi Agent 不直接“审批工具”，而是生成 srt config

之前我建议的是：

```text
User Intent
  ↓
Task Grant
  ↓
Capability Token
  ↓
Sandbox Runtime
```

现在用 `sandbox-runtime` 后，可以改成：

```text
User Intent
  ↓
Main Agent Planner
  ↓
Task Grant
  ↓
Subagent Grant
  ↓
srt config generator
  ↓
SandboxManager / srt CLI
  ↓
OS-level enforcement
```

也就是说：

```text
Task Grant 是你的业务权限模型
srt config 是底层执行配置
sandbox-runtime 是最终强制边界
```

不要让 subagent 自己决定 sandbox 配置。
subagent 只声明它需要什么能力，main agent / permission controller 决定给它生成什么 `srt-settings.json`。

---

## 2. sandbox-runtime 解决了什么，没解决什么

它能解决：

```text
1. 限制文件读写
2. 限制网络访问域名
3. 限制 Unix socket
4. 对整个 process tree 生效
5. 阻止 agent 运行的命令越权访问文件或网络
6. 用 CLI 或 library 方式包裹任意命令
```

它不能完整解决：

```text
1. subagent 审批如何上传
2. 多个 subagent 权限如何继承和降级
3. 命令是否应该执行
4. 批量审批 UX
5. 任务级授权
6. diff-level approval
7. 复杂 Bash 的风险理解
8. GitHub 这种广域 allowlist 下的数据外泄风险
```

README 里也明确说，网络 allowlist 只是按域名限制，不检查流量内容；允许 `github.com` 这种大域名仍然可能带来数据外泄风险。([GitHub][1])

所以，你的 pi Agent 里应该把 `sandbox-runtime` 放在最底层，不要把审批逻辑塞给它。

---

## 3. 推荐架构：Permission Controller + SRT Executor

我建议你设计成这样：

```text
┌────────────────────────────────────────────┐
│ User                                       │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ Main Agent / Orchestrator                  │
│ - plan                                     │
│ - task scope                               │
│ - subagent delegation                      │
│ - escalation aggregation                   │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ Permission Controller                      │
│ - TaskGrant                                │
│ - SubagentGrant                            │
│ - command policy                           │
│ - path policy                              │
│ - network policy                           │
│ - risk classification                      │
│ - approval batching                        │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ SRT Config Generator                       │
│ - generate per-task srt config             │
│ - generate per-subagent srt config         │
│ - generate per-command overlay config      │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ SRT Executor                               │
│ - SandboxManager.wrapWithSandbox           │
│ - spawn command                            │
│ - capture stdout/stderr/exit code          │
│ - capture violations                       │
└───────────────────┬────────────────────────┘
                    │
┌───────────────────▼────────────────────────┐
│ sandbox-runtime                            │
│ - macOS sandbox-exec                       │
│ - Linux bubblewrap                         │
│ - HTTP/SOCKS proxy                         │
│ - filesystem enforcement                   │
│ - network enforcement                      │
└────────────────────────────────────────────┘
```

重点：**subagent 不直接调用 `srt`，而是调用你封装的 `SrtExecutor`。**

---

## 4. 最重要的改动：从“审批 command”变成“审批 srt profile”

你现在审批频繁，很可能是因为每个命令都触发 sandbox violation，然后再问用户。

更好的方式是：在任务开始时生成一个 **task-level srt profile**。

例如用户说：

> 修复 `src/order` 模块的测试

不要每次 `cat`、`grep`、`pnpm test` 都问。你应该先生成：

```json
{
  "network": {
    "allowedDomains": [],
    "deniedDomains": [],
    "allowLocalBinding": false
  },
  "filesystem": {
    "denyRead": [
      "/Users",
      "~/.ssh",
      "~/.aws",
      "~/.kube",
      "~/.config",
      "~/.npmrc"
    ],
    "allowRead": [
      "."
    ],
    "allowWrite": [
      "./src/order",
      "./tests/order",
      "./tmp"
    ],
    "denyWrite": [
      ".env",
      ".env.*",
      "secrets/",
      ".git/",
      ".github/",
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock"
    ]
  },
  "ignoreViolations": {
    "*": [
      "/usr/bin",
      "/System"
    ],
    "jest": [
      "/private/tmp"
    ]
  },
  "enableWeakerNestedSandbox": false,
  "enableWeakerNetworkIsolation": false
}
```

`sandbox-runtime` 的读策略是“默认允许读，然后 deny 再 allow”；写策略是“默认拒绝写，必须显式 allowWrite”。所以你要特别注意：**如果你想 workspace-only read，必须 deny 掉 `/Users` 或 `/home`，再 allow 当前 workspace。** 官方 README 也给了类似 recipe。([GitHub][1])

---

## 5. 你的默认 profile 应该改成 workspace-only

我建议 pi Agent 默认不要用：

```json
{
  "filesystem": {
    "denyRead": [],
    "allowWrite": ["."]
  }
}
```

这个太宽了。因为 `denyRead: []` 表示基本可以读全局文件，只是写受限。`sandbox-runtime` README 也说明空 `denyRead` 等于 full read access。([GitHub][1])

更适合你的默认配置是：

```json
{
  "network": {
    "allowedDomains": [],
    "deniedDomains": [],
    "allowLocalBinding": false
  },
  "filesystem": {
    "denyRead": [
      "/Users",
      "/home",
      "~/.ssh",
      "~/.aws",
      "~/.kube",
      "~/.config",
      "~/Library/Application Support",
      "~/Library/Keychains"
    ],
    "allowRead": [
      "."
    ],
    "allowWrite": [
      "./tmp"
    ],
    "denyWrite": [
      ".env",
      ".env.*",
      "secrets/",
      ".git/",
      ".github/",
      ".claude/",
      ".mcp.json",
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock"
    ]
  },
  "enableWeakerNestedSandbox": false,
  "enableWeakerNetworkIsolation": false
}
```

然后根据任务逐步扩展：

```text
代码修复任务 → allowWrite src/** tests/**
文档任务 → allowWrite docs/**
依赖安装任务 → ask 后允许 package lock + registry
浏览器自动化任务 → 单独 profile，不共享代码任务 profile
```

---

## 6. subagent 不应该共享一个 srt instance

你现在的核心问题是 subagent 中 sandbox 审批向上传递困难。结合 `sandbox-runtime`，我建议：

```text
每个 subagent 一个独立 workspace / worktree
每个 subagent 一个独立 srt config
每个 subagent 一个独立 grant_id
每个命令都通过 pi 的 SrtExecutor 执行
```

不要这样：

```text
Main Agent 初始化一个 SandboxManager
所有 subagent 共用这个 SandboxManager
```

而是这样：

```text
subagent:test-fixer
  workspace: .pi/worktrees/test-fixer
  settings: .pi/srt/test-fixer.json
  grant: grant_test_fixer

subagent:doc-writer
  workspace: .pi/worktrees/doc-writer
  settings: .pi/srt/doc-writer.json
  grant: grant_doc_writer

subagent:researcher
  workspace: readonly
  settings: .pi/srt/researcher.json
  grant: grant_researcher
```

原因是 `SandboxManager.initialize(config)` 是 runtime 初始化，会启动代理等资源；如果你让多个 subagent 共用一个 config，会出现权限相互污染。官方 library 示例也是先 initialize config，再 wrap command。([GitHub][1])

---

## 7. 用 srt violation 做“审批触发源”，但不要立即问用户

`sandbox-runtime` 的 violation 机制是：

```text
1. OS 层阻止操作，返回 EPERM
2. 记录 violation
3. Claude Code 中会触发 permission prompt
```

macOS 上它可以接入系统 sandbox violation log；Linux 上 bubblewrap 没有内置 violation reporting，需要用 `strace` 观察 EPERM。([GitHub][1])

你的 pi Agent 不应该在每次 violation 时立即问用户，而应该这样处理：

```text
srt violation
  ↓
SrtExecutor 捕获 stderr / violation log / exit code
  ↓
转换成 PermissionEscalation
  ↓
返回给 main agent
  ↓
main agent 聚合多个 subagent 的请求
  ↓
一次性问用户
```

也就是：

```json
{
  "type": "permission_escalation",
  "source": "sandbox-runtime",
  "subagent": "test-fixer",
  "command": "pnpm test",
  "blocked_by": [
    {
      "kind": "filesystem.write",
      "path": "coverage/",
      "reason": "test command tried to write coverage report"
    }
  ],
  "suggested_grant_delta": {
    "filesystem.allowWrite": ["coverage/", "tmp/"]
  },
  "risk": "low"
}
```

然后 main agent 可以聚合为：

```text
当前任务有 3 个 sandbox 阻断：

1. test-fixer 运行测试时需要写 coverage/
   风险：低
   建议：本任务内允许

2. test-runner 运行 Jest 时访问 Watchman
   风险：低
   建议：改用 jest --no-watchman，而不是扩权

3. dependency-agent 请求访问 registry.npmjs.org 并修改 pnpm-lock.yaml
   风险：中
   建议：需要你确认
```

注意 Jest 这个例子很典型。`sandbox-runtime` README 建议 Jest 用 `--no-watchman`，因为 Watchman 会访问 sandbox 边界外的文件并触发 violation。([GitHub][1])

---

## 8. 加一层 Preflight，减少无意义审批

你现在审批频率高，除了 sandbox 太严格，也可能是 agent 经常先执行再撞墙。可以在执行前加一层 **preflight policy check**。

流程：

```text
Agent wants to run command
  ↓
Command normalizer
  ↓
Preflight policy check
  ↓
ALLOW → srt run
SOFT_BLOCK → 给 agent fallback
ESCALATE → 加入审批 batch
DENY → 直接拒绝
```

例如：

```text
pnpm test
→ ALLOW，自动用 srt 执行

jest
→ 自动改写为 jest --no-watchman

pnpm install
→ ESCALATE，因为需要网络 + lockfile 写入

git push
→ DENY 或强制用户确认

curl https://unknown.com
→ ESCALATE

cat ~/.ssh/id_rsa
→ DENY，不要交给 srt 撞墙
```

`srt` 是最后的安全兜底，不应该是第一层策略判断。

---

## 9. 推荐实现：SrtExecutor 包一层

你可以做一个统一执行器：

```ts
type SandboxDecision =
  | { type: "allow"; config: SandboxRuntimeConfig }
  | { type: "soft_block"; reason: string; fallback?: string[] }
  | { type: "escalate"; request: PermissionEscalation }
  | { type: "deny"; reason: string };

type ExecuteRequest = {
  taskId: string;
  subagentId: string;
  grantId: string;
  cwd: string;
  command: string;
  purpose: string;
};

async function executeWithSrt(req: ExecuteRequest) {
  const decision = await permissionController.preflight(req);

  if (decision.type === "deny") {
    return {
      status: "denied",
      reason: decision.reason,
    };
  }

  if (decision.type === "soft_block") {
    return {
      status: "blocked",
      reason: decision.reason,
      fallback: decision.fallback,
    };
  }

  if (decision.type === "escalate") {
    return {
      status: "needs_approval",
      request: decision.request,
    };
  }

  await SandboxManager.initialize(decision.config);

  const sandboxedCommand = await SandboxManager.wrapWithSandbox(req.command);

  const result = await spawnAndCapture(sandboxedCommand, {
    cwd: req.cwd,
    shell: true,
  });

  await SandboxManager.reset();

  return normalizeSrtResult(result);
}
```

核心点：

```text
preflight 决定“该不该执行”
srt 决定“执行时能不能越界”
normalizeSrtResult 决定“失败后是否转审批”
```

---

## 10. srt config 不等于完整 capability token

你之前的问题里有“权限控制”。这里要注意：

`srt config` 只适合表达：

```text
filesystem read/write
network domain
unix socket
local binding
weaker sandbox flags
ignore violations
```

但它不适合表达：

```text
这个 subagent 是否可以调用哪个工具
这个 subagent 是否可以编辑业务对象
这个 command 是否符合任务目的
这个 agent 是否可以使用浏览器登录态
这个 agent 是否可以 commit/push
是否允许安装依赖
是否允许改 lockfile
是否允许访问 MCP server
```

所以你需要两个对象：

```text
SubagentGrant：业务层授权
SrtRuntimeConfig：执行层限制
```

示例：

```json
{
  "grant_id": "grant_test_fixer_001",
  "subagent": "test-fixer",
  "task": "fix order tests",
  "business_policy": {
    "tools": ["read_file", "edit_file", "run_test"],
    "commands": {
      "allow": ["pnpm test *", "pnpm lint *", "git diff *"],
      "ask": ["pnpm install *", "npm install *"],
      "deny": ["git push *", "sudo *", "rm -rf *"]
    },
    "max_files_changed": 8,
    "require_diff_review": true
  },
  "runtime_policy": {
    "network": {
      "allowedDomains": []
    },
    "filesystem": {
      "denyRead": ["/Users", "/home"],
      "allowRead": ["."],
      "allowWrite": ["./src/order", "./tests/order", "./tmp"],
      "denyWrite": [".env", ".git/", ".github/", "pnpm-lock.yaml"]
    }
  }
}
```

---

## 11. 三类 profile：不要一个配置打天下

基于 `sandbox-runtime`，我建议你预置三类 profile。

### Profile A：readonly-analyzer

用于 analyzer / planner / reviewer。

```json
{
  "network": {
    "allowedDomains": [],
    "deniedDomains": [],
    "allowLocalBinding": false
  },
  "filesystem": {
    "denyRead": ["/Users", "/home"],
    "allowRead": ["."],
    "allowWrite": [],
    "denyWrite": []
  }
}
```

用途：

```text
读代码
搜索
生成方案
review diff
```

特点：

```text
不会触发写权限审批
不会访问网络
最适合 subagent 默认权限
```

---

### Profile B：workspace-writer

用于 code fixer / doc writer。

```json
{
  "network": {
    "allowedDomains": [],
    "deniedDomains": [],
    "allowLocalBinding": false
  },
  "filesystem": {
    "denyRead": ["/Users", "/home"],
    "allowRead": ["."],
    "allowWrite": [
      "./src/order",
      "./tests/order",
      "./tmp"
    ],
    "denyWrite": [
      ".env",
      ".env.*",
      "secrets/",
      ".git/",
      ".github/",
      "package.json",
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock"
    ]
  }
}
```

用途：

```text
修代码
写测试
改文档
运行本地测试
```

---

### Profile C：dependency-installer

只在用户批准后启用。

```json
{
  "network": {
    "allowedDomains": [
      "registry.npmjs.org",
      "*.npmjs.org"
    ],
    "deniedDomains": [],
    "allowLocalBinding": false
  },
  "filesystem": {
    "denyRead": ["/Users", "/home"],
    "allowRead": ["."],
    "allowWrite": [
      ".",
      "./node_modules",
      "./tmp"
    ],
    "denyWrite": [
      ".env",
      ".env.*",
      "secrets/",
      ".git/",
      ".github/"
    ]
  }
}
```

这个 profile 不要长期保留，只能：

```text
allow once
allow for this task
```

不建议 “allow for project”。

---

## 12. 处理 `pnpm install` / `npm install` 的特殊风险

这是你审批频繁时很容易放开的地方，但要谨慎。

`pnpm install` 不只是网络访问和写 lockfile，它还可能运行 lifecycle scripts，例如 `postinstall`。所以你不应该简单允许：

```text
network: *.npmjs.org
allowWrite: .
command: pnpm install
```

更好的策略：

```text
默认：
pnpm install --ignore-scripts

需要 scripts：
再次审批

或者：
在 disposable sandbox 里 install
安装后只复制 lockfile / node_modules cache
```

审批提示应该这样：

```text
dependency-agent 请求安装依赖：

将允许：
- 访问 registry.npmjs.org
- 修改 pnpm-lock.yaml
- 写入 node_modules

默认将使用：
pnpm install --ignore-scripts

如果需要执行 postinstall，会再次请求确认。
```

---

## 13. 网络策略要避免大域名滥用

`sandbox-runtime` 支持 `allowedDomains` 和 wildcard，例如 `*.github.com`。([GitHub][1])
但是你不要默认给 subagent：

```json
{
  "allowedDomains": ["github.com", "*.github.com"]
}
```

因为 README 也提醒，允许 `github.com` 可能让进程把数据 push 到任意 repo；域名 allowlist 不检查具体 API 行为。([GitHub][1])

建议拆成：

```text
read-only web fetch
dependency registry
git clone
git push
browser automation
```

分别授权。

例如：

```json
{
  "network": {
    "allowedDomains": [
      "registry.npmjs.org"
    ],
    "deniedDomains": [
      "gist.github.com",
      "pastebin.com",
      "webhook.site"
    ]
  }
}
```

对于 `github.com`，最好在你的上层 policy 中继续限制：

```text
允许 GET docs / release / issue
不允许 git push
不允许上传文件
不允许创建 gist
不允许访问 private repo token
```

`srt` 做不到这部分，所以要靠你的 Permission Controller 或自定义 proxy。

---

## 14. MCP server 也应该用 srt 包起来

这个工具的 README 特别提到一个用法：用 `srt` 包裹 MCP filesystem server，把 MCP server 的能力限制在 sandbox 内。([GitHub][1])

你的 pi Agent 如果支持 MCP，我建议：

```text
每个 MCP server 都不要裸跑
全部通过 srt 启动
```

例如 filesystem MCP：

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "srt",
      "args": [
        "--settings",
        ".pi/srt/mcp-filesystem.json",
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem"
      ]
    }
  }
}
```

这样即使 subagent 拿到了 MCP filesystem 工具，也只能访问你给的目录。

---

## 15. subagent 审批复杂的最终解法

现在可以具体落到 `sandbox-runtime` 上：

```text
subagent 执行命令
  ↓
SrtExecutor 使用 subagent 专属 srt config
  ↓
如果成功：返回结果
  ↓
如果 EPERM / network blocked：
     不问用户
     生成 PermissionEscalation
     返回 main agent
  ↓
main agent 聚合多个 PermissionEscalation
  ↓
生成 GrantDelta
  ↓
用户批准一次
  ↓
Permission Controller 更新 grant
  ↓
Srt Config Generator 重新生成 config
  ↓
subagent retry
```

也就是说，审批上传不是“subagent → 用户”，而是：

```text
subagent → structured escalation → main agent → batch approval → grant delta → regenerate srt config
```

这是关键。

---

## 16. 推荐的 PermissionEscalation 数据结构

```ts
type PermissionEscalation = {
  id: string;
  taskId: string;
  subagentId: string;
  command: string;
  purpose: string;

  source: "preflight" | "srt_violation" | "tool_policy";

  blockedResources: Array<
    | { type: "fs.read"; path: string }
    | { type: "fs.write"; path: string }
    | { type: "network"; domain: string }
    | { type: "unix_socket"; path?: string }
    | { type: "command"; pattern: string }
  >;

  suggestedGrantDelta: {
    filesystem?: {
      allowRead?: string[];
      allowWrite?: string[];
      denyWriteRemove?: string[];
    };
    network?: {
      allowedDomains?: string[];
    };
    commands?: {
      allow?: string[];
    };
  };

  risk: "low" | "medium" | "high";
  recommendedAction: "approve_once" | "approve_task" | "fallback" | "deny";
  fallbackOptions: string[];
};
```

---

## 17. 推荐的审批文案

不要显示底层错误：

```text
EPERM open /private/tmp/...
```

应该显示任务语义：

```text
test-runner 被 sandbox-runtime 阻止：

它正在运行：
pnpm test

被阻止的行为：
- 写入 coverage/
- 访问 Watchman 相关路径

判断：
- coverage/ 写入风险低，可以本任务允许
- Watchman 访问可以通过 --no-watchman 避免，不建议扩权

建议：
允许写入 coverage/，并自动把 jest 命令改为 jest --no-watchman。
```

用户选项：

```text
[按建议继续]
[允许本任务]
[拒绝并继续静态分析]
[查看底层日志]
```

这样审批频率会明显下降。

---

## 18. 对 macOS / Linux 差异要单独处理

你的开发环境很可能是 macOS，但部署或用户环境可能是 Linux。`sandbox-runtime` 在两边的行为不完全一样。

关键差异：

```text
macOS:
- 使用 sandbox-exec
- 支持 git-style glob path
- 有实时 violation monitoring

Linux:
- 使用 bubblewrap
- path 不支持 glob，只支持 literal path
- violation monitoring 不如 macOS，需要 strace 辅助
- 需要 bubblewrap / socat / ripgrep
- Ubuntu 24.04+ 可能需要处理 AppArmor userns 限制
```

这些都是 README 中明确提到的限制和依赖。([GitHub][1])

因此你生成 config 时要区分平台：

```ts
function normalizePathsForSrt(paths: string[], platform: "darwin" | "linux") {
  if (platform === "linux") {
    // 不生成 src/**/*.ts 这种 glob
    // 改成具体目录 src/
  }

  return paths;
}
```

不要在 Linux 上依赖：

```json
"allowWrite": ["src/**/*.ts"]
```

README 明确说 Linux 目前不支持 glob matching。([GitHub][1])

---

## 19. 关于 nested sandbox

`sandbox-runtime` 有一个 `enableWeakerNestedSandbox`，用于 Docker 环境里的弱化 nested sandbox，但官方也说明这个会明显削弱安全性，只应该在外层已经有额外隔离时使用。([GitHub][1])

你的 pi Agent 如果本身运行在 Docker 里，有两种选择：

### 更推荐

```text
外层 Docker 提供强隔离
内层 srt 只做补充限制
明确标记 security level = degraded
```

### 不推荐

```text
为了跑起来直接 enableWeakerNestedSandbox: true
然后以为安全性和本机一样
```

你可以在 UI / log 里标记：

```text
Sandbox mode: degraded nested mode
Reason: running inside Docker without privileged namespaces
Risk: filesystem/network isolation weaker than normal
```

---

## 20. 结合你场景的最终推荐方案

你的 pi Agent 可以这样落地：

```text
1. Main Agent 生成 TaskGrant
2. Permission Controller 根据 TaskGrant 生成 SubagentGrant
3. 每个 SubagentGrant 生成一个独立 srt config
4. 所有 Bash / MCP / 外部进程都必须通过 SrtExecutor
5. SrtExecutor 先 preflight，再 srt run
6. srt violation 不直接问用户，只生成 PermissionEscalation
7. Main Agent 聚合 escalation，批量审批
8. 审批通过后生成 GrantDelta
9. 重新生成 srt config
10. subagent retry
11. 最后 main agent 汇总 diff，由用户确认 apply
```

一句话：

> **用 `sandbox-runtime` 做强制执行，用 pi Agent 的 Permission Controller 做授权语义，用 Main Agent 做审批聚合。**

---

## 21. 最小可实现版本

你可以先做这个 MVP：

```text
第一步：封装 SrtExecutor
- 支持传入 subagentId / taskId / command / cwd
- 自动加载对应 srt config
- 捕获 stdout / stderr / exit code
- 将 EPERM / network blocked 转成 structured error

第二步：实现 3 个默认 profile
- readonly
- workspace-writer
- dependency-installer

第三步：实现 PermissionEscalation
- subagent 不直接问用户
- 只返回 escalation request

第四步：实现 batch approval
- main agent 合并多个 escalation
- 用户一次性批准 grant delta

第五步：实现 profile regeneration
- grant 更新后重新生成 srt settings
- retry blocked command
```

---

## 22. 我建议你现在立刻改的点

最优先改这 5 个：

```text
1. 不要让 subagent 直接调用 srt
2. 所有命令统一走 SrtExecutor
3. 每个 subagent 一个独立 srt config
4. srt violation 只生成 escalation，不直接触发用户审批
5. 默认 profile 使用 workspace-only read + no network
```

尤其第 4 点会直接解决你说的：

```text
审批触发频率高
自动执行经常卡住
subagent 审批流程向上传递困难
```

最终设计原则可以收敛成：

```text
srt 负责挡住越界行为；
Permission Controller 负责判断是否应该扩权；
Main Agent 负责把多个扩权请求合并成一次可理解的审批；
Subagent 只负责完成子任务，不负责和用户谈权限。
```

[1]: https://github.com/anthropic-experimental/sandbox-runtime "GitHub - anthropic-experimental/sandbox-runtime: A lightweight sandboxing tool for enforcing filesystem and network restrictions on arbitrary processes at the OS level, without requiring a container. · GitHub"
