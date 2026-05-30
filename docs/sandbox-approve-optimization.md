下面是我对 **OpenClaw** 和 **Hermes Agent** 的沙盒、权限控制、审批机制的整理。整体看，两者思路很像：**沙盒解决“在哪里执行”，工具策略解决“能不能调用工具”，审批解决“危险操作是否需要人确认”**。但 OpenClaw 的层次更细，Hermes 更偏向“终端后端 + 危险命令审批”的实用模型。

## 一句话结论

**OpenClaw 的安全模型更像多层权限网关**：Sandbox / Tool Policy / Elevated / Exec Approvals 是分开的。
**Hermes 的安全模型更像受控终端执行器**：通过 `terminal.backend` 把命令放进 Docker、SSH、Modal、Daytona、Singularity 等后端，再用 dangerous command approval 控制高风险命令。

---

# 1. OpenClaw 的沙盒怎么用

OpenClaw 的沙盒是可选的。开启后，Gateway 仍然跑在宿主机上，但工具执行会进入 sandbox backend。被沙盒化的工具包括 `exec`、`read`、`write`、`edit`、`apply_patch`、`process` 等，也可以启用沙盒浏览器。OpenClaw 明确说这不是完美安全边界，但可以显著限制文件系统和进程访问范围。([OpenClaw][1])

OpenClaw 的核心配置入口是：

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "backend": "docker",
        "workspaceAccess": "rw"
      }
    }
  }
}
```

## OpenClaw 的 sandbox mode

OpenClaw 的 `agents.defaults.sandbox.mode` 控制哪些会话进入沙盒：

| mode       | 含义                 | 适合场景       |
| ---------- | ------------------ | ---------- |
| `off`      | 不启用沙盒，工具直接跑在 host  | 本地可信单人开发   |
| `non-main` | 只沙盒化非 main session | 群聊、外部通道更安全 |
| `all`      | 所有 session 都进沙盒    | 默认推荐，更安全   |

OpenClaw 文档里说明：`off` 是无沙盒；`non-main` 只沙盒化非主 session，群组/频道会话通常会被视为 non-main；`all` 则所有 session 都沙盒化。([OpenClaw][1])

## OpenClaw 的 sandbox scope

`scope` 控制容器复用粒度：

| scope     | 含义                  | 风险                     |
| --------- | ------------------- | ---------------------- |
| `agent`   | 每个 agent 一个容器，默认值   | agent 内不同 session 共享状态 |
| `session` | 每个 session 一个容器     | 隔离更强，资源消耗更高            |
| `shared`  | 所有沙盒 session 共用一个容器 | 最省资源，但隔离最弱             |

OpenClaw 官方说明 `agent` 是默认值，`session` 是每个会话一个容器，`shared` 是所有沙盒会话共享容器。([OpenClaw][1])

## OpenClaw 的 backend

OpenClaw 支持多种 sandbox backend：

| backend     | 执行位置              | 特点                              |
| ----------- | ----------------- | ------------------------------- |
| `docker`    | 本地 Docker 容器      | 默认 backend                      |
| `ssh`       | 远程 SSH 机器         | 适合远程隔离或大机器                      |
| `openshell` | OpenShell 管理的远程沙盒 | 支持 mirror / remote workspace 模式 |

OpenClaw 文档说明：如果启用 sandbox 且没有指定 backend，默认使用 Docker；SSH backend 会把 workspace seed 到远程目录，后续工具在远程 workspace 上执行；OpenShell backend 则复用 SSH 传输，并增加 sandbox lifecycle 和 mirror/remote 模式。([OpenClaw][1])

---

# 2. OpenClaw 如何控制文件权限

OpenClaw 通过 `workspaceAccess` 控制沙盒能不能看到、写入宿主 workspace：

| workspaceAccess | 行为                                                                    |
| --------------- | --------------------------------------------------------------------- |
| `none`          | 默认值，工具只看到 `~/.openclaw/sandboxes` 下的沙盒 workspace                      |
| `ro`            | 把 agent workspace 只读挂载到 `/agent`，并禁用 `write` / `edit` / `apply_patch` |
| `rw`            | 把 agent workspace 读写挂载到 `/workspace`                                  |

官方文档明确：`none` 默认只使用 sandbox workspace；`ro` 会只读挂载 agent workspace 且禁用写入类文件工具；`rw` 会把 agent workspace 读写挂载到 `/workspace`。([OpenClaw][1])

所以如果你想让 agent “可以读项目，但不能改项目”，OpenClaw 里应该这样配置：

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "backend": "docker",
        "workspaceAccess": "ro"
      }
    }
  }
}
```

如果你想让 agent 只在隔离目录里折腾，不碰真实项目：

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "session",
        "backend": "docker",
        "workspaceAccess": "none"
      }
    }
  }
}
```

如果你想允许它直接改项目：

```json
{
  "agents": {
    "defaults": {
      "sandbox": {
        "mode": "all",
        "scope": "agent",
        "backend": "docker",
        "workspaceAccess": "rw"
      }
    }
  }
}
```

---

# 3. OpenClaw 的工具权限控制

OpenClaw 把 **sandbox** 和 **tool policy** 分开：

> Sandbox 决定工具在哪里跑；Tool Policy 决定哪些工具存在、能不能被调用；Elevated 是 `exec` 的沙盒逃逸机制。([OpenClaw][2])

这点很关键。也就是说：

```text
sandbox = 执行环境隔离
tool policy = 工具级权限控制
exec approvals = host exec 的审批
elevated = 从 sandbox 跑到 host 的受控逃逸
```

OpenClaw 的工具权限可以配置全局、按 agent、按 provider、按 sandbox。例如：

```json
{
  "tools": {
    "sandbox": {
      "tools": {
        "allow": ["group:fs", "group:runtime"],
        "deny": ["browser"]
      }
    }
  }
}
```

OpenClaw 支持工具组，例如 `group:runtime` 包含 `exec`、`process`、`code_execution`，`group:fs` 包含 `read`、`write`、`edit`、`apply_patch`。文档也强调：`deny` 优先；如果 `allow` 非空，其他工具都会被视为 blocked；并且 tool policy 是硬限制，`/exec` 不能覆盖被 deny 的 `exec`。([OpenClaw][2])

一个“只读 agent”的例子：

```json
{
  "agents": {
    "list": [
      {
        "id": "reader",
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "workspaceAccess": "ro"
        },
        "tools": {
          "allow": ["read", "web_search", "web_fetch"],
          "deny": ["exec", "write", "edit", "apply_patch", "process", "browser"]
        }
      }
    ]
  }
}
```

注意：OpenClaw 文档特别提醒，**禁止 `write/edit/apply_patch` 并不能让 shell 变成只读**。如果 `exec` 仍然允许，agent 还是可以通过 `sed -i`、`rm`、`python` 等命令修改文件。因此只读 agent 必须同时 deny `group:runtime` 和变更类文件工具，除非另有文件系统边界。([OpenClaw][2])

---

# 4. OpenClaw 的 Elevated：沙盒逃逸机制

OpenClaw 的 Elevated 是专门给 `exec` 用的“临时出沙盒”机制。它只在 agent 已经 sandboxed 时有意义；如果没有 sandbox，`exec` 本来就跑在 host。([OpenClaw][3])

常见指令：

```text
/elevated on     # 跑到 sandbox 外，但保留审批
/elevated ask    # on 的别名
/elevated full   # 跑到 sandbox 外，并跳过审批
/elevated off    # 回到 sandbox 内
```

OpenClaw 文档说明，Elevated 必须在配置中启用，并且发送者必须在 allowlist 中；`/elevated full` 会跳过 exec approvals，而 `on/ask` 仍然走配置的审批规则。([OpenClaw][3])

示例配置：

```json
{
  "tools": {
    "elevated": {
      "enabled": true,
      "allowFrom": {
        "telegram": ["123456789"],
        "feishu": ["user-id-xxx"]
      }
    }
  }
}
```

我的理解是：**Elevated 不应该作为常规能力，而应该作为 break-glass 机制**。例如部署、安装依赖、改系统配置时临时开启；正常开发、分析、生成文件都应该留在 sandbox。

---

# 5. OpenClaw 的审批机制：Exec Approvals

OpenClaw 的 Exec Approvals 主要管的是：**当 sandboxed agent 想在真实 host，即 gateway 或 node 上运行命令时，是否允许执行**。官方定义是：命令只有在 policy、allowlist、可选用户审批都同意时才允许执行。它叠加在 tool policy 和 elevated gating 之上；但如果 elevated 设置成 `full`，会跳过 approvals。([OpenClaw][4])

OpenClaw 的审批策略核心字段包括：

```json
{
  "tools": {
    "exec": {
      "mode": "ask"
    }
  }
}
```

`tools.exec.mode` 支持：

| mode        | 含义                                       |
| ----------- | ---------------------------------------- |
| `deny`      | 禁止 host exec                             |
| `allowlist` | 只允许 allowlist 命令                         |
| `ask`       | allowlist 命中直接放行，未命中则询问                  |
| `auto`      | 先做确定性匹配，未命中走自动 reviewer，再 fallback 到人工审批 |
| `full`      | host exec 无审批执行                          |

OpenClaw 文档列出了这些值，并说明旧的 `tools.exec.security` / `tools.exec.ask` 仍支持。([OpenClaw][4])

更细的旧式字段是：

```json
{
  "tools": {
    "exec": {
      "security": "allowlist",
      "ask": "on-miss",
      "askFallback": "deny"
    }
  }
}
```

| 字段            | 典型值                           | 含义             |
| ------------- | ----------------------------- | -------------- |
| `security`    | `deny` / `allowlist` / `full` | host exec 安全策略 |
| `ask`         | `off` / `on-miss` / `always`  | 什么时候弹审批        |
| `askFallback` | `deny` / `allowlist` / `full` | 没有 UI 可审批时怎么处理 |

OpenClaw 文档说明，如果本机 UI 不可用，需要 prompt 的请求会按 `askFallback` 处理，默认是 deny。([OpenClaw][4])

审批配置保存在执行 host 本地：

```text
~/.openclaw/exec-approvals.json
```

文档强调：有效策略是 `tools.exec.*` 和 host-local approvals defaults 的更严格者；也就是说，即使 session 配置想少审批，如果 host 本地 `ask: "always"`，仍会继续提示。([OpenClaw][4])

---

# 6. OpenClaw 的 allowlist 机制

OpenClaw 的 allowlist 是按 agent 的，可以配置命令名或可执行文件路径 glob。例如：

```json
{
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny"
  },
  "agents": {
    "main": {
      "allowlist": [
        {
          "pattern": "rg"
        },
        {
          "pattern": "/opt/homebrew/bin/git"
        },
        {
          "pattern": "~/Projects/**/bin/pytest"
        }
      ]
    }
  }
}
```

OpenClaw 文档说明：bare command name 只匹配通过 `PATH` 调用的命令；如果你要信任特定位置的二进制，应该使用 path glob。shell chain 也要求每个 top-level segment 都满足 allowlist 规则。([OpenClaw][4])

OpenClaw 还有 `strictInlineEval`，用于防止 `python -c`、`node -e`、`ruby -e`、`osascript -e` 等 inline eval 被简单地因为解释器 allowlist 而绕过审批。开启后，这类 inline eval 仍然必须审批。([OpenClaw][4])

我建议默认打开：

```json
{
  "tools": {
    "exec": {
      "mode": "ask",
      "strictInlineEval": true
    }
  }
}
```

---

# 7. Hermes Agent 的沙盒怎么用

Hermes 的沙盒主要体现在 `terminal.backend`。也就是说，它不是像 OpenClaw 那样把 sandbox 作为 agent 层通用能力，而是把“命令在哪里执行”抽象成 terminal backend。

Hermes 支持的 terminal backend 包括：

| backend       | 执行位置                     | 隔离                       |
| ------------- | ------------------------ | ------------------------ |
| `local`       | 本机直接执行                   | 无隔离                      |
| `docker`      | Docker 容器                | 完整 namespace/cap-drop 隔离 |
| `ssh`         | 远程服务器                    | 网络边界                     |
| `modal`       | Modal cloud sandbox      | 云 VM 隔离                  |
| `daytona`     | Daytona workspace        | 云容器隔离                    |
| `singularity` | Singularity/Apptainer 容器 | HPC/共享机器场景               |

Hermes 文档说明：`local` 是默认值，命令直接跑在你的机器上，没有隔离；如果担心安全，可以禁用不需要的工具，或者切到 Docker。([Hermes Agent][5])

最常见的 Docker 配置：

```yaml
terminal:
  backend: docker
  docker_image: "nikolaik/python-nodejs:python3.11-nodejs20"
  docker_mount_cwd_to_workspace: false
  docker_run_as_host_user: false
  docker_forward_env: []
  docker_volumes: []
```

Hermes Docker backend 会在 Docker 容器中运行命令，并做安全加固，比如 drop capabilities、no-new-privileges、PID 限制等。官方文档还说明，它默认是一个 long-lived container，会跨 session、`/new`、`/reset` 和 `delegate_task` subagents 复用；工作目录变化、安装的包、`/workspace` 文件、后台进程都会延续。([Hermes Agent][5])

这点非常重要：**Hermes Docker backend 默认不是每个 subagent 一个全新容器，而是共享一个持久容器**。文档说明并行 subagents 会共享这个容器，所以 `cd`、环境变量变化、同路径写入可能冲突；如果 subagent 需要隔离，需要注册 per-task image override。([Hermes Agent][5])

---

# 8. Hermes 如何控制文件访问

Hermes Docker backend 默认不会把当前宿主目录挂进容器。`docker_mount_cwd_to_workspace: false` 会保留 sandbox 边界；如果设成 `true`，Hermes 会把你启动 Hermes 的目录挂载到容器 `/workspace`，文件工具和 terminal 命令都会看到这个挂载目录。官方文档明确说：`false` 保留 sandbox boundary，`true` 给 sandbox 直接访问当前启动目录的能力。([Hermes Agent][5])

安全默认值应该是：

```yaml
terminal:
  backend: docker
  docker_mount_cwd_to_workspace: false
```

如果你要让 agent 改项目目录，可以显式挂载：

```yaml
terminal:
  backend: docker
  docker_volumes:
    - "/Users/me/projects/my-app:/workspace/my-app:rw"
```

如果只是读资料：

```yaml
terminal:
  backend: docker
  docker_volumes:
    - "/Users/me/projects/my-app:/workspace/my-app:ro"
```

Hermes 文档说明 `docker_volumes` 使用 Docker `-v` 语法，支持 `host_path:container_path[:options]`，例如 `:ro` 只读挂载。([Hermes Agent][5])

Hermes 的 credential forwarding 也比较直接：Docker terminal session 默认不会继承任意宿主凭证；需要某个 token 时，要显式加入 `terminal.docker_forward_env`。([Hermes Agent][5])

```yaml
terminal:
  backend: docker
  docker_forward_env:
    - "GITHUB_TOKEN"
    - "NPM_TOKEN"
```

---

# 9. Hermes 的权限控制

Hermes 的安全模型是七层：用户授权、危险命令审批、容器隔离、MCP 凭证过滤、上下文文件扫描、跨 session 隔离、输入净化。([GitHub][6])

在 messaging gateway 场景，Hermes 还会控制谁能和 bot 对话。授权检查顺序包括：平台 allow-all、DM pairing approved list、平台 allowlist、全局 allowlist、全局 allow-all，最后默认 deny。([GitHub][6])

示例：

```env
TELEGRAM_ALLOWED_USERS=123456789,987654321
DISCORD_ALLOWED_USERS=111222333444555666
GATEWAY_ALLOWED_USERS=123456789
```

如果没有配置 allowlist 且没有打开 `GATEWAY_ALLOW_ALL_USERS`，Hermes gateway 默认拒绝所有未授权用户。([GitHub][6])

---

# 10. Hermes 的审批机制

Hermes 的审批主要围绕“危险命令”。在执行命令前，Hermes 会用 curated dangerous patterns 检查命令。如果匹配，用户必须明确批准。([GitHub][6])

核心配置：

```yaml
approvals:
  mode: manual
  timeout: 60
  cron_mode: deny
  mcp_reload_confirm: true
  destructive_slash_confirm: true
```

`approvals.mode` 有三种：

| mode     | 行为                                    |
| -------- | ------------------------------------- |
| `manual` | 默认，对危险命令总是人工审批                        |
| `smart`  | 用辅助 LLM 评估风险，低风险自动批准，高风险自动拒绝，不确定才人工审批 |
| `off`    | 禁用审批，等价于 YOLO，非常危险                    |

Hermes 文档明确说明：`approvals.mode: off` 会禁用所有安全提示，只应在可信环境中使用。([GitHub][6])

Hermes 支持 YOLO 模式：

```bash
hermes --yolo
hermes chat --yolo
```

或者 session 中：

```text
/yolo
```

或者环境变量：

```bash
HERMES_YOLO_MODE=1
```

YOLO 会绕过危险命令审批，但 Hermes 仍有 hardline blocklist。文档说明 hardline blocklist 是 always-on floor，即使 `--yolo`、`approvals.mode: off`、cron approve、用户点了 allow always，也不能绕过。([GitHub][6])

Hardline blocklist 包括：

```text
rm -rf /
rm -rf --no-preserve-root /
fork bomb
mkfs on root device
dd if=/dev/zero of=/dev/sd*
curl | sh 这类高风险远程脚本执行
```

Hermes 文档说明，如果命中 hardline blocklist，tool call 会返回错误，命令不会执行。([GitHub][6])

---

# 11. Hermes 哪些命令会触发审批

Hermes 会对多类危险命令触发审批，例如：

```text
rm -r / rm --recursive
chmod 777 / chmod recursive
chown -R root
mkfs
dd if=
DROP TABLE / DROP DATABASE
DELETE FROM without WHERE
TRUNCATE TABLE
systemctl stop/restart/disable/mask
bash -c / sh -c / zsh -c
curl ... | sh
tee / redirection 到 /etc、~/.ssh、~/.hermes/.env
find -exec rm / find -delete
```

这些 pattern 来自官方文档列出的 dangerous command triggers。([GitHub][6])

但有一个非常关键的例外：Hermes 文档说明，当使用 `docker`、`singularity`、`modal` 或 `daytona` backend 时，dangerous command checks 会被跳过，因为容器本身被视为安全边界，容器内破坏性命令不会伤害宿主机。([GitHub][6])

这个设计很实用，但也有风险：如果你把宿主项目目录 `:rw` 挂进容器，那么 `rm -rf /workspace/my-app` 仍然会删宿主项目。因此在 Docker backend 下，**真正的风险不在容器根文件系统，而在你挂载进去的 volume**。

---

# 12. Hermes 的审批流程

CLI 中，Hermes 会显示危险命令和选项：

```text
⚠️ DANGEROUS COMMAND: recursive delete
    rm -rf /tmp/old-project

    [o]nce | [s]ession | [a]lways | [d]eny
```

选项含义：

| 选项      | 含义                               |
| ------- | -------------------------------- |
| once    | 只批准本次                            |
| session | 本 session 内批准这个 pattern          |
| always  | 加入永久 allowlist，保存到 `config.yaml` |
| deny    | 拒绝，默认值                           |

官方文档也说明，在 messaging platform 上，Hermes 会把危险命令详情发到聊天里，等待用户回复；用户可以回复 `yes/y/approve/ok/go` 来批准，也可以回复 `no/n/deny/cancel` 来拒绝。([GitHub][6])

永久 allowlist 会保存到：

```yaml
command_allowlist:
  - rm
  - systemctl
```

Hermes 文档建议用 `hermes config edit` 审查或移除永久 allowlist。([GitHub][6])

---

# 13. OpenClaw vs Hermes 对比

| 维度           | OpenClaw                                                   | Hermes Agent                                                  |
| ------------ | ---------------------------------------------------------- | ------------------------------------------------------------- |
| 沙盒入口         | `agents.defaults.sandbox` / per-agent sandbox              | `terminal.backend`                                            |
| 默认执行         | sandbox off 时跑 host                                        | `local` backend 默认跑 host                                      |
| 沙盒 backend   | Docker / SSH / OpenShell                                   | local / docker / ssh / modal / daytona / singularity          |
| 文件访问控制       | `workspaceAccess: none/ro/rw` + binds                      | `docker_mount_cwd_to_workspace` + `docker_volumes`            |
| 工具权限         | 独立 Tool Policy，支持 allow/deny/group/provider/sandbox policy | 更偏 terminal/tools 开关 + backend 隔离                             |
| host exec 审批 | Exec approvals，allowlist，ask/on-miss/always，auto reviewer  | dangerous command approval，manual/smart/off                   |
| 沙盒逃逸         | Elevated，仅 exec，可按 sender allowlist 控制                     | 没有同等明确的 elevated 层，主要切 backend / YOLO / volumes               |
| subagent 隔离  | 可 per-agent 覆盖 sandbox 和 tool policy                       | Docker backend 默认共享一个持久容器，subagent 可能冲突                       |
| 群聊安全         | 可用 `non-main` / per-agent binding 沙盒化群组                    | gateway allowlist / group session isolation / backend sandbox |

---

# 14. 对你做 Pi Agent 的启发

你之前的问题是：**sandbox 审批频率高，自动执行容易卡住；subagent 里用 sandbox 时，审批向上传递困难**。结合 OpenClaw 和 Hermes，我建议你的设计不要把“每次 violation 立即问用户”作为默认策略，而是改成四层模型。

## 第一层：执行域 Execution Domain

每个 agent / subagent 创建时就确定执行域：

```text
host-readonly
host-workspace-rw
container-ephemeral
container-persistent
remote-sandbox
browser-sandbox
```

不要让每个 tool call 临时决定是否 sandbox。这样可以减少审批噪音。

## 第二层：工具能力 Tool Capability

按 agent role 给工具权限：

```yaml
roles:
  researcher:
    allow: [read, web, search]
    deny: [exec, write, patch]

  coder:
    allow: [read, write, patch, exec]
    sandbox: container-persistent

  deployer:
    allow: [exec]
    elevated: ask
    require_approval: true
```

这里要吸收 OpenClaw 的经验：**deny runtime 才是真只读**。只 deny `write/edit/patch` 不够，因为 `exec` 仍然可以修改文件。([OpenClaw][2])

## 第三层：风险分级 Risk Tier

不要每次违反都问用户。先分类：

| 风险                 | 示例                               | 默认动作                                |
| ------------------ | -------------------------------- | ----------------------------------- |
| L0 safe            | `ls`、`cat`、`rg`、读文件              | 自动允许                                |
| L1 sandbox-only    | 容器内 `npm install`、`pytest`       | 自动允许                                |
| L2 workspace-write | 修改项目文件、apply patch               | session grant 或 plan-level approval |
| L3 host-sensitive  | 访问 `~/.ssh`、`~/.env`、真实 token    | 必须人工审批                              |
| L4 destructive     | `rm -rf`、`DROP TABLE`、部署生产       | 强审批 / 二次确认                          |
| L5 forbidden       | wipe root、fork bomb、curl pipe sh | 永久拒绝                                |

这点类似 Hermes 的 dangerous pattern + hardline blocklist，也类似 OpenClaw 的 allowlist + strict inline eval。([GitHub][6])

## 第四层：审批租约 Approval Lease

不要每个命令问一次。审批应该是有范围、有期限的 lease：

```yaml
approval_lease:
  scope: session
  agent_id: coder-1
  workspace: /repo/my-app
  allowed_actions:
    - patch_files
    - run_tests
    - npm_install
  denied_paths:
    - ~/.ssh/**
    - ~/.aws/**
    - .env
  ttl_minutes: 30
  max_commands: 50
  require_reapproval_on:
    - new_network_domain
    - secret_file_access
    - production_deploy
    - destructive_delete
```

这能解决你说的 “subagent 审批向上传递困难”。父 agent 不应该把每个子命令抛给用户，而是先申请一个 “任务级权限包”：

```text
我要创建一个 coder subagent。
它需要在 /repo/my-app 内读写文件、运行测试、安装 npm 依赖。
它不能访问 ~/.ssh、~/.aws、.env，不能执行部署。
是否批准 30 分钟？
```

用户批准后，子 agent 在 lease 内自动执行；只有越权才升级给父 agent 或用户。

---

# 15. 我建议你的默认配置

如果你要做一个 Telegram / Feishu 中使用的 Agent，我建议默认：

```yaml
default_policy:
  execution:
    backend: docker
    scope: session
    workspace_access: none

  tools:
    allow:
      - read
      - web_search
      - write
      - apply_patch
      - exec
    deny:
      - host_browser_control
      - secrets_read
      - production_deploy

  exec:
    mode: smart
    strict_inline_eval: true
    allow_safe_bins:
      - rg
      - grep
      - cat
      - ls
      - pwd
      - git status
      - git diff

  approval:
    strategy: plan_level
    lease_ttl_minutes: 30
    ask_on:
      - host_escape
      - secret_access
      - external_network_write
      - destructive_file_operation
      - production_operation
```

对于 subagent：

```yaml
subagent_policy:
  inherit_parent_lease: true
  cannot_request_more_than_parent: true
  escalation_target: parent_agent
  user_prompt_only_when_parent_cannot_decide: true
```

也就是说：

```text
用户只审批“任务权限包”
父 agent 管 subagent
subagent 不直接打扰用户
只有越权、破坏性、host escape、secret access 才上升到用户
```

---

# 16. 最重要的设计原则

我会把这件事总结成一句话：

**不要把审批设计成 tool-call 级别，而要设计成 task / session / capability lease 级别。**

OpenClaw 的优势是层次清晰：sandbox、tool policy、elevated、exec approvals 分开。
Hermes 的优势是体验简单：危险命令审批、smart approval、YOLO、hardline blocklist 都比较直接。
你自己的 Pi Agent 最好结合两者：**OpenClaw 的权限模型 + Hermes 的低打扰审批体验**。

[1]: https://docs.openclaw.ai/gateway/sandboxing "Sandboxing - OpenClaw"
[2]: https://docs.openclaw.ai/gateway/sandbox-vs-tool-policy-vs-elevated "Sandbox vs tool policy vs elevated - OpenClaw"
[3]: https://docs.openclaw.ai/tools/elevated "Elevated mode - OpenClaw"
[4]: https://docs.openclaw.ai/tools/exec-approvals "Exec approvals - OpenClaw"
[5]: https://hermes-agent.nousresearch.com/docs/user-guide/configuration/ "Configuration | Hermes Agent"
[6]: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/security.md "hermes-agent/website/docs/user-guide/security.md at main · NousResearch/hermes-agent · GitHub"
