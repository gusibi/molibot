# Findings

- Existing task inventory and mutation API: `src/routes/api/settings/tasks/+server.ts`.
- Existing fresh scheduled sessions are created by shared runtime store and use `task-*` ids.
- Existing persistent event lease store already tracks attempt/run coordination and should remain the execution lock authority.
- UI must follow `DESIGN.md`, shared semantic CSS, shadcn-svelte components, i18n, dark theme, and mobile behavior.
- The user clarified the target page is the macOS app Automations entry opened from ChatView, not the Web `/settings/tasks` page. `/settings/tasks` should remain the full watched-event diagnostics/records page.
- Desktop has a credential-safe `/api/desktop/tasks` proxy over the Web settings task API. This is the correct place to filter to periodic-only and attach execution history without changing the Web settings page.
- Desktop task projection should remain path-safe and pure for tests; SQLite execution history is injected at the desktop API route layer.
