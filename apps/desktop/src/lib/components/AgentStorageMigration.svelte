<script lang="ts">
  import { onDestroy } from "svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Button from "./ui/Button.svelte";
  import SelectControl from "./ui/SelectControl.svelte";
  import { loadAgentStorageMigration, confirmAgentStorageMigration, previewAgentStorageMigration, type AgentStorageMigrationStatus } from "../api";
  import type { Locale } from "../i18n";
  let { endpoint, serviceAvailable, locale, onReady, onPending, onError, open = $bindable(false) }: { endpoint: string | null; serviceAvailable: boolean; locale: Locale; onReady: (ready: boolean) => void; onPending: (pending: boolean) => void; onError: (error: string) => void; open?: boolean } = $props();
  let status = $state<AgentStorageMigrationStatus | null>(null);
  let busy = $state(false);
  let previewing = $state(false);
  let error = $state("");
  let checked = $state("");
  let requestGeneration = 0;
  let statusEndpoint = "";
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  onDestroy(() => { requestGeneration += 1; clearTimeout(retryTimer); });
  let assignmentRevision = $state(0);
  const zh = $derived(locale === "zh-CN");
  const migrationRunning = $derived(status?.running ?? false);
  const phaseLabel = $derived(status ? (status.conflicts.length ? (zh ? "需要处理" : "Needs attention") : zh ? ({ pending: "等待确认", copying: "复制中", prepared: "校验完成", committing: "切换中", completed: "已完成" }[status.phase] ?? status.phase) : ({ pending: "Awaiting confirmation", copying: "Copying", prepared: "Verified", committing: "Switching", completed: "Completed" }[status.phase] ?? status.phase)) : "");
  const processedFiles = $derived(status ? (status.phase === "copying" ? status.copiedFiles : status.publishedFiles) : 0);
  const agentOptions = $derived([{ value: "", label: zh ? "选择迁移到的 Agent" : "Choose destination Agent", disabled: true }, ...(status?.availableAgents ?? []).map(agent => ({ value: agent.id, label: agent.name }))]);
  function currentRequest(generation: number, target: string): boolean {
    return generation === requestGeneration && serviceAvailable && endpoint === target;
  }
  async function assignBot(channel: string, botId: string, agentId: string | null) {
    if (!serviceAvailable || !endpoint || busy || migrationRunning || !status) return;
    const target = endpoint;
    const generation = ++requestGeneration;
    busy = true;
    previewing = true;
    error = "";
    try {
      const assignments = status.botAssignments.filter(item => item.channel !== channel || item.botId !== botId);
      if (agentId !== "") assignments.push({ channel, botId, agentId });
      const next = await previewAgentStorageMigration(target, status.ignoredPaths, assignments);
      if (currentRequest(generation, target)) status = next;
    } catch (cause) { if (currentRequest(generation, target)) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (currentRequest(generation, target)) { busy = false; previewing = false; assignmentRevision += 1; } }
  }
  async function check(target: string) {
    const generation = ++requestGeneration;
    checked = target;
    busy = false;
    previewing = false;
    if (statusEndpoint !== target) { open = false; onPending(false); }
    onReady(false);
    try {
      const next = status && statusEndpoint === target && !status.running ? await previewAgentStorageMigration(target, status.ignoredPaths, status.botAssignments) : await loadAgentStorageMigration(target);
      if (!currentRequest(generation, target)) return;
      status = next;
      statusEndpoint = target;
      open = next.needed;
      error = next.error ?? "";
      onError("");
      onPending(next.needed);
      onReady(!next.needed);
    } catch (cause) {
      if (!currentRequest(generation, target)) return;
      error = cause instanceof Error ? cause.message : String(cause);
      open = false;
      onPending(false);
      onError(error);
      retryTimer = setTimeout(() => {
        if (currentRequest(generation, target)) void check(target);
      }, 1000);
    }
  }
  $effect(() => {
    if (!serviceAvailable || !endpoint) {
      checked = "";
      open = false;
      requestGeneration += 1;
      clearTimeout(retryTimer);
      busy = false;
      previewing = false;
      onReady(false);
      onPending(false);
      onError("");
      return;
    }
    if (endpoint !== checked) void check(endpoint);
  });
  $effect(() => {
    if (!serviceAvailable || !endpoint || (!migrationRunning && !(busy && !previewing))) return;
    const target = endpoint;
    const generation = requestGeneration;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await loadAgentStorageMigration(target);
        if (stopped || !currentRequest(generation, target)) return;
        status = next;
        error = next.error ?? "";
        if (!next.needed) {
          open = false;
          onPending(false);
          onReady(true);
        }
      } catch {}
      if (!stopped && currentRequest(generation, target)) timer = setTimeout(poll, 1000);
    }
    timer = setTimeout(poll, 1000);
    return () => { stopped = true; clearTimeout(timer); };
  });
  async function ignoreResource(path: string, restore = false) {
    if (!serviceAvailable || !endpoint || busy || migrationRunning || !status) return;
    const target = endpoint;
    const generation = ++requestGeneration;
    busy = true;
    previewing = true;
    error = "";
    try {
      const paths = restore ? status.ignoredPaths.filter(item => item !== path) : [...new Set([...status.ignoredPaths, path])];
      const next = await previewAgentStorageMigration(target, paths, status.botAssignments);
      if (currentRequest(generation, target)) status = next;
    } catch (cause) { if (currentRequest(generation, target)) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (currentRequest(generation, target)) { busy = false; previewing = false; } }
  }
  async function confirm() {
    if (!serviceAvailable || !endpoint || busy || migrationRunning || !status) return;
    const target = endpoint;
    const generation = ++requestGeneration;
    busy = true;
    error = "";
    try {
      const next = await confirmAgentStorageMigration(target, status.ignoredPaths, status.botAssignments);
      if (!currentRequest(generation, target)) return;
      status = next;
      open = status.needed;
      onPending(status.needed);
      onReady(!status.needed);
    } catch (cause) { if (currentRequest(generation, target)) error = cause instanceof Error ? cause.message : String(cause); }
    finally { if (currentRequest(generation, target)) busy = false; }
  }
</script>

<Dialog {open} busy={busy || migrationRunning} contentClass="storage-migration-dialog" labelledBy="storage-migration-title" describedBy="storage-migration-description" onOpenChange={(value) => { if (!busy && !migrationRunning) open = value; }}>
  <header class="storage-migration-head">
    <div class="storage-migration-heading">
      <h2 id="storage-migration-title">{zh ? "迁移 Agent 会话数据" : "Migrate Agent session data"}</h2>
      {#if status}<span class="storage-migration-phase">{phaseLabel}</span>{/if}
    </div>
    <p id="storage-migration-description">{zh ? "对话、技能、事件和产物按 Agent 集中存储。旧文件原样保留，不会删除。" : "Store conversations, skills, events and files by Agent. Original files are preserved."}</p>
    {#if status}
      <dl class="storage-migration-stats">
        <div><dt>{zh ? "可迁移会话" : "Sessions to migrate"}</dt><dd>{status.sessions}</dd></div>
        <div><dt>{zh ? "文件进度" : "File progress"}</dt><dd>{processedFiles}<span> / {status.files}</span></dd></div>
      </dl>
    {/if}
  </header>
  <div class="storage-migration-body">
    {#if status}
      {#if status.conflicts.length}
        <section aria-labelledby="storage-migration-conflicts">
          <div class="storage-migration-section-head">
            <h3 id="storage-migration-conflicts">{zh ? "需要处理" : "Needs attention"}</h3>
            <span>{status.conflictItems.length}</span>
          </div>
          <p class="storage-migration-help">{zh ? "资源冲突可忽略后继续；会话归属和运行引用需先解决。" : "Resource conflicts can be skipped. Resolve session ownership and execution references first."}</p>
          <ul class="storage-migration-list">
            {#each status.conflictItems as conflict (conflict.message)}
              <li class="storage-migration-issue">
                {#if conflict.reason === "missing-bot"}
                  <h4>{zh ? `旧 Bot「${conflict.botId}」已不在当前配置中` : `Old Bot “${conflict.botId}” is no longer configured`}</h4>
                  <p>{conflict.channel} · {zh ? (conflict.canSkip ? "历史会话未记录 Agent 归属。可选择迁移目标，或不迁移此 Bot 的旧数据。" : "历史会话未记录 Agent 归属，需要选择迁移目标。") : (conflict.canSkip ? "Historical sessions have no recorded Agent ownership. Choose a destination or skip this Bot’s old data." : "Historical sessions have no recorded Agent ownership. Choose a destination Agent.")}</p>
                {:else if conflict.reason === "missing-agent"}
                  <h4>{zh ? (conflict.agentId ? `Agent「${conflict.agentId}」已不在当前配置中` : "会话的 Agent 归属无法确定") : (conflict.agentId ? `Agent “${conflict.agentId}” is no longer configured` : "Session Agent ownership is unresolved")}</h4>
                  <p>{zh ? "需先明确这些历史会话应迁移到哪个 Agent。" : "Resolve the destination Agent for these historical sessions."}</p>
                {:else}
                  <h4>{conflict.message.startsWith("Target collision:") ? (zh ? "同名文件内容不同" : "Same filename, different contents") : conflict.message.startsWith("Symbolic link in migration path:") ? (zh ? "资源包含符号链接" : "Resource contains a symbolic link") : (zh ? "无法迁移此项" : "This item cannot be migrated")}</h4>
                  <p>{conflict.message.startsWith("Target collision:") ? (zh ? "多个来源指向同一目标文件，迁移不会覆盖其中任何一份。" : "Multiple sources share a destination. Migration will not overwrite either file.") : conflict.message.startsWith("Symbolic link in migration path:") ? (zh ? "迁移不跟随符号链接。可忽略此资源，原文件保留。" : "Migration does not follow symbolic links. Skip this resource to keep the original in place.") : conflict.message}</p>
                {/if}
                {#if conflict.reason === "missing-bot" && conflict.channel && conflict.botId}
                  <div class="storage-migration-assignment">
                    {#key assignmentRevision}<SelectControl value="" options={agentOptions} disabled={busy || migrationRunning} ariaLabel={zh ? `选择 ${conflict.channel}/${conflict.botId} 的迁移 Agent` : `Destination Agent for ${conflict.channel}/${conflict.botId}`} onChange={(agentId) => assignBot(conflict.channel!, conflict.botId!, agentId)} />{/key}
                    {#if conflict.canSkip}<Button disabled={busy || migrationRunning} onclick={() => assignBot(conflict.channel!, conflict.botId!, null)}>{zh ? "不迁移此 Bot 的旧数据" : "Skip this Bot’s old data"}</Button>{/if}
                  </div>
                {/if}
                {#if conflict.skipBlockedReason}<p>{zh ? "此项当前不能排除，具体原因见详情。" : "This item cannot currently be excluded. See details for the reason."}</p>{/if}
                {#if conflict.sessionIds?.length}<p>{zh ? "受影响会话" : "Affected sessions"}: {conflict.sessionIds.length}</p>{/if}
                {#if conflict.path}<p class="storage-migration-path">{conflict.path}</p>{/if}
                <div class="storage-migration-issue-actions">
                  <details class="storage-migration-details"><summary>{zh ? "查看详情" : "Details"}</summary>
                    <ul>{#if conflict.sessionIds?.length}<li>{zh ? "会话 ID" : "Session IDs"}: {conflict.sessionIds.join(", ")}</li>{/if}{#each conflict.details ?? [conflict.message] as detail}<li>{detail}</li>{/each}{#if conflict.skipBlockedReason}<li>{conflict.skipBlockedReason}</li>{/if}</ul>
                  </details>
                  {#if conflict.path && conflict.canSkip}<Button disabled={busy || migrationRunning} onclick={() => ignoreResource(conflict.path!)}>{zh ? "忽略此资源" : "Skip this resource"}</Button>{/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {:else}
        <section class="storage-migration-ready">
          <h3>{(busy && !previewing) || migrationRunning ? (zh ? "正在迁移" : "Migration in progress") : (zh ? "可以开始迁移" : "Ready to migrate")}</h3>
          <p>{zh ? "确认后将复制、校验并切换存储。完成前运行与自动任务保持暂停。" : "Confirm to copy, verify and switch storage. Runs and automated tasks stay paused until completion."}</p>
        </section>
      {/if}
      {#if status.botAssignments.length}
        <section aria-labelledby="storage-migration-assignments">
          <div class="storage-migration-section-head"><h3 id="storage-migration-assignments">{zh ? "旧 Bot 数据处理" : "Old Bot data choices"}</h3><span>{status.botAssignments.length}</span></div>
          <p class="storage-migration-help">{zh ? "选择后仍需点击底部按钮确认，才会保存并启用服务。原文件保留；不迁移的数据不会出现在新工作区。" : "Confirm using the button below to save choices and enable the service. Original files are kept; skipped data will not appear in the new workspace."}</p>
          <ul class="storage-migration-list">{#each status.botAssignments as assignment (`${assignment.channel}/${assignment.botId}`)}
            {@const fixed = status.fixedBotAssignments.some(item => item.channel === assignment.channel && item.botId === assignment.botId)}
            <li class="storage-migration-assigned-row">
              <p>{assignment.channel} / {assignment.botId}</p>
              <div class="storage-migration-assignment">
                {#if assignment.agentId === null}<p>{zh ? "不迁移：会话、资源与事件" : "Will not migrate: sessions, resources and events"}</p>{:else}
                {#key assignmentRevision}<SelectControl value={assignment.agentId} options={agentOptions} disabled={busy || migrationRunning || fixed} ariaLabel={zh ? `选择 ${assignment.channel}/${assignment.botId} 的迁移 Agent` : `Destination Agent for ${assignment.channel}/${assignment.botId}`} onChange={(agentId) => assignBot(assignment.channel, assignment.botId, agentId)} />{/key}{/if}
                {#if !fixed}<Button disabled={busy || migrationRunning} onclick={() => assignBot(assignment.channel, assignment.botId, "")}>{zh ? "撤销" : "Undo"}</Button>{/if}
              </div>
              {#if fixed}<p class="storage-migration-help">{zh ? "迁移已开始，选择已固定。失败后按此选择重试。" : "Migration has started; the choice is fixed. Retry with this selection after a failure."}</p>{/if}
            </li>
          {/each}</ul>
        </section>
      {/if}
      {#if status.ignoredPaths.length}
        <section aria-labelledby="storage-migration-skipped">
          <div class="storage-migration-section-head"><h3 id="storage-migration-skipped">{zh ? "已选择忽略" : "Selected to skip"}</h3><span>{status.ignoredPaths.length}</span></div>
          <p class="storage-migration-help">{zh ? "不迁入新工作区，原文件保留。选择在确认迁移时保存。" : "Unavailable in the new workspace; originals remain. Selections are saved when you confirm."}</p>
          <ul class="storage-migration-list">{#each status.ignoredPaths as path}<li class="storage-migration-skipped-row"><p class="storage-migration-path">{path}</p><Button disabled={busy || migrationRunning} onclick={() => ignoreResource(path, true)}>{zh ? "恢复" : "Include"}</Button></li>{/each}</ul>
        </section>
      {/if}
      {#if status.automaticSkippedPaths.length}
        <details class="storage-migration-details storage-migration-cache"><summary>{zh ? "自动跳过的临时依赖与缓存" : "Automatically skipped dependencies and caches"}<span>{status.automaticSkippedPaths.length}</span></summary><ul>{#each status.automaticSkippedPaths as path}<li>{path}</li>{/each}</ul></details>
      {/if}
    {/if}
    {#if error}<p class="storage-migration-error" role="alert">{error}</p>{/if}
  </div>
  <footer class="storage-migration-foot">
    {#if busy || migrationRunning}<p role="status">{previewing ? (zh ? "正在重新计算摘要…" : "Recalculating…") : (zh ? "正在复制、校验并切换存储…" : "Copying, verifying and switching storage…")}</p>{/if}
    <div class="storage-migration-actions">
      <div>
        {#if error || status?.conflicts.length}<Button disabled={busy || migrationRunning} onclick={() => endpoint && check(endpoint)}>{zh ? "重新检测" : "Check again"}</Button>{/if}
        <Button variant="primary" disabled={busy || migrationRunning || !status || status.conflicts.length > 0} onclick={confirm}>{error ? (zh ? "重试迁移" : "Retry migration") : ((status?.ignoredPaths.length || status?.botAssignments.some(item => item.agentId === null)) ? (zh ? "迁移其余数据" : "Migrate remaining data") : (zh ? "确认迁移" : "Confirm migration"))}</Button>
      </div>
    </div>
  </footer>
</Dialog>
