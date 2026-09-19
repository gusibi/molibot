# Bot Interaction 2.0 Channel Design

This document describes the shipped interaction architecture for Telegram and Feishu. Product requirements and live-acceptance status live in [the requirement](../../requirements/bot-interaction-2.md).

## Layering

```text
Slash Command / Telegram callback / Feishu card action
                         |
             trusted channel identity recovery
                         |
              SharedInteractionService
                         |
        SharedRuntimeCommandService actions
                         |
               structured outcome/view
                         |
       Telegram / Feishu channel renderer
```

Natural-language messages do not traverse `SharedInteractionService`. The interaction layer is a control-plane path beside the ordinary Agent message path, not a replacement Channel Runtime.

`SharedRuntimeCommandService` owns the business operations used by both Slash Commands and native controls. The interaction service owns menu/view composition, action routing, token lifecycle, confirmation snapshots, and bound input requests. Channel runtimes own protocol events, trusted actor recovery, callback acknowledgement, message edit/send fallback, and rendering.

## Shared view model

`InteractionView` deliberately covers only the current product:

- title/body;
- sections and rows;
- selected state;
- buttons with style hints;
- pagination/back/refresh;
- confirmation;
- input request.

Actions use a discriminated union. Renderers never parse command-response prose and buttons never construct Slash Commands to mutate state. Skill submission is the one intentional bridge back to the normal Agent path: after the bound prompt is validated, it produces an explicit Skill invocation as the user task and lets the existing Agent pipeline own execution.

## Token registry

Every native button receives a random Base64URL token. The token is the only executable value sent to Telegram or Feishu.

The in-memory registry stores:

- action;
- bot/channel-owned target object;
- actor ID;
- chat and topic/thread scope;
- Session, Project, and run binding;
- expiry;
- one-shot/reusable mode;
- in-flight/completed state for idempotency.

Registry size is bounded. Expired entries and oldest overflow entries are removed. Restart drops the registry by design.

Navigation actions ending in `.open` are reusable and re-read current state. Mutations compare the stored state binding before execution. Actions with additional affected sets, such as Stop-with-pending and Clear-pending, also compare the current queue IDs at confirmation time.

The token is a lookup key, not authorization. Business handlers still check availability and busy-state restrictions.

## Run ownership

Run-targeting controls never use “whatever is running now.” The shared command service first requires the scope's runner to report running, then resolves the latest persisted `runs.status = 'running'` row for the bound Session. That persisted run ID is registered with Stop / Steer / Follow-up actions and rechecked before mutation.

If the run ended or a newer run replaced it, the old action fails stale rather than redirecting.

## Bound input requests

An input request is stored separately from button tokens and contains its exact prompt message ID after the channel sends the prompt.

The channel consumes a user message as control input only when it is a reply to that prompt and actor/chat/scope all match. Session/Project/run state is then revalidated.

A successful submission becomes a short-lived completed tombstone. This prevents duplicate platform deliveries from falling through as ordinary chat messages or triggering a second Agent request. Expired bound prompts also remain briefly as expired tombstones so an explicit late reply is rejected rather than entering conversation history.

Input prompts do not acquire the Agent run lock.

## Confirmation snapshots

Destructive or broad mutations do not infer their target set again after confirmation:

- Session delete stores the Session ID.
- Clear-pending stores the exact pending queue IDs.
- Stop stores the run ID plus exact pending queue IDs when pending work exists.

If the snapshot no longer matches, the confirmation returns stale and the user must refresh. This prevents a confirmation from expanding to work that appeared after the user saw the prompt.

## Telegram adapter

The Telegram renderer maps views to text plus `InlineKeyboard`. Callback data is `ix:<token>` and stays comfortably below Telegram's callback-data limit.

Input requests are messages with a Cancel button. The original prompt is edited to its terminal state after success/cancel/stale/expiry when possible; send fallback is used when editing fails.

Busy-queue controls use the same token registry and shared actions. The old `qctl:*` callback implementation is removed so queue controls have one authorization and stale-state model.

## Feishu adapter

The Feishu renderer emits non-forwardable cards with token-only values:

```json
{ "kind": "interaction", "token": "<short-token>" }
```

Reusable navigation may return the next card directly. One-shot actions use the existing card-action coordinator: the callback returns Processing promptly, the action completes once, and the source card is updated asynchronously. If source-card editing fails after a successful mutation, a result card is sent instead; the mutation is not replayed.

Input prompts reply to the source card. When the interaction scope is a thread, `reply_in_thread` preserves that scope, allowing the later reply to satisfy the same server-side binding.

Approval and Memory Review remain separate card protocols because their authorization and durability differ from menu controls.

## Long-context action

Status reads the ordinary Session's existing context-token snapshot and the current text model's context window. It computes the same trigger boundary used by compaction:

```text
min(
  contextWindow * thresholdPercent,
  contextWindow - reserveTokens
)
```

When the Session is idle and its estimated context has reached that threshold, Status offers Compact and New Session. Project Sessions are excluded because this slice does not expose a Project-session compaction business action.

## Failure model

- Unknown/expired token: no mutation; tell the user to reopen the menu.
- Wrong actor/chat/topic: no mutation.
- Changed Session/Project/run: stale result.
- Changed pending set during confirmation: stale result and reconfirm.
- Duplicate one-shot callback: one business execution.
- Duplicate input delivery: no second task.
- Renderer/edit failure after business success: send fallback only.
- service restart: old menu/input state is intentionally unavailable.

These rules are the stable compatibility boundary for future channel renderers; future platforms may reuse the actions without forcing Telegram/Feishu protocol details into the shared layer.
