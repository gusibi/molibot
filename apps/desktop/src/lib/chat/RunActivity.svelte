<script lang="ts">
  import type { DesktopConversationActivity } from "@molibot/desktop-contract";
  import { html as renderDiffHtml } from "diff2html";
  import type { Translation } from "../i18n";
  import CodeViewer from "../projects/CodeViewer.svelte";
  import { activityFileSummary, activityHeadline, classifyActivityBody } from "./activityView";

  export let activities: DesktopConversationActivity[];
  export let copy: Translation;
  /**
   * Opens a path the run touched in the Artifact Panel. Injected by the host:
   * this component must not know whether it sits beside a Project tree or a
   * plain conversation (pitfall #7). Omitted, the chips render as inert labels.
   */
  export let onOpenPath: ((path: string, mutates: boolean) => void) | null = null;

  $: hasRunning = activities.some((activity) => activity.state === "running");
  $: hasError = activities.some((activity) => activity.state === "error");
  $: headline = activityHeadline(activities);
  $: files = activityFileSummary(activities);

  // The list stays collapsed until the user opens it, and tool summaries carry
  // whole file bodies — on a real transcript they are ~90% of the payload and
  // of the resulting DOM. Building all of that behind a closed `<details>` cost
  // a visible chunk of every session switch for markup nobody could see, so the
  // rows are mounted on first open instead.
  let opened = false;

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
  <details class="run-activity" bind:open={opened}>
    <summary class="run-activity-head">
      <i class={`ph${hasRunning ? "" : "-fill"} ph-${hasRunning ? "circle-notch" : hasError ? "warning-circle" : "check-circle"}`} class:spin={hasRunning} aria-hidden="true"></i>
      <span>{hasRunning ? copy.runProgress : hasError ? copy.runFailed : copy.runCompleted}</span>
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
          {#if body}
            <details class="run-activity-item" data-state={activity.state} data-body={body.kind} open={activity.state === "error"}>
              <summary><i class={`ph${activity.state === "running" ? "" : "-fill"} ph-${icon(activity.state)}`} class:spin={activity.state === "running"} aria-hidden="true"></i><span>{activity.label}</span><i class="ph ph-caret-right run-activity-item-caret" aria-hidden="true"></i></summary>
              <!--
                One renderer per payload shape, all of them components the
                Artifact Panel already uses. A single `<pre>` for every tool is
                what made a patch, a file, a shell transcript and an MCP payload
                indistinguishable blocks of grey monospace.
              -->
              <div class="run-activity-body">
                {#if body.kind === "diff" && body.diff}
                  <div class="project-diff-preview run-activity-diff">{@html diffHtml(body.diff)}</div>
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
                      content={body.content}
                      filePath={body.kind === "json" ? `${activity.key}.json` : (body.filePath ?? "")}
                      {copy}
                    />
                  </div>
                {:else if body.kind === "terminal"}
                  <pre class="run-activity-terminal">{body.content}</pre>
                {:else}
                  <pre>{body.content}</pre>
                {/if}
              </div>
            </details>
          {:else}
            <div class="run-activity-item run-activity-line" data-state={activity.state}><i class={`ph${activity.state === "running" ? "" : "-fill"} ph-${icon(activity.state)}`} class:spin={activity.state === "running"} aria-hidden="true"></i><span>{activity.label}</span></div>
          {/if}
        {/each}
      {/if}
    </div>
  </details>

  <!--
    What the turn actually touched, from the `paths`/`mutates` the runtime has
    recorded all along and nothing rendered. A sibling of the `<details>`, never
    a child: a collapsed `<details>` hides every child after its `<summary>`, so
    a summary nested inside would only appear once you had already expanded the
    very thing it exists to save you from expanding.
  -->
  {#if files.written.length || files.read.length}
    <div class="run-activity-files">
      {#if files.written.length}
        <span class="run-activity-files-label" data-mutates="true">
          <i class="ph ph-pencil-simple-line" aria-hidden="true"></i>{fileChipLabel(copy.runActivityFilesChanged, files.written.length)}
        </span>
        {#each files.written as path (path)}
          <button
            type="button"
            class="run-activity-file"
            data-mutates="true"
            disabled={!onOpenPath}
            title={onOpenPath ? `${path} — ${copy.runActivityOpenFile}` : path}
            onclick={() => onOpenPath?.(path, true)}
          >{fileName(path)}</button>
        {/each}
      {/if}
      {#if files.read.length}
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
      {/if}
    </div>
  {/if}
</div>
