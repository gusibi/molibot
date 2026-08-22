结论：**不是只展示最终结果**。OpenClaw / Hermes Agent 在 Telegram、Feishu 这类消息通道里，一般会把输出分成几类：最终回答、流式预览、工具进度、阶段性 assistant 消息、推理/思考消息、长任务心跳。但默认展示策略不完全一样，而且都可以配置成“只看结果”。

## 1. OpenClaw 在 Telegram 中的展示方式

OpenClaw 的 Telegram 通道支持 **live stream preview**，也就是先发一条预览消息，然后不断 `editMessageText` 更新内容。它还支持工具进度预览，例如命令执行、读文件、计划更新、patch 摘要、Codex preamble/commentary 等短状态行。默认 `channels.telegram.streaming` 是 `partial`，并且 `streaming.preview.toolProgress` 默认在预览流开启时为 `true`。([OpenClaw][1])

所以 Telegram 中通常会看到：

| 类型           | 是否展示    | 展示方式                                                        |
| ------------ | ------- | ----------------------------------------------------------- |
| 最终回答         | 展示      | 普通消息，或把预览消息最终编辑成完整答案                                        |
| 回答生成过程       | 可展示     | 同一条消息不断编辑更新                                                 |
| 工具调用进度       | 默认可展示   | 短状态行，复用预览消息或进度消息                                            |
| 命令/exec 细节   | 可展示/可隐藏 | `commandText: raw/status` 控制                                |
| 思考/reasoning | 默认隐藏    | `/reasoning on` 才持久显示；`/reasoning stream` 仅 Telegram 临时流式显示 |
| 长文本          | 展示      | 超过长度会拆分多条消息                                                 |

如果你想 **只展示最终结果**，OpenClaw Telegram 可以设置：

```json
{
  "channels": {
    "telegram": {
      "streaming": {
        "mode": "off"
      }
    }
  }
}
```

文档明确说明：`streaming.mode: "off"` 会禁用 Telegram 预览编辑，并抑制通用 tool/progress chatter，不把它们作为独立状态消息发送；但审批提示、媒体、错误仍会正常发送。([OpenClaw][1])

如果你想保留答案流式预览，但隐藏工具进度：

```json
{
  "channels": {
    "telegram": {
      "streaming": {
        "mode": "partial",
        "preview": {
          "toolProgress": false
        }
      }
    }
  }
}
```

## 2. OpenClaw 在 Feishu / 飞书 中的展示方式

OpenClaw 的飞书通道支持 **interactive card streaming**。开启时，机器人会用飞书交互卡片实时更新回答内容；关闭时，则等完整结果生成后一次性发出。官方配置里 `channels.feishu.streaming` 默认是 `true`，`blockStreaming` 默认关闭。([OpenClaw][2])

飞书里大致是：

| 类型           | 是否展示                        | 展示方式                                                      |
| ------------ | --------------------------- | --------------------------------------------------------- |
| 最终回答         | 展示                          | 普通消息或卡片最终内容                                               |
| 回答生成过程       | 默认可展示                       | interactive card 实时更新                                     |
| 已完成 block    | 默认不展示为分块消息                  | `blockStreaming: true` 后才提前 flush 已完成块                    |
| 工具进度         | 文档没有像 Telegram 那样强调完整工具进度预览 | 更偏向流式回答卡片                                                 |
| 思考/reasoning | 默认隐藏                        | `/reasoning on` 可作为独立 Reasoning 消息；`stream` 仅 Telegram 支持 |

飞书想要 **只展示最终结果**，可以设置：

```json
{
  "channels": {
    "feishu": {
      "streaming": false,
      "blockStreaming": false
    }
  }
}
```

官方说明是：`streaming: false` 会发送完整回复，而不是实时更新卡片；`blockStreaming` 只有你想把已完成 assistant block 提前刷出来时才开启。([OpenClaw][2])

## 3. OpenClaw 的“思考过程”到底会不会展示？

默认不会展示。OpenClaw 有 `/reasoning on|off|stream`：

`/reasoning on`：把 reasoning 作为单独消息发送，前缀是 `Reasoning:`。
`/reasoning stream`：**仅 Telegram**，生成过程中把 reasoning 流式显示到 Telegram 草稿/预览气泡中，最终回答不包含 reasoning。
默认回退是 `off`，也就是不展示。([OpenClaw][3])

所以你可以理解为：

```text
默认：用户只看到回答 + 可能的工具进度/流式状态
/reasoning on：用户额外看到 Reasoning: ...
/reasoning stream：Telegram 里临时看到 reasoning，最终答案不带 reasoning
```

## 4. Hermes Agent 在 Telegram / Feishu 中的展示方式

Hermes Agent 的展示控制更直接，核心配置是：

```yaml
display:
  tool_progress: all      # off | new | all | verbose
  interim_assistant_messages: true
  show_reasoning: false
```

官方配置说明里，`tool_progress` 控制工具进度展示，取值包括 `off | new | all | verbose`；`show_reasoning` 默认是 `false`，用于控制是否显示模型 reasoning/thinking；`interim_assistant_messages` 用于 gateway 中把“自然的中途 assistant 更新”作为单独消息发送。([Hermes Agent][4])

Hermes 还支持按平台覆盖，比如 Telegram 展示详细工具进度，而 Slack 静默：

```yaml
display:
  tool_progress: all
  platforms:
    telegram:
      tool_progress: verbose
    feishu:
      tool_progress: off
```

官方列出的平台 key 包含 `telegram` 和 `feishu`，没有单独覆盖的平台会回退到全局 `display.tool_progress`。([Hermes Agent][4])

## 5. Hermes Telegram 的流式展示

Hermes 的 gateway streaming 是顶层配置，不是 `display.streaming`：

```yaml
streaming:
  enabled: true
  transport: edit
  edit_interval: 0.3
  buffer_threshold: 40
  cursor: " ▉"
  fresh_final_after_seconds: 60
```

开启后，机器人会在第一个 token 到达时发送消息，然后不断编辑这条消息；如果平台不支持编辑，会自动关闭该 session 的 streaming，避免刷屏。Telegram 下如果生成时间超过默认 60 秒，Hermes 会把最终答案作为一条新消息发送，以避免 Telegram 编辑消息保留旧时间戳的问题。([Hermes Agent][4])

Hermes 的 Telegram 文档还特别提到通知策略：默认 `important` 模式下，只有最终回复、审批提示、slash-command 确认会响铃；工具进度、流式 chunk、状态消息会以 `disable_notification=true` 发送，避免每个工具调用都推送提醒。([GitHub][5])

## 6. Hermes 的长任务“Still working...”消息

Hermes 还有一种和工具进度不同的长任务心跳/迭代提示，例如：

```text
⏳ Still working... (12 min elapsed — iteration 48/90, running: terminal)
```

社区讨论里提到这类 iteration notification 和 `tool_progress`、`/reasoning hide` 不是同一个开关，可以通过：

```yaml
agent:
  gateway_notify_interval: 0
```

来关闭，或者调大间隔减少提示频率。这个点来自社区经验，不是我在官方配置页里直接看到的主文档项，所以建议实际以你当前 Hermes 版本的 config schema 为准。([Reddit][6])

## 7. 对比总结

| 场景              | OpenClaw Telegram                   | OpenClaw Feishu            | Hermes Telegram / Feishu                                                                |
| --------------- | ----------------------------------- | -------------------------- | --------------------------------------------------------------------------------------- |
| 默认是否只展示最终结果     | 不是，Telegram 默认有预览/工具进度              | 不是，飞书默认 streaming card     | 不是，取决于 `tool_progress`、`streaming`、`interim_assistant_messages`                         |
| 回答流式展示          | 支持，默认 partial                       | 支持，默认 true                 | 支持，但 gateway streaming 默认需配置                                                            |
| 工具调用进度          | Telegram 支持较完整                      | 文档中不如 Telegram 明确          | `display.tool_progress` 控制，支持按平台覆盖                                                      |
| 思考过程            | 默认隐藏；`/reasoning on/stream` 控制      | 默认隐藏；`stream` 仅 Telegram   | 默认 `show_reasoning: false`                                                              |
| 中间 assistant 消息 | 有 block streaming / commentary 相关机制 | `blockStreaming` 可提前 flush | `interim_assistant_messages: true`                                                      |
| 只展示最终结果         | `streaming.mode: off`               | `streaming: false`         | `tool_progress: off` + `streaming.enabled: false` + `interim_assistant_messages: false` |

## 我的建议

如果是 **个人 DM 使用**，建议保留少量工具进度，否则长任务会像卡住一样：

```yaml
tool_progress: new 或 status
streaming: partial / edit
reasoning: off
```

如果是 **群聊 / 飞书工作群 / 多人 Telegram 群**，建议默认只发最终结果，避免刷屏：

OpenClaw Telegram：

```json
{
  "channels": {
    "telegram": {
      "streaming": {
        "mode": "off"
      }
    }
  }
}
```

OpenClaw Feishu：

```json
{
  "channels": {
    "feishu": {
      "streaming": false,
      "blockStreaming": false
    }
  }
}
```

Hermes：

```yaml
display:
  tool_progress: off
  interim_assistant_messages: false
  show_reasoning: false
  platforms:
    telegram:
      tool_progress: off
    feishu:
      tool_progress: off

streaming:
  enabled: false

agent:
  gateway_notify_interval: 0
```

一句话概括：**OpenClaw / Hermes 都不是天然“只展示最终结果”的设计，它们更偏向让用户看到 Agent 正在做什么；但在 Telegram/Feishu 里都可以配置成安静模式，只保留最终答案。**

[1]: https://docs.openclaw.ai/channels/telegram "Telegram - OpenClaw"
[2]: https://docs.openclaw.ai/channels/feishu "Feishu - OpenClaw"
[3]: https://docs.openclaw.ai/tools/thinking?utm_source=chatgpt.com "Thinking levels - OpenClaw"
[4]: https://hermes-agent.nousresearch.com/docs/user-guide/configuration/ "Configuration | Hermes Agent"
[5]: https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/messaging/telegram.md?utm_source=chatgpt.com "hermes-agent/website/docs/user-guide/messaging/telegram.md at main · NousResearch/hermes-agent · GitHub"
[6]: https://www.reddit.com/r/hermesagent/comments/1tln3fz/iteration_message/?utm_source=chatgpt.com "Iteration message"
