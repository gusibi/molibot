# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Context

This is **Molipibot** — a multi-channel bot framework with a settings UI. See [AGENTS.md](AGENTS.md) for the full set of collaboration rules, architecture boundaries, and coding conventions.

**Always read and follow [AGENTS.md](AGENTS.md)** before making any changes. It is the single source of truth for:

- Role & collaboration style (technical co-founder model)
- Architectural layering rules (Channel vs Agent vs shared upper logic)
- File update workflow (features.md, prd.md, CHANGELOG.md, README.md)
- Prompt/session hygiene (temporary control directives must not persist)
- Frontend rules (Shadcn-first, see also DESIGN.md for styling)
- Path & doc hygiene conventions

## Key Files

| File | Purpose |
|------|---------|
| `AGENTS.md` | Long-term collaboration rules & architecture boundaries |
| `DESIGN.md` | UI design system, component specs, CSS conventions |
| `prd.md` | Planned features, priorities, acceptance criteria |
| `features.md` | Delivered features, implementation log |
| `CHANGELOG.md` | High-level release notes |

## Quick Rules

- Layer separation: Channel layer is **messaging only**; shared upper logic (queues, recovery, task orchestration) must not leak into channels.
- Frontend: use Shadcn components from `src/lib/components/ui`. Custom app-level styles must use semantic class names (see DESIGN.md).
- **All toggle/switch controls must use `IosSwitch`** (from `$lib/components/ui/ios-switch`). Do NOT use the generic `Switch` component — its styling does not clearly convey an on/off state. `IosSwitch` provides the expected iOS-style toggle appearance.
- Never hard-code absolute paths (`/Users/...`) into code, docs, or prompts.
- After any feature change, update `features.md` and `CHANGELOG.md`.
