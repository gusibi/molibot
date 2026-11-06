<script lang="ts">
  import { formatMemoryReflectionSummary } from "@molibot/shared/memoryReflection";
  import { loadDesktopHomeTaskResult } from '../api';
  import { collectTurnFiles, type TurnFileItem } from './turnFiles';
  import Button from '../components/ui/Button.svelte';
  import type { DesktopTaskSession } from '@molibot/desktop-contract';
  let { endpoint, taskId, executionId, locale, stale, onRead = () => {}, onClose, onFiles, onResultFile }: {
    endpoint: string; taskId: string; executionId: string; locale: string; stale: boolean;
    onRead?: (executionId: string) => void; onClose: () => void; onFiles: () => void;
    onResultFile: (sessionId: string, file: TurnFileItem) => void;
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
</script>
<div class="agent-home-work-detail" data-testid="home-task-result" aria-live="polite">
  {#if stale}<p role="status">{zh ? '连接中断，显示最近读取的结果。' : 'Disconnected. Showing the last result.'}</p>{/if}
  {#if loading}<p>{zh ? '读取这次执行…' : 'Loading this execution…'}</p>
  {:else if error}<p role="alert">{zh ? '无法读取这次执行的成果。记录可能已删除或无权访问。' : 'Could not read this execution. It may have been deleted or access is unavailable.'}<Button variant="text" disabled={stale} onclick={() => revision++}>{zh ? '重试' : 'Retry'}</Button></p>
  {:else if detail}
    {#if detail.execution?.result?.kind === 'memory-reflection'}
      {@const result = detail.execution.result}
      <p>{formatMemoryReflectionSummary(result, zh)}</p>
    {:else if detail.execution?.result?.kind === 'daily-materials'}
      <p>{zh ? '本次生成的素材' : 'Materials from this execution'}</p>
      {#each detail.execution.result.createdFiles as file}<p class="agent-home-work-text">{file}</p>{/each}
      <Button variant="text" onclick={onFiles}>{zh ? '打开文件与附件' : 'Open files and attachments'}</Button>
    {:else}
      {#each detail.messages.flatMap(message => collectTurnFiles(message)) as file, index (`${file.key}:${index}`)}<Button variant="text" disabled={stale} onclick={() => onResultFile(detail!.sessionId, file)}>{zh ? '打开成果' : 'Open result'} · {file.name}</Button>{/each}
      {#each detail.messages.filter(message => message.role === 'assistant' && message.content.trim()) as message}<p class="agent-home-work-text">{message.content}</p>{/each}
      {#if !detail.messages.some(message => message.role === 'assistant' && message.content.trim())}<p>{zh ? '这次执行没有可展示的正文。' : 'No result text is available for this execution.'}</p>{/if}
    {/if}
  {/if}
  <Button variant="text" onclick={onClose}>{zh ? '收起' : 'Collapse'}</Button>
</div>
