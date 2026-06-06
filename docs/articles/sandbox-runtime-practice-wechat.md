# 我把 Anthropic 的 sandbox-runtime 接进了自己的 Agent，才发现沙箱不是一个开关

上一篇我写过，我为什么最后选择了 Anthropic 的 `sandbox-runtime`。

当时的结论很简单：我不想为了一个个人 AI 助手，一上来就把执行环境做成完整的 Docker/远程 VM 系统；我更需要一个轻量、能在本机真实工作流里落地、同时能限制 Agent shell 行为的执行边界。

所以我选了 Anthropic 的 runtime。

但真正接进去之后，我很快发现：选型只是第一步。

沙箱不是一个“打开就安全”的开关。尤其是当 Agent 不只是跑在网页里，而是同时服务 Web、Telegram、飞书、微信、QQ，甚至还有 subagent、工具调用、审批恢复、长任务的时候，真正难的不是“怎么把命令放进沙箱跑”，而是：

> 当沙箱挡住它时，Agent 接下来怎么办？

这篇记录的是我把 `sandbox-runtime` 接入 Molibot 的实践过程，以及中间踩过的几个坑。

## 一开始我以为：给 bash 套一层沙箱就够了

Molibot 是我自己在做的本地优先 AI 助手。它的核心不是某一个聊天入口，而是一套共享 runtime：

- Web Chat 可以直接对话、传文件、看运行状态；
- Telegram、飞书、微信、QQ 都能接入同一套 Agent；
- Agent 能调用 bash、MCP、图片生成、视频生成、搜索、subagent；
- 会话、设置、审批记录、任务记录都落在本地 JSON/SQLite 里。

所以我最开始接沙箱时，目标很克制：

1. 只覆盖 Agent 和内置 subagent 的 `bash`；
2. Browser、MCP、渠道消息收发先不纳入沙箱；
3. shell 默认在 runtime 管理的 sandbox 里执行；
4. 文件系统、网络、环境变量都通过设置页控制；
5. 如果确实需要宿主机能力，再走人工审批。

这听起来像一个很正常的工程任务。

实际做完第一版，我才意识到它牵一发动全身。

因为 Agent 的 shell 不是普通 shell。普通 shell 执行失败就结束了，Agent 的 shell 执行失败后，模型还会继续推理、重试、解释、改路径、换命令。它有“补救”的冲动。

如果提示词和 runtime 没配合好，沙箱反而会诱导 Agent 做一些更糟糕的事情：重复试错、绕过限制、把等待审批误认为停止、把内部控制提示写进长期上下文。

## 第一版：把 Anthropic runtime 包成底层执行层

我没有把 Anthropic 的 SDK 直接散落在业务代码里。

最后落地时，我先抽了一层 `SandboxProvider`：

```ts
interface SandboxProvider {
  name: string;
  checkDependencies(): boolean;
  initialize(config, callback?): Promise<void>;
  reset(): Promise<void>;
  wrapWithSandbox(command, options?): Promise<string>;
  isInitialized(): boolean;
  getLastError(): string | undefined;
}
```

默认实现叫 `AnthropicSandboxProvider`，里面才真正调用 `@anthropic-ai/sandbox-runtime`。

这样做有两个目的。

第一，Molibot 上层只知道“我要准备一次 sandbox 执行”，并不关心底层是 Anthropic runtime、Docker、Bubblewrap 还是以后别的 provider。

第二，沙箱在产品里不是孤立模块。它会影响 bash 工具、subagent、审批、设置页、诊断页、提示词。如果 SDK 细节散得到处都是，以后替换就会非常痛。

所以现在的边界是：

- `sandbox-runtime` 负责 OS 级约束；
- Molibot runtime 负责权限策略、审批、恢复、上下文管理；
- channel 只负责把审批卡片或文字提示发给用户。

这点后来被证明很重要。

## 真正的坑：沙箱挡住以后不能只返回失败

最早的问题出现在 Host Bash。

有些命令天然需要宿主机能力，比如控制本机浏览器、访问某些本地 IPC、调用外部 CLI、处理不适合沙箱的系统操作。沙箱挡住这些命令是对的。

但如果只是把错误丢给模型，模型经常会继续尝试：

```text
Operation not permitted
Permission denied
socket / IPC failed
```

模型看到这些错误后，可能会换一个命令再试。可这不是命令写错了，而是权限边界挡住了。

所以我把 bash 的失败路径改成了一个明确的分支：

1. 命令先在 sandbox 里跑；
2. 如果失败，并且错误看起来像权限/IPC/socket/sandbox 限制；
3. runtime 尝试把命令归类成可审批的 Host Bash capability；
4. 能归类就创建审批请求；
5. 当前 turn 返回 `waiting_for_approval`；
6. 用户批准后，runtime 自动执行原命令，并把 stdout/stderr 回填进原工具上下文；
7. Agent 从这个工具结果继续往下回答。

这一步让体验从“Agent 卡住了”变成“Agent 等我确认一次，然后自己继续”。

这里的关键不是审批按钮，而是“恢复”。

如果用户批准后，命令结果只是作为一条普通聊天消息发出去，Agent 其实并不知道命令执行成功了。它的模型上下文里仍然是“工具失败，等待审批”。

所以我做了自动恢复：审批完成后，把原来那条工具调用的 result 改写成真实 stdout/stderr，再触发 runner 继续执行。这样最终回答仍然是 Agent 总结出来的，而不是系统单独插一条“命令执行成功”。

这个细节很小，但对产品质感影响很大。

## 第二个坑：等待审批不是 stopped

最开始 Host Bash 审批会让 runner 中断。

表面上看没问题：反正要等用户点按钮，先停下来。

但后来发现，这会污染整个运行语义。

用户看到的是“等待审批”，系统内部却把它当成了 `aborted` 或 `Stopped.`。结果是：

- Telegram 可能在审批卡片后面多发一条 `Stopped.`；
- Web Chat 可能把临时等待提示写进普通 assistant 历史；
- subagent 等待审批时，父 Agent 以为子任务失败或停止；
- chain 模式还可能继续执行下一步，把 `{previous}` 建在一个没有完成的结果上。

这很危险。

因为“等待我批准”和“我取消了任务”完全不是一回事。

后来我把 `waiting_for_approval` 变成一个独立的 stop reason，并让它贯穿 runner、subagent、channel、run summary、stream API。

现在的规则是：

- 真正取消才是 `aborted`；
- 审批挂起就是 `waiting_for_approval`；
- 临时等待提示不进入模型上下文；
- subagent 如果在等审批，父 runner 也保留这个状态；
- chain/parallel 不会在等待审批时继续往下跑。

这件事让我更确定：做 Agent runtime 时，状态命名不是小事。一个状态如果偷懒复用，后面所有恢复逻辑都会变形。

## 第三个坑：审批不能太吵

沙箱刚接上时，还有一个非常现实的问题：审批太频繁。

比如用户已经批准过 `longbridge` 这个外部 CLI，但 Agent 实际跑的是：

```bash
longbridge news FIG.US 2>&1 | head -30
```

如果系统把管道、`head`、`2>&1` 都看成新的复杂 shell，那么每次都会要求一次 one-time approval。

这在安全上保守，但用起来很烦。

我后来补了 Host Bash command classifier。它的目标不是让所有复杂 shell 都变安全，而是把“真实 host capability”和“无害 shell 装饰”分开。

例如：

- `longbridge news FIG.US` 是真正的能力；
- `2>&1` 是输出流合并；
- `| head -30` 是输出裁剪；
- 静态 `cd <path>`、简单 `echo DONE` 可以作为受限 helper；
- 但重定向写文件、命令替换、heredoc、动态 shell、`python -c`、`node -e` 这类仍然降级为 one-time approval。

这套规则的产品目标是：

> 批准能力，而不是批准每一种命令排版。

这样用户批准一次外部工具后，常见的查看、过滤、截断输出不会不断打断。

## 第四个坑：`/sandbox off` 的语义必须说清楚

一开始我把 sandbox off 当成“不开沙箱”。

听起来没毛病。

但到了 Host Bash 体系里，它其实还有另一层含义：既然当前作用域已经明确关闭沙箱，那普通 `bash` 就应该直接跑在宿主机，不应该再弹 Host Bash 审批。

否则用户会很困惑：

“我都关沙箱了，为什么还要批准 Host Bash？”

所以后来我把语义改清楚：

- sandbox on：普通 bash 进沙箱；host-only 能力需要审批；
- sandbox off：当前作用域进入 Host Bash full access；普通 bash 和模型带的 `hostApproval` 都直接在宿主执行；
- session override 优先级最高，之后才是 bot、agent、global default。

现在优先级是：

```text
Session Override
> Bot Instance Override
> Agent Override
> Global Default
```

也就是说，我可以在某个会话里临时 `/sandbox off`，处理安装依赖、浏览器控制或本地调试；开新会话或切换 bot 后，它会回到默认策略。

这比全局开关更符合真实使用。

## 第五个坑：环境隔离不能只隔离文件系统

接沙箱时还有一个细节：工具环境。

Agent 经常会跑 Python、Go、npm、测试命令。最开始如果每个 skill 或每个会话都自己建 `.venv`，会留下很多机器相关路径，也容易污染项目目录。

后来我把内置工具环境收敛到了统一目录：

```text
MOLIBOT_TOOLING_DIR
```

默认是 Molibot 自己的数据目录下的 tooling 区域。Python venv、pip cache、uv cache、Go 的 `GOPATH`、`GOCACHE` 都归进去。

沙箱写入 allowlist 也同步包含这个 tooling 根目录。

这样做以后，Agent 可以继续安装和复用工具依赖，但不会把各种缓存、虚拟环境、临时构建文件撒到项目源码里。

这也是我后来对“沙箱”的理解变化：

沙箱不是只限制危险行为，它还要让正常工作有一个稳定、可复用、可诊断的环境。

## 第六个坑：提示词里不能塞太多沙箱实现细节

一开始我倾向于把 sandbox 的各种规则都写进系统提示词。

比如底层用了什么 OS 机制、文件系统怎么 deny/allow、网络怎么过滤、哪个目录是 venv、哪些命令会触发审批。

后来发现这会让 prompt 变得又长又脆。

模型真正需要知道的是决策边界：

- 普通 shell 工作走 `bash`；
- 不要尝试绕过 sandbox；
- 已知需要 host-only 能力时，用 `bash.hostApproval.reason` 请求受控 host access；
- sandbox 权限失败后，不要重复用 plain bash 试同一件事。

至于底层是 `sandbox-exec`、`bubblewrap`，还是 Anthropic SDK 怎么包命令，这些不该进入模型主提示词。它们属于 runtime 诊断和工程实现，不属于模型决策规则。

所以后面我做了一轮 System Prompt Boundary Refactor，把 sandbox 的实现描述收回到代码和诊断里，只在 prompt 里保留最小决策规则。

这让提示词更短，也减少了模型“学着绕实现细节”的机会。

## 最后现在的效果

现在 Molibot 的沙箱体系大概长这样：

```text
用户请求
  ↓
Agent / Subagent
  ↓
bash 工具
  ↓
解析当前 sandbox 策略
  ↓
SandboxProvider 包装命令
  ↓
Anthropic sandbox-runtime 执行
  ↓
如果权限失败：
    → Host Bash 分类
    → 创建审批
    → 返回 waiting_for_approval
    → 用户批准
    → 自动执行 pending action
    → stdout/stderr 回填工具上下文
    → Runner 自动恢复
```

用户能感受到的变化是：

1. Agent 默认不会随便拿宿主机 full access；
2. 常规 shell 工作仍然能跑；
3. 需要宿主机能力时，聊天里会出现明确审批；
4. 可以选择长期批准、仅本 session 批准、拒绝；
5. 批准后 Agent 会自动继续，不需要用户再说“继续”；
6. subagent 等待审批时不会被误判为停止；
7. `/sandbox off` 可以临时让当前会话进入 Host Bash full access；
8. 设置页能看 sandbox、Host Bash、审批历史和诊断；
9. 提示词里不再堆满底层 sandbox 实现细节。

这已经不是单纯的“接入一个 SDK”了。

更准确地说，是把沙箱接成了 Agent runtime 的一个底层执行边界。

## 我现在对 Agent 沙箱的几个判断

第一，沙箱不能替代权限系统。

Anthropic 的 `sandbox-runtime` 很适合作为底层强制层，但它不负责你的业务审批、subagent 权限继承、channel 展示、run 恢复、审计记录。那些都要 runtime 自己做。

第二，审批的核心不是按钮，而是恢复。

如果批准后 Agent 不能带着真实工具结果继续推理，审批就只是一个外挂流程。体验会断。

第三，不要让 channel 承担权限逻辑。

Telegram、飞书、微信、QQ 只应该负责展示按钮或文字指令。队列、审批、恢复、session 状态，都应该在共享 runtime 层。否则每加一个渠道，就要重新写一套安全逻辑。

第四，状态语义一定要干净。

`waiting_for_approval`、`aborted`、`failed`、`completed` 必须分开。Agent runtime 最怕“差不多”的状态，因为恢复、归档、提示词上下文都会依赖这些状态。

第五，沙箱策略要允许临时例外。

完全不让出沙箱，Agent 会做不了真实工作；完全 full access，又失去边界。比较好的体验是默认收紧，但允许 session 级别的临时授权，并且自动过期。

## 下一步我想补的东西

现在这套已经能用了，但还不是终点。

我接下来更想做的是 Policy Profile 和 Run Ledger。

也就是把底层一堆 allow/deny 配置，包装成用户更容易理解的模式：

- Observe：只读观察；
- Build：允许工作区写入和测试；
- Strict：默认拒绝网络和敏感路径；
- Host-Assisted：保留沙箱，但允许明确的 Host Bash 审批路径。

同时，每次 Agent run 应该形成一份可读账本：用了哪个 profile、哪些工具、哪些 subagent、触发了什么审批、产出了哪些文件、最后为什么完成或挂起。

因为真正可用的 Agent，不只是能执行任务。

它还要让用户知道：它刚刚到底做了什么，为什么这么做，哪里越过了边界，哪里被人批准过。

这才是我现在理解的沙箱开发实践。

不是给 AI 套一个笼子。

而是给它一条能认真工作的安全路线。

