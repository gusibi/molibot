import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createFindTool, createGrepTool, createLsTool } from "@earendil-works/pi-coding-agent";
import { createPathGuard, resolveToolPath } from "$lib/server/agent/tools/path.js";

/**
 * Read-only search tools (`grep`, `find`, `ls`) reused from pi.
 *
 * The agent previously had to shell out through `bash` for any search, which
 * meant unstructured output, no shared truncation, needless approval prompts and
 * BSD-vs-GNU flag differences across platforms.
 *
 * `grep` shells out to ripgrep and `find` to fd. Both are expected to be present
 * on PATH — `PI_OFFLINE` is set during bootstrap so pi reports a missing binary
 * instead of downloading one at runtime.
 */

/**
 * Bound a pi search tool to the workspace.
 *
 * pi resolves `path` against cwd itself, and its injectable operations do not
 * cover the fd/ripgrep code paths, so the guard is applied to the tool argument.
 * The argument is then rewritten to the resolved absolute path so the directory
 * that was validated is exactly the directory that gets searched.
 */
function withWorkspaceGuard(
  tool: AgentTool<any>,
  cwd: string,
  ensureAllowedPath: (filePath: string) => void
): AgentTool<any> {
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const requested = (params as { path?: unknown } | undefined)?.path;
      if (typeof requested === "string" && requested.trim() !== "") {
        const resolved = resolveToolPath(cwd, requested);
        ensureAllowedPath(resolved);
        return tool.execute(toolCallId, { ...(params as object), path: resolved }, signal, onUpdate);
      }
      return tool.execute(toolCallId, params, signal, onUpdate);
    }
  };
}

export function createFileSearchTools(options: {
  cwd: string;
  workspaceDir: string;
}): AgentTool<any>[] {
  const ensureAllowedPath = createPathGuard(options.cwd, options.workspaceDir);
  return [
    createGrepTool(options.cwd),
    createFindTool(options.cwd),
    createLsTool(options.cwd)
  ].map((tool) => withWorkspaceGuard(tool, options.cwd, ensureAllowedPath));
}
