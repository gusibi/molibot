# Tools, Skills, and MCP

Molibot gives a personal Agent controlled ways to work with information and local tasks. It separates reusable instructions from executable tools so you can shape behavior without turning every conversation into a one-off prompt.

## What you can configure

- **Profiles** define the Agent's identity, operating rules, and working style.
- **Skills** package reusable workflows and instructions that load when needed.
- **Built-in tools** cover supported runtime capabilities such as search and generated artifacts.
- **MCP servers** connect compatible external tools over configured transports.

MCP enablement and connection health are separate. An enabled server may be disconnected or in error when its local process or HTTP endpoint is unavailable. Web and Desktop Settings show the live state and offer **Reconnect**; disabling or deleting a server closes its runtime connection. When a previously connected service returns, the next explicit Agent load or operator reconnect creates a fresh client without requiring a Molibot restart.

Built-in ingestion is split by responsibility. `read` handles workspace text and can pass an image to an already-active vision model; `imageAnalyze` deliberately dispatches a workspace image to the configured Agent/global vision route for OCR or general understanding; `webFetch` reads guarded public webpages; `docExtract` extracts text and tables from workspace PDF, DOCX, and XLSX files.

Built-in deliverable generation is equally explicit. `documentExport` writes DOCX, XLSX, or PDF only inside Project or Session scratch, re-reads the result with an independent format parser, verifies requested text/sheets/cells, and only then atomically publishes or attaches it. PPTX generation is intentionally deferred.

`imageAnalyze` and PDF OCR never accept an arbitrary model id from the Agent. They use the existing `visionModelKey`, record the resolved Provider/model, and share one vision-analysis module with inbound attachment fallback. `docExtract` defaults to `ocr=auto`, which only rasterizes low-text PDF pages containing embedded images; `ocr=force` transcribes every page and `ocr=never` guarantees no vision-model call. OCR is serialized and limited to 20 pages per tool call. All extracted or analyzed content is untrusted evidence and uses the shared context-output budget/full-output spill path.

## Start here

1. Create an Agent and select its provider route.
2. Review Skills from Settings or add project-local Skills when working in a project.
3. Add an MCP server only when an Agent needs that external capability.

## Boundaries

Tool availability is governed by the active Agent, runtime configuration, and execution policy. A configured integration does not grant unrestricted access to local files, credentials, or shell commands.

Connections may be shared by the runtime, but tool visibility remains Session-scoped. Loading an MCP server in one Session neither exposes it to another Session nor unloads the other Session's selected servers.

## Related documentation

- [Plugin authoring](../guides/plugins/plugin-authoring.md)
- [Deferred tool authoring](../guides/tools/deferred-tool-authoring.md)
- [Plugin manifest design](../designs/plugins/plugin-manifest.md)
