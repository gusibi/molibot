# Findings & Decisions

## Requirements
- Keep SvelteKit.
- Switch the Settings UI component system toward shadcn-svelte.
- Use shadcn's clean visual style rather than preserving the current Settings look.
- Do not touch the chat page in this migration pass.
- Keep changes staged by risk: component setup first, then a low-risk Settings page.

## Research Findings
- The project is SvelteKit with Svelte 5 and Tailwind CSS 4.
- Current shared web UI components are small and local: Button, Card, Alert, and PageShell.
- Most Settings UI is still direct Tailwind markup, so full consistency requires gradual page migration beyond replacing shared components.
- shadcn-svelte supports Svelte 5 and Tailwind v4, and its CLI writes components into the source tree.

## Technical Decisions
| Decision | Rationale |
|----------|-----------|
| Use shadcn-svelte CLI and generated source components | This matches shadcn's source-owned component model and avoids hidden runtime abstractions. |
| Keep `src/lib/ui` during transition | Existing Settings pages still import these components; deleting them now would broaden the migration unnecessarily. |
| Start with a low-risk Settings page | Proves styling, imports, and build compatibility before touching dense AI/provider pages. |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| shadcn-svelte component generation did not add the expected `$lib/utils.js` helper | Added `src/lib/utils.ts`; SvelteKit resolves `$lib/utils.js` to the TypeScript source during bundling. |

## Resources
- shadcn-svelte SvelteKit installation: https://www.shadcn-svelte.com/docs/installation/sveltekit
- shadcn-svelte Tailwind v4 notes: https://shadcn-svelte.com/docs/migration/tailwind-v4
- shadcn-svelte components.json reference: https://shadcn-svelte.com/docs/components-json
- shadcn-svelte components list: https://www.shadcn-svelte.com/docs/components

## Visual/Browser Findings
- No screenshots used yet.
