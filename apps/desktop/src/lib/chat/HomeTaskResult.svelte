<script lang="ts">
  import { formatMemoryReflectionSummary } from "@molibot/shared/memoryReflection";
  import { loadDesktopHomeTaskResult } from '../api';
  import { collectTurnFiles, type TurnFileItem } from './turnFiles';
  import ChatMarkdown from './ChatMarkdown.svelte';
  import Button from '../components/ui/Button.svelte';
  import type { DesktopTaskSession } from '@molibot/desktop-contract';
  import type { Translation } from '../i18n';

  let {
    endpoint,
    taskId,
    executionId,
    locale,
    stale,
    copy,
    onRead = () => {},
    onClose,
    onFiles,
    onResultFile,
    onContinueChat
  }: {
    endpoint: string;
    taskId: string;
    executionId: string;
    locale: string;
    stale: boolean;
    copy?: Translation;
    onRead?: (executionId: string) => void;
    onClose: () => void;
    onFiles: () => void;
    onResultFile: (sessionId: string, file: TurnFileItem) => void;
    onContinueChat?: (sessionId: string) => void;
  } = $props();

  let detail = $state<DesktopTaskSession | null>(null);
  let loading = $state(false);
  let error = $state(false);
  let revision = $state(0);
  const zh = $derived(locale === 'zh-CN');

  $effect(() => {
    const target = endpoint, task = taskId, execution = executionId;
    revision;
    if (stale) { loading = false; return; }
    let disposed = false;
    loading = true; error = false; detail = null;
    void loadDesktopHomeTaskResult(target, task, execution).then(result => {
      if (disposed) return;
      detail = result;
      onRead(execution);
    }).catch(() => { if (!disposed) error = true; }).finally(() => { if (!disposed) loading = false; });
    return () => { disposed = true; };
  });

  const assistantMessages = $derived(
    detail?.messages.filter((message) => message.role === 'assistant' && message.content.trim()) ?? []
  );
  const resultFiles = $derived(
    detail?.messages.flatMap((message) => collectTurnFiles(message)) ?? []
  );
</script>

<div class="agent-home-work-detail" data-testid="home-task-result" aria-live="polite">
  {#if stale}<p class="agent-home-meta" role="status">{zh ? '当前离线，显示最近读取的结果。' : 'Offline. Showing the last loaded result.'}</p>{/if}
  {#if loading}<p class="agent-home-meta">{zh ? '正在读取结果…' : 'Loading result…'}</p>
  {:else if error}<p class="agent-home-handover-stale" role="alert">{zh ? '暂时无法读取这次执行的结果。' : 'Could not load this result.'}<Button variant="text" disabled={stale} onclick={() => revision++}>{zh ? '重试' : 'Retry'}</Button></p>
  {:else if detail}
    {#if detail.execution?.result?.kind === 'memory-reflection'}
      {@const result = detail.execution.result}
      <p class="agent-home-work-text">{formatMemoryReflectionSummary(result, zh)}</p>
    {:else if detail.execution?.result?.kind === 'daily-materials'}
      <p class="agent-home-meta">{zh ? '本次生成的素材' : 'Materials generated'}</p>
      {#each detail.execution.result.createdFiles as file}<p class="agent-home-work-text">{file}</p>{/each}
      <Button variant="text" onclick={onFiles}>{zh ? '打开文件与附件' : 'Open files and attachments'}</Button>
    {:else}
      {#if resultFiles.length}
        <div class="agent-home-result-files">
          {#each resultFiles as file, index (`${file.key}:${index}`)}
            <Button variant="text" disabled={stale} onclick={() => onResultFile(detail!.sessionId, file)}>{zh ? '打开文件' : 'Open file'} · {file.name}</Button>
          {/each}
        </div>
      {/if}
      {#if assistantMessages.length}
        {#each assistantMessages as message, index (index)}
          {#if copy}
            <ChatMarkdown
              source={message.content}
              {copy}
              {endpoint}
              className="agent-home-result-markdown markdown-body"
              contentKey={`home-result-${executionId}-${index}`}
            />
          {:else}
            <p class="agent-home-work-text">{message.content}</p>
          {/if}
        {/each}
      {:else}
        <p class="agent-home-meta">{zh ? '这次执行没有可展示的正文。' : 'No result text is available for this run.'}</p>
      {/if}
    {/if}
  {/if}
  <div class="agent-home-work-detail-foot">
    {#if detail?.sessionId && onContinueChat}
      <Button variant="primary" disabled={stale} onclick={() => onContinueChat(detail!.sessionId)}>{zh ? '接着聊' : 'Continue chat'}</Button>
    {/if}
    <Button variant="text" onclick={onClose}>{zh ? '收起' : 'Collapse'}</Button>
  </div>
</div>
