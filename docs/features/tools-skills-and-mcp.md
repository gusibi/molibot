# Tools, Skills, and MCP

Molibot gives a personal Agent controlled ways to work with information and local tasks. It separates reusable instructions from executable tools so you can shape behavior without turning every conversation into a one-off prompt.

## What you can configure

- **Profiles** define the Agent's identity, operating rules, and working style.
- **Skills** package reusable workflows and instructions that load when needed.
- **Built-in tools** cover supported runtime capabilities such as search and generated artifacts.
- **MCP servers** connect compatible external tools over configured transports.

MCP enablement and connection health are separate. An enabled server may be disconnected or in error when its local process or HTTP endpoint is unavailable. Web and Desktop Settings show the live state and offer **Reconnect**; disabling or deleting a server closes its runtime connection. When a previously connected service returns, the next explicit Agent load or operator reconnect creates a fresh client without requiring a Molibot restart.

Each remote MCP tool request has a fixed two-minute execution limit, including calls made through `mcpInvoke`. Progress does not extend it, and approval waiting is outside this limit. Timeout returns an error and signals cancellation; a remote write may still finish if the server ignores cancellation, so verify its outcome before retrying.

Built-in ingestion is split by responsibility. `read` handles workspace text and images: it returns the original image when the active primary model supports vision, and otherwise invokes the configured image-recognition engines on demand. The same image may be read repeatedly with different prompts. `webFetch` reads guarded public webpages; `docExtract` extracts text and tables from workspace PDF, DOCX, and XLSX files.

Built-in deliverable generation is equally explicit. `documentExport` writes DOCX, XLSX, or PDF only inside Project or Session scratch, re-reads the result with an independent format parser, verifies requested text/sheets/cells, and only then atomically publishes or attaches it. PPTX generation is intentionally deferred.

Image recognition and PDF OCR never accept an arbitrary model id from the Agent. Settings owns an ordered list of API engines, each bound to a configured vision model; automatic mode records attempts and fails over in that order. The engine runner is isolated behind an adapter seam for a later local-CLI adapter, but phase one exposes API engines only. `docExtract` defaults to `ocr=auto`, which only rasterizes low-text PDF pages containing embedded images; `ocr=force` transcribes every page and `ocr=never` guarantees no vision-model call. OCR is serialized and limited to 20 pages per tool call. All extracted or recognized content is untrusted evidence and uses the shared context-output budget/full-output spill path.

## Skill capability view

The Skills workspace answers whether an Agent can actually use a Skill, not just where its file lives. Every card reports installed / enabled / reachable-with-reasons (disabled, duplicate name, unparseable, missing, broken link, no workspace, missing dependency), trailing-30-day usage from `skill_usage` trace facts (triggered, loaded, executed, last used), and any declared MCP server or CLI signal that is not ready.

Detail adds the selection contract: aliases, CLI/MCP/tool signals, pre-approved tools, and whether `disable-model-invocation` keeps the Skill out of automatic discovery. Cards can insert `/alias ` into the active composer, and the detail header owns an enable switch. Batch enable/disable reuses the per-entry write path so the catalogue summary stays authoritative.

Owners can create and edit Skills without leaving the workspace. Creation writes into the chosen Molibot root (global, an Agent workspace, or a project), adopts the entry immediately, and rejects an existing name. Editing writes SKILL.md only after its frontmatter still parses with a name and description. Timestamped sibling backups are listable per Skill and restorable; restoring moves the current content to a new backup first. Git-installed Skills can preview the upstream `commit..HEAD` file list and unified diff before applying an update, and the Advanced view can check every Git-installed Skill and apply all available updates through the same preflight/replace path, one at a time.

The workspace keeps one quiet navigation layer: the title, three counted segments, and content. Advanced maintenance is a single centered document column with hairline-separated sections (platform rules, batch update, recent operations, diagnostics). Platform rows open on demand, so the folder list is configuration rather than the default reading surface; roots render relative to the server home (`~/…`), counts sit next to the path they describe, and a missing folder is labelled instead of only dimmed. Creating and editing a Skill share one sheet: fixed title and commit row, one scrolling body, and localized validation for the name. Cards stay silent unless something is wrong; the detail view owns the full explanation. Remote discovery and Registry installs remain out of scope for this version.

Discovery groups `~/.agents/skills` as **Global** rather than attributing it to one vendor. OpenCode and OpenClaw still read that tree, so a card's `sharedWith` list reports them, but the group answers "where this content belongs", not "which adapter happened to scan it first".

The Web `/settings/skills` page renders the same two scopes the server produces (global and Agent) and toggles one path at a time. Skill search configuration owns local search, provider/model, base URL, request path and an API key that is never sent back to the client after being stored.

## Start here

1. Create an Agent and select its provider route.
2. Review Skills in the Skills workspace or add project-local Skills when working in a project.
3. Add an MCP server only when an Agent needs that external capability.

## Boundaries

Tool availability is governed by the active Agent, runtime configuration, and execution policy. A configured integration does not grant unrestricted access to local files, credentials, or shell commands.

Connections may be shared by the runtime, but tool visibility remains Session-scoped. Loading an MCP server in one Session neither exposes it to another Session nor unloads the other Session's selected servers.

## Related documentation

- [Skill maintenance](skill-maintenance.md)

- [Plugin authoring](../guides/plugins/plugin-authoring.md)
- [Deferred tool authoring](../guides/tools/deferred-tool-authoring.md)
- [Plugin manifest design](../designs/plugins/plugin-manifest.md)
