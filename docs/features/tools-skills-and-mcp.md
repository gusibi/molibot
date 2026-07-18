# Tools, Skills, and MCP

Molibot gives a personal Agent controlled ways to work with information and local tasks. It separates reusable instructions from executable tools so you can shape behavior without turning every conversation into a one-off prompt.

## What you can configure

- **Profiles** define the Agent's identity, operating rules, and working style.
- **Skills** package reusable workflows and instructions that load when needed.
- **Built-in tools** cover supported runtime capabilities such as search and generated artifacts.
- **MCP servers** connect compatible external tools over configured transports.

## Start here

1. Create an Agent and select its provider route.
2. Review Skills from Settings or add project-local Skills when working in a project.
3. Add an MCP server only when an Agent needs that external capability.

## Boundaries

Tool availability is governed by the active Agent, runtime configuration, and execution policy. A configured integration does not grant unrestricted access to local files, credentials, or shell commands.

## Related documentation

- [Plugin authoring](../guides/plugins/plugin-authoring.md)
- [Deferred tool authoring](../guides/tools/deferred-tool-authoring.md)
- [Plugin manifest design](../designs/plugins/plugin-manifest.md)
