# Bot Interaction 2.0 Requirements

Status: **implemented in PR #58; review follow-up fixes merged to the same branch; live Telegram / Feishu walkthrough pending**

Owner source: GitHub issue #57. This document owns the durable product requirements; the issue remains the review discussion.

## Goal

Telegram and Feishu expose native controls for frequent Agent operations so users do not have to remember Slash Command parameters. Slash Commands remain supported shortcuts. Both entrances use the same shared business actions and preserve existing Agent, queue, approval, permission, Project, and Session semantics.

Ordinary natural-language messages continue through the existing Agent path. Only explicit commands, callbacks, cards, confirmations, and bound input replies enter the interaction layer.

## In scope

- A grouped `/menu` for Conversation, Agent, Workspace, and Runtime actions.
- Clickable Model, Session, Project, Thinking, Skills, Queue, and Status views.
- Session creation/switching and confirmed deletion for ordinary Sessions.
- Project Session listing/switching; Project Session deletion remains Desktop-only.
- Skill detail and explicit Skill use through a normal Agent request.
- Stop, Steer, Follow-up, queue-item cancel/retry, queue-front insertion, and confirmed clear-pending.
- Lightweight reply-bound input for Steer, Follow-up, queue-front, and Skill use.
- Contextual controls backed by structured state: current run, busy-queue notification, and long-context Compact/New Session.
- Telegram InlineKeyboard and Feishu Interactive Card renderers.
- Short server-side callback tokens with actor/scope/state binding, expiry, cleanup, and duplicate suppression.

## Required existing semantics

- **Stop** stops the current run and clears pending queued work. If pending items exist, native UI must show the affected count and require confirmation.
- **Queue cancel** removes only the selected pending item. An item that already started is reported as running; the action must not silently become Stop.
- **Queue front** creates a new task at the front; existing queue items are never reordered.
- **Clear pending** clears the confirmed pending set and never stops the current run.
- **Session delete** is confirmed and binds the exact Session. Project Sessions remain Desktop-managed.
- **Session / Project changes** must honor the same busy-state restrictions as Slash Commands.
- **Thinking** comes from the current model's supported levels and exposes the effective value plus reset-to-default.
- **Model and Thinking changes** state when the new value takes effect.
- **Skill use** enters the existing Agent / Skill / queue / approval path; the interaction layer never executes a Skill as an independent script.

## Input lifecycle

Steer, Follow-up, queue-front, and Skill use create a dedicated input prompt.

A submission is accepted only when all of these still match the server-side request:

- channel and bot instance;
- trusted platform actor;
- chat plus topic/thread scope;
- Session and Project;
- run ID when the action targets a run;
- original prompt message;
- TTL.

Only an explicit reply to the prompt is consumed. Unrelated messages remain normal Agent messages. Cancellation, expiry, duplicate delivery, stale target state, and successful submission retire the prompt. Every retired prompt keeps a terminal tombstone, so a late reply is rejected with an explicit result instead of falling through as an ordinary message. Completed prompts stay as short-lived idempotency tombstones so a platform retry cannot become a second Agent request. The prompt record is persisted per bot instance; after a service restart a reply to an old prompt is still recognised and rejected as expired, never silently executed as a fresh task.

## Callback and confirmation safety

- Platform payloads carry only unpredictable short tokens. Real action data and target IDs live server-side.
- Interaction panels are bound to the actor who opened them.
- Mutating actions re-check current business state at execution time.
- Old Stop / Steer / Follow-up actions cannot target a newer run.
- Destructive confirmation binds the exact affected set. If the run, Session, Project, or pending queue changes, the confirmation expires and must be regenerated.
- Read-only navigation/refresh actions may be reused; mutating actions are one-shot.
- Service restart intentionally invalidates the in-memory button registry and old buttons fail closed with a reopen-menu instruction. Bound input prompts are persisted per bot instance, so a restart also fails closed for replies to prompts issued before the restart rather than treating them as ordinary Agent messages.
- Business completion and message-update completion are separate: a failed edit may send a result message, but never retries the business mutation.

Approval and Memory Review retain their existing specialized authorization and persistence; they are not converted to menu-token lifecycle.

## Platform behavior

### Telegram

- `/menu`, `/start`, and the high-frequency no-argument commands render InlineKeyboard views.
- Input actions send a dedicated prompt; only a reply to that message is consumed.
- Busy-message queue controls use the shared interaction token path rather than the retired `qctl:*` callback format.

### Feishu

- Equivalent views render as non-forwardable Interactive Cards.
- Mutating card actions acknowledge immediately with a Processing card, complete once in the background, then edit the source card or send a fallback result.
- Input prompts reply to the source card and preserve thread scope.
- Existing Approval and Memory Review cards keep their dedicated handlers.

## Context actions

Context actions are emitted only from trusted structured state; model text never becomes executable callback payload.

Delivered state-backed entrances are:

- Status: Stop / Steer / Follow-up while a stable persisted run is active.
- Busy Queue notice: Stop and exact queued-message Steer.
- Status: Compact / New Session when the current ordinary Session reaches the existing compaction threshold derived from the active model context window and compaction settings.
- Model / Session / Project / Skill discovery views: actions bind stable IDs returned by their existing stores.

No generic model-authored action schema is introduced. These entrances are emitted from the shared menu/Status views and the busy-queue notice; no Agent tool result attaches executable buttons in this slice, and closing that gap would require a new result protocol that is explicitly out of scope here.

## Explicit exclusions

- Telegram Mini App.
- QQ / Weixin / Desktop interaction renderer.
- generic forms or a generic UI framework.
- Project Session deletion.
- queue reordering.
- buttons generated from arbitrary Agent prose.
- mandatory SDK upgrade.
- migration of Approval or Memory Review to interaction tokens.

## Acceptance

Machine acceptance requires targeted coverage for token lifecycle, actor/scope/state rejection, duplicate submission, input binding, channel renderers, existing channel tests, and a production build.

Live acceptance still requires real Telegram and Feishu walkthroughs covering first open, model/session/project/thinking/skill flows, run controls, thread/topic binding, service restart stale buttons, and result fallback behavior. Until those live checks are recorded, the capability matrix status is **待验证**, not **已交付**.
