<script lang="ts">
  import type { DesktopConversationActivity } from "@molibot/desktop-contract";
  import { html as renderDiffHtml } from "diff2html";
  import type { Translation } from "../i18n";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import { activityFileSummary, activityHeadline, activityPreview, activityToolIcon, classifyActivityBody, formatActivityMetadata } from "./activityView";
  import { loadActivityExpansion, saveActivityExpansion } from "./activityExpansionStore";

  export let activities: DesktopConversationActivity[];
  export let copy: Translation;
  /**
   * Opens a path the run touched in the Artifact Panel. Injected by the host:
   * this component must not know whether it sits beside a Project tree or a
   * plain conversation (pitfall #7). Omitted, the chips render as inert labels.
   */
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;
  export let stateKey = "";
  export let failed = false;

  $: hasRunning = activities.some((activity) => activity.state === "running");
  $: hasError = activities.some((activity) => activity.state === "error");
  $: isFailed = failed || (activities.some((activity) => activity.state === "running") && !hasRunning);
  $: headline = activityHeadline(activities);
  $: files = activityFileSummary(activities);

  // The list stays collapsed until the user opens it, and tool summaries carry
  // whole file bodies — on a real transcript they are ~90% of the payload and
  // of the resulting DOM. Building all of that behind a closed `<details>` cost
  // a visible chunk of every session switch for markup nobody could see, so the
  // rows are mounted on first open instead.
  let restoredKey = "";
  let opened = false;
  let expandedBodies = new Set<string>();
  $: if (stateKey && stateKey !== restoredKey) {
    restoredKey = stateKey;
    const restored = loadActivityExpansion(stateKey);
    opened = restored.opened;
    expandedBodies = restored.bodies;
  }

  function toggleBody(key: string): void {
    const next = new Set(expandedBodies);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedBodies = next;
    saveActivityExpansion(stateKey, { opened, bodies: expandedBodies });
  }

  function persistOpen(): void {
    saveActivityExpansion(stateKey, { opened, bodies: expandedBodies });
  }

  function icon(state: DesktopConversationActivity["state"]): string {
    if (state === "running") return "circle-notch";
    if (state === "success") return "check-circle";
    if (state === "error") return "x-circle";
    return "info";
  }

  function stepLabel(current: { index: number; total: number }): string {
    return copy.runActivityStep
      .replace("{index}", String(current.index))
      .replace("{total}", String(current.total));
  }

  function fileChipLabel(template: string, count: number): string {
    return template.replace("{count}", String(count));
  }

  function fileName(path: string): string {
    return path.split("/").pop() || path;
  }

  /**
   * diff2html is fed a real unified patch and themed through its own `--d2h-*`
   * variables — see the `.project-diff-preview` block in `styles.css`, whose
   * class the container below borrows rather than declaring a second palette
   * that would silently drift from it (pitfall #17).
   */
  function diffHtml(diff: string): string {
    return renderDiffHtml(diff, {
      drawFileList: false,
      outputFormat: "line-by-line",
      matching: "lines",
      renderNothingWhenEmpty: false
    });
  }
</script>

<div class="run-activity-block">
  <details class="run-activity" bind:open={opened} ontoggle={persistOpen}>
    <summary class="run-activity-head">
      {#if hasRunning}
        <span class="timeline-wave-node run-activity-wave-node" aria-hidden="true">
          <span class="timeline-wave-bar"></span>
          <span class="timeline-wave-bar"></span>
          <span class="timeline-wave-bar"></span>
        </span>
      {:else}
        <i class={`ph-fill ph-${isFailed ? "warning-circle" : "check-circle"}`} aria-hidden="true"></i>
      {/if}
      <span>{hasRunning ? copy.runProgress : isFailed ? copy.runFailed : copy.runCompleted}</span>
      <!--
        Naming the step the head is about is the difference between "23 actions
        happened" and knowing where a long run actually is. Hidden once the list
        is open, where every step names itself.
      -->
      {#if headline && !opened}
        <span class="run-activity-step">{stepLabel(headline)}</span>
        <span class="run-activity-current" title={headline.label}>{headline.label}</span>
      {/if}
      <span class="run-activity-count">{activities.length}</span>
      <i class="ph ph-caret-down run-activity-caret" aria-hidden="true"></i>
    </summary>

    <div class="run-activity-list">
      {#if opened}
        {#each activities as activity (activity.key)}
          {@const body = classifyActivityBody(activity)}
          {@const metadata = formatActivityMetadata(activity)}
          {@const rawBodyContent = body?.kind === "diff" ? (body.diff ?? "") : (body?.content ?? "")}
          {@const preview = activityPreview(rawBodyContent)}
          {@const bodyContent = expandedBodies.has(activity.key) ? rawBodyContent : preview.content}
          {@const toolIcon = activityToolIcon(activity)}
          {#if body}
            <details class="run-activity-item" data-state={activity.state} data-body={body.kind} open={activity.state === "error"}>
              <summary>
                {#if activity.state === "running"}
                  <span class="timeline-wave-node run-activity-wave-node" aria-hidden="true">
                    <span class="timeline-wave-bar"></span>
                    <span class="timeline-wave-bar"></span>
                    <span class="timeline-wave-bar"></span>
                  </span>
                {:else}
                  <i class={`ph-fill ph-${icon(activity.state)}`} aria-hidden="true"></i>
                {/if}
                <span class="process-tool-title">
                  <i class={`ph ph-${toolIcon} process-tool-icon`} class:process-tool-running={activity.state === "running"} aria-hidden="true"></i>
                  <span class="process-tool-label-text">{activity.label}</span>
                  {#if metadata.length}<small>{metadata.join(" · ")}</small>{/if}
                </span>
                <i class="ph ph-caret-right run-activity-item-caret" aria-hidden="true"></i>
              </summary>
              <!--
                One renderer per payload shape, all of them components the
                Artifact Panel already uses. A single `<pre>` for every tool is
                what made a patch, a file, a shell transcript and an MCP payload
                indistinguishable blocks of grey monospace.
              -->
              <div class="run-activity-body">
                {#if body.kind === "diff" && body.diff}
                  <div class="project-diff-preview run-activity-diff">{@html diffHtml(bodyContent)}</div>
                {:else if body.kind === "code" || body.kind === "json"}
                  <!--
                    JSON goes through `CodeViewer` too, not `JsonTree`: the
                    tree's styles are declared only under `.artifact-panel`, so
                    mounting it here would render unstyled markup with nothing
                    in the console — and a collapsible tree inside a 300px
                    inline box reads worse than highlighted source with line
                    numbers. Classification still separates the two, so the
                    viewer is handed the right language.
                  -->
                  <div class="run-activity-viewer">
                    <CodeViewer
                      content={bodyContent}
                      filePath={body.kind === "json" ? `${activity.key}.json` : (body.filePath ?? "")}
                      {copy}
                    />
                  </div>
                {:else if body.kind === "terminal"}
                  <pre class="run-activity-terminal">{bodyContent}</pre>
                {:else}
                  <pre>{bodyContent}</pre>
                {/if}
                {#if preview.truncated}
                  <div class="run-activity-more">
                    {#if activity.paths?.[0] && onOpenPath}
                      <button type="button" onclick={() => onOpenPath?.(activity.paths![0], activity.mutates === true)}>{copy.runActivityOpenFile}</button>
                    {/if}
                    <button type="button" aria-expanded={expandedBodies.has(activity.key)} onclick={() => toggleBody(activity.key)}>{expandedBodies.has(activity.key) ? copy.collapseMessage : copy.expandMessage}</button>
                  </div>
                {/if}
              </div>
            </details>
          {:else}
            <div class="run-activity-item run-activity-line" data-state={activity.state}>
              {#if activity.state === "running"}
                <span class="timeline-wave-node run-activity-wave-node" aria-hidden="true">
                  <span class="timeline-wave-bar"></span>
                  <span class="timeline-wave-bar"></span>
                  <span class="timeline-wave-bar"></span>
                </span>
              {:else}
                <i class={`ph-fill ph-${icon(activity.state)}`} aria-hidden="true"></i>
              {/if}
              <span class="process-timeline-label">
                <i class={`ph ph-${toolIcon} process-tool-icon`} class:process-tool-running={activity.state === "running"} aria-hidden="true"></i>
                <span class="process-tool-label-text">{activity.label}</span>
              </span>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </details>

  <!-- Writes belong to the completed-turn file list; only read context remains
    attached to the execution trace. -->
  {#if files.read.length}
    <div class="run-activity-files">
      <span class="run-activity-files-label">
        <i class="ph ph-eye" aria-hidden="true"></i>{fileChipLabel(copy.runActivityFilesRead, files.read.length)}
      </span>
      {#each files.read as path (path)}
        <button
          type="button"
          class="run-activity-file"
          disabled={!onOpenPath}
          title={onOpenPath ? `${path} — ${copy.runActivityOpenFile}` : path}
          onclick={() => onOpenPath?.(path, false)}
        >{fileName(path)}</button>
      {/each}
    </div>
  {/if}
</div>
