# Channels and Surfaces

Molibot uses one runtime across several ways of working. Pick the surface that fits the moment, while keeping configuration and session behavior in one local system.

## Available surfaces

| Surface | Best for |
| --- | --- |
| Web | Browser-based chat, configuration, and session access. |
| macOS Desktop | Native chat, project workspaces, files, automations, and Settings. |
| Telegram | A personal chat-channel entrypoint with runtime commands and file delivery. |
| Feishu | A chat-channel entrypoint with media handling and channel-native interaction. |
| Weixin | A local connection for personal conversations and media delivery. |
| QQ | A local chat-channel entrypoint with rich message and media support. |
| CLI | Terminal-based local conversations. |

## What stays shared

Providers, Agent profiles, configured tools, Skills, task controls, and durable session data are managed by the same runtime. Individual channels still keep their own delivery and presentation behavior.

## Boundaries

Channel availability depends on your local configuration and credentials. Group collaboration and external publishing should be validated for your own deployment before relying on them.

## Related documentation

- [Personal Agent and Memory](personal-agent-and-memory.md)
- [Session control commands](../guides/session-control/session-control-commands.md)
- [Delivered changes](../../features.md)
