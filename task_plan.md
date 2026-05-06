# Task Plan: Settings shadcn-svelte migration

## Goal
Move the Settings web UI toward shadcn-svelte components and a clean shadcn visual system while leaving the chat page unchanged.

## Current Phase
Phase 5

## Phases

### Phase 1: Discovery
- [x] Confirm framework and current UI component usage
- [x] Confirm shadcn-svelte is the correct SvelteKit path
- [x] Capture migration constraints
- **Status:** complete

### Phase 2: Component Setup
- [x] Add shadcn-svelte project configuration
- [x] Add initial Settings-oriented UI components
- [x] Verify generated imports and Tailwind v4 styling
- **Status:** complete

### Phase 3: Settings Sample Migration
- [x] Migrate a low-risk Settings page to shadcn-svelte
- [x] Migrate the Web Profiles Settings page as the first form/list sample
- [x] Keep chat page untouched
- [x] Keep old custom UI available only as transition support
- **Status:** complete

### Phase 4: Verification
- [x] Run build/type validation
- [x] Fix migration issues without broad refactors
- [x] Check git diff for accidental chat changes
- **Status:** complete

### Phase 5: Documentation
- [x] Update features.md
- [x] Update prd.md
- [x] Update CHANGELOG.md
- [x] Update readme.md if navigation/maintenance guidance changes
- **Status:** complete

## Key Questions
1. Can shadcn-svelte initialize cleanly without overwriting the existing Tailwind entry file?
2. Which Settings page gives the safest migration sample?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Use shadcn-svelte, not React shadcn/ui | The project is SvelteKit and should not introduce a React UI layer. |
| Migrate Settings before chat | User explicitly wants Settings first and chat unchanged. |
| Prefer shadcn visual norms over current workbench styling | User prefers the cleaner shadcn style and current UI is inconsistent. |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| shadcn-svelte generated components imported `$lib/utils.js` but did not create the utility file | 1 | Added `src/lib/utils.ts` with standard `cn()` and explicit `clsx` / `tailwind-merge` dependencies. |
| Codex in-app browser backend was unavailable for local visual QA | 1 | Verified production build and local HTTP 200 response instead; noted that screenshot-level QA was not available in this environment. |

## Notes
- Existing uncommitted changes were present before this work; do not revert them.
- Avoid machine-specific absolute paths in product docs or code.
