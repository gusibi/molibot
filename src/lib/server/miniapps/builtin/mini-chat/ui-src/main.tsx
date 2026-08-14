// Derived from the MIT-licensed Astryx `ai-chat` template generated with:
// npx @astryxdesign/cli template ai-chat ./src/app/ai-chat
import {StrictMode, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {VStack, HStack, StackItem, Layout, LayoutContent, LayoutFooter} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Markdown} from '@astryxdesign/core/Markdown';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Selector} from '@astryxdesign/core/Selector';
import {TextArea} from '@astryxdesign/core/TextArea';
import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
} from '@astryxdesign/core/Chat';
import {
  ArrowPathIcon,
  ChatBubbleLeftRightIcon,
  ClipboardDocumentIcon,
  Cog6ToothIcon,
  PlusIcon,
  Bars3BottomLeftIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type Conversation = {id: string; title: string; createdAt: string; updatedAt: string};
type ModelOption = {key: string; label: string};
type ModelState = {currentKey: string; options: ModelOption[]};
type MiniChatSettings = {modelKey: string; systemPrompt: string};
type SettingsPayload = {settings: MiniChatSettings; models: ModelState};
type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'pending' | 'completed' | 'cancelled' | 'failed' | 'interrupted';
  usage: {inputTokens: number; outputTokens: number; totalTokens: number};
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

const params = new URLSearchParams(window.location.search);
const zh = (params.get('locale') || navigator.language).toLowerCase().startsWith('zh');
const themeMode = params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : 'system';

const copy = zh ? {
  title: 'Mini Chat',
  subtitle: '轻量对话 · low',
  newChat: '新对话',
  emptyTitle: '随手问点什么',
  emptyBody: '直接调用你配置的小程序文本模型。这里的对话独立保存，不进入 Agent Session。',
  placeholder: '输入一个简短问题…',
  delete: '删除对话',
  stop: '停止生成',
  retry: '重新尝试',
  copy: '复制回复',
  copied: '已复制',
  interrupted: '回复已中断，可以重新尝试。',
  failed: '模型暂时没有完成回复，可以重新尝试。',
  cancelled: '已停止生成。',
  loading: '正在思考…',
  noModel: '请先在「设置 → 模型 → 小程序 AI」中配置可用的文本模型。',
  requestFailed: 'Mini Chat 暂时无法完成这次请求。',
  deleteConfirm: '删除这个对话及其全部消息？',
  conversations: '对话',
  menu: '显示对话列表',
  closeMenu: '关闭对话列表',
  settings: '设置',
  settingsSubtitle: '只影响 Mini Chat，不加载 Agent 默认提示词、记忆和工具。',
  model: '模型',
  defaultModel: '跟随小程序默认模型',
  systemPrompt: '系统提示词',
  systemPromptDescription: '可选，适合一两句简短要求。',
  systemPromptPlaceholder: '例如：回答简洁，优先使用中文。',
  invalidModel: '所选模型已不可用，请重新选择。',
  invalidSystemPrompt: '系统提示词必须是不超过 2000 字符的文本。',
  cancel: '取消',
  save: '保存',
} : {
  title: 'Mini Chat',
  subtitle: 'Lightweight chat · low',
  newChat: 'New chat',
  emptyTitle: 'Ask something small',
  emptyBody: 'Calls your configured Mini App text model directly. These conversations stay separate from Agent sessions.',
  placeholder: 'Ask a short question…',
  delete: 'Delete conversation',
  stop: 'Stop generating',
  retry: 'Try again',
  copy: 'Copy reply',
  copied: 'Copied',
  interrupted: 'The reply was interrupted. You can try again.',
  failed: 'The model did not finish this reply. You can try again.',
  cancelled: 'Generation stopped.',
  loading: 'Thinking…',
  noModel: 'Configure a text model in Settings → Models → Mini App AI first.',
  requestFailed: 'Mini Chat could not complete this request.',
  deleteConfirm: 'Delete this conversation and all of its messages?',
  conversations: 'Conversations',
  menu: 'Show conversations',
  closeMenu: 'Close conversations',
  settings: 'Settings',
  settingsSubtitle: 'Only affects Mini Chat. Agent defaults, memory, and tools stay unloaded.',
  model: 'Model',
  defaultModel: 'Use Mini App default',
  systemPrompt: 'System prompt',
  systemPromptDescription: 'Optional. Best for one or two short instructions.',
  systemPromptPlaceholder: 'For example: Be concise and answer in English.',
  invalidModel: 'That model is no longer available. Choose another model.',
  invalidSystemPrompt: 'The system prompt must be text no longer than 2,000 characters.',
  cancel: 'Cancel',
  save: 'Save',
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`api${path}`, {
    ...init,
    headers: {'Content-Type': 'application/json', ...(init?.headers || {})},
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body.error || copy.requestFailed), {code: body.code, status: response.status});
  return body as T;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {hour: '2-digit', minute: '2-digit'}).format(date);
}

function statusText(message: Message): string {
  if (message.status === 'cancelled') return copy.cancelled;
  if (message.status === 'interrupted') return copy.interrupted;
  return copy.failed;
}

function MiniChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [settings, setSettings] = useState<MiniChatSettings>({modelKey: '', systemPrompt: ''});
  const [draftSettings, setDraftSettings] = useState<MiniChatSettings>({modelKey: '', systemPrompt: ''});
  const [models, setModels] = useState<ModelState>({currentKey: '', options: []});
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  const active = useMemo(() => conversations.find((item) => item.id === activeId) || null, [conversations, activeId]);
  const retryable = [...messages].reverse().find((message) => message.role === 'assistant')?.status !== 'completed';
  const activeModelKey = settings.modelKey || models.currentKey;
  const activeModelLabel = models.options.find((option) => option.key === activeModelKey)?.label || copy.defaultModel;
  const defaultModelName = models.options.find((option) => option.key === models.currentKey)?.label;

  async function loadSettings() {
    const result = await api<SettingsPayload>('/settings');
    setSettings(result.settings);
    setDraftSettings(result.settings);
    setModels(result.models);
  }

  async function refreshConversations(preferredId?: string) {
    const result = await api<{conversations: Conversation[]}>('/conversations');
    if (!Array.isArray(result.conversations)) throw new Error(copy.requestFailed);
    setConversations(result.conversations);
    const requestedId = preferredId === undefined ? activeId : preferredId;
    const nextId = result.conversations.some((item) => item.id === requestedId)
      ? requestedId
      : result.conversations[0]?.id || '';
    setActiveId(nextId);
    return nextId;
  }

  async function loadMessages(id: string) {
    if (!id) {
      setMessages([]);
      return;
    }
    const result = await api<{conversation: Conversation; messages: Message[]}>(`/conversations/${id}/messages`);
    if (!Array.isArray(result.messages)) throw new Error(copy.requestFailed);
    setMessages(result.messages);
  }

  useEffect(() => {
    void (async () => {
      try {
        await loadSettings();
        const id = await refreshConversations();
        await loadMessages(id);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : copy.requestFailed);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!busy || !activeId) return;
    let stopped = false;
    let timer = 0;
    const poll = async () => {
      try {
        const result = await api<{messages: Message[]}>(`/conversations/${activeId}/messages`);
        if (!stopped && Array.isArray(result.messages)) setMessages(result.messages);
      } catch {
        // The pending POST owns the user-facing error; polling only paints deltas.
      }
      if (!stopped) timer = window.setTimeout(poll, 80);
    };
    timer = window.setTimeout(poll, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [busy, activeId]);

  async function selectConversation(id: string) {
    if (busy || id === activeId) return;
    setError('');
    setActiveId(id);
    setSidebarOpen(false);
    await loadMessages(id).catch((cause) => setError(cause.message));
  }

  async function createConversation(): Promise<string> {
    const result = await api<{conversation: Conversation}>('/conversations', {method: 'POST', body: '{}'});
    setConversations((current) => [result.conversation, ...current]);
    setActiveId(result.conversation.id);
    setMessages([]);
    setSidebarOpen(false);
    return result.conversation.id;
  }

  async function submit(content: string) {
    if (busy) return;
    setError('');
    let id = activeId;
    try {
      if (!id) id = await createConversation();
      const now = new Date().toISOString();
      setMessages((current) => [...current,
        {id: `local-user-${now}`, conversationId: id, role: 'user', content, status: 'completed', usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0}, errorCode: null, createdAt: now, updatedAt: now},
        {id: `local-assistant-${now}`, conversationId: id, role: 'assistant', content: '', status: 'pending', usage: {inputTokens: 0, outputTokens: 0, totalTokens: 0}, errorCode: null, createdAt: now, updatedAt: now},
      ]);
      setBusy(true);
      await api(`/conversations/${id}/messages`, {method: 'POST', body: JSON.stringify({content})});
    } catch (cause: any) {
      setError(cause?.code === 'capability_unavailable' ? copy.noModel : cause?.message || copy.requestFailed);
    } finally {
      setBusy(false);
      await loadMessages(id).catch(() => undefined);
      await refreshConversations(id).catch(() => undefined);
    }
  }

  async function stop() {
    if (!activeId || !busy) return;
    try {
      await api(`/conversations/${activeId}/cancel`, {method: 'POST', body: '{}'});
      setBusy(false);
      await loadMessages(activeId);
    } catch (cause: any) {
      setError(cause?.message || copy.requestFailed);
    }
  }

  async function retry() {
    if (!activeId || busy) return;
    setBusy(true);
    setError('');
    try {
      await api(`/conversations/${activeId}/retry`, {method: 'POST', body: '{}'});
    } catch (cause: any) {
      setError(cause?.code === 'capability_unavailable' ? copy.noModel : cause?.message || copy.requestFailed);
    } finally {
      setBusy(false);
      await loadMessages(activeId).catch(() => undefined);
      await refreshConversations(activeId).catch(() => undefined);
    }
  }

  async function removeConversation() {
    if (!activeId || busy) return;
    try {
      await api(`/conversations/${activeId}`, {method: 'DELETE'});
      setMessages([]);
      setActiveId('');
      setDeleteOpen(false);
      const next = await refreshConversations('');
      await loadMessages(next);
    } catch (cause: any) {
      setError(cause?.message || copy.requestFailed);
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(''), 1400);
  }

  function openSettings() {
    setDraftSettings(settings);
    setSettingsError('');
    setSettingsOpen(true);
    void loadSettings().catch((cause) => setSettingsError(cause instanceof Error ? cause.message : copy.requestFailed));
  }

  async function saveSettings() {
    setSavingSettings(true);
    setSettingsError('');
    try {
      const result = await api<SettingsPayload>('/settings', {
        method: 'PATCH',
        body: JSON.stringify(draftSettings),
      });
      setSettings(result.settings);
      setDraftSettings(result.settings);
      setModels(result.models);
      setSettingsOpen(false);
    } catch (cause: any) {
      setSettingsError(cause?.code === 'invalid_model'
        ? copy.invalidModel
        : cause?.code === 'invalid_system_prompt'
          ? copy.invalidSystemPrompt
          : cause?.message || copy.requestFailed);
    } finally {
      setSavingSettings(false);
    }
  }

  return (
    <div className="mini-chat-shell">
      <aside className={`session-rail ${sidebarOpen ? 'session-rail-open' : ''}`} aria-label={copy.conversations}>
        <div className="rail-head">
          <HStack gap={2} vAlign="center">
            <div className="brand-mark" aria-hidden="true"><ChatBubbleLeftRightIcon /></div>
            <StackItem size="fill"><Heading level={2}>{copy.title}</Heading></StackItem>
            <span className="mobile-close"><Button label={copy.closeMenu} variant="ghost" size="sm" isIconOnly icon={<Icon icon={XMarkIcon} size="sm" />} onClick={() => setSidebarOpen(false)} /></span>
          </HStack>
          <Button label={copy.newChat} variant="primary" size="md" isDisabled={busy} icon={<Icon icon={PlusIcon} size="sm" />} onClick={() => void createConversation()} />
        </div>
        <nav className="session-list">
          {conversations.map((conversation) => (
            <button
              type="button"
              className={`session-item ${conversation.id === activeId ? 'session-item-active' : ''}`}
              aria-current={conversation.id === activeId ? 'page' : undefined}
              onClick={() => void selectConversation(conversation.id)}
              key={conversation.id}>
              <span>{conversation.title}</span>
              <small>{new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {month: 'short', day: 'numeric'}).format(new Date(conversation.updatedAt))}</small>
            </button>
          ))}
        </nav>
      </aside>
      {sidebarOpen && <button className="rail-backdrop" type="button" aria-label={copy.closeMenu} onClick={() => setSidebarOpen(false)} />}

      <main className="chat-column">
        <header className="chat-head">
          <HStack gap={3} vAlign="center">
            <span className="mobile-menu"><Button label={copy.menu} variant="ghost" size="sm" isIconOnly icon={<Icon icon={Bars3BottomLeftIcon} size="sm" />} onClick={() => setSidebarOpen(true)} /></span>
            <StackItem size="fill">
              <VStack gap={0}>
                <Text type="label" weight="semibold">{active?.title || copy.newChat}</Text>
                <span className="model-summary"><Text type="supporting" color="secondary">{activeModelLabel} · {copy.subtitle}</Text></span>
              </VStack>
            </StackItem>
            <Button label={copy.settings} variant="ghost" size="sm" isIconOnly icon={<Icon icon={Cog6ToothIcon} size="sm" />} isDisabled={busy} onClick={openSettings} />
            {active && <Button label={copy.delete} variant="ghost" size="sm" isIconOnly icon={<Icon icon={TrashIcon} size="sm" />} isDisabled={busy} onClick={() => setDeleteOpen(true)} />}
          </HStack>
        </header>

        <ChatLayout
          density="spacious"
          composer={<ChatComposer
            onSubmit={(value) => void submit(value)}
            onStop={() => void stop()}
            isStopShown={busy}
            isDisabled={loading}
            placeholder={copy.placeholder}
            input={<ChatComposerInput />}
            status={error ? {type: 'error', message: error} : undefined}
          />}>
          <ChatMessageList
            density="spacious"
            isStreaming={busy}>
            {messages.length === 0 && <div className="empty-state">
              <div className="empty-orbit" aria-hidden="true"><ChatBubbleLeftRightIcon /></div>
              <Heading level={2}>{copy.emptyTitle}</Heading>
              <Text type="body" color="secondary">{copy.emptyBody}</Text>
            </div>}
            {messages.map((message) => message.role === 'user' ? (
              <ChatMessage sender="user" key={message.id}>
                <ChatMessageBubble metadata={<ChatMessageMetadata timestamp={formatTime(message.createdAt)} status="delivered" />}>
                  <span className="user-copy">{message.content}</span>
                </ChatMessageBubble>
              </ChatMessage>
            ) : (
              <ChatMessage sender="assistant" key={message.id}>
                <ChatMessageBubble variant="ghost" metadata={<ChatMessageMetadata
                  timestamp={formatTime(message.createdAt)}
                  footer={message.status === 'completed' ? <button className="message-action" type="button" onClick={() => void copyMessage(message)}><ClipboardDocumentIcon />{copiedId === message.id ? copy.copied : copy.copy}</button> : undefined}
                />}>
                  {message.status === 'pending' ? message.content
                    ? <div className="streaming-reply"><Markdown density="compact">{message.content}</Markdown></div>
                    : <span className="thinking"><i /><i /><i /><span>{copy.loading}</span></span>
                    : message.status === 'completed' ? <Markdown density="compact">{message.content}</Markdown>
                    : <ChatSystemMessage>{statusText(message)}</ChatSystemMessage>}
                </ChatMessageBubble>
              </ChatMessage>
            ))}
            {!busy && retryable && messages.length > 0 && <div className="retry-row"><Button label={copy.retry} variant="secondary" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} onClick={() => void retry()} /></div>}
          </ChatMessageList>
        </ChatLayout>
      </main>

      <Dialog isOpen={deleteOpen} onOpenChange={setDeleteOpen} width="min(380px, calc(100vw - 24px))" purpose="form">
        <Layout
          height="auto"
          header={<DialogHeader title={copy.delete} subtitle={copy.deleteConfirm} onOpenChange={setDeleteOpen} />}
          footer={<LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <Button label={copy.cancel} variant="secondary" size="md" isDisabled={busy} onClick={() => setDeleteOpen(false)} />
              <Button label={copy.delete} variant="primary" size="md" isDisabled={busy} onClick={() => void removeConversation()} />
            </HStack>
          </LayoutFooter>}
        />
      </Dialog>

      <Dialog isOpen={settingsOpen} onOpenChange={setSettingsOpen} width="min(420px, calc(100vw - 24px))" maxHeight="min(560px, calc(100vh - 24px))" purpose="form">
        <Layout
          height="auto"
          header={<DialogHeader title={copy.settings} subtitle={copy.settingsSubtitle} onOpenChange={setSettingsOpen} />}
          content={<LayoutContent>
            <VStack gap={5}>
              <Selector
                label={copy.model}
                width="100%"
                hasSearch={models.options.length > 8}
                options={[
                  {value: '', label: defaultModelName ? `${copy.defaultModel} · ${defaultModelName}` : copy.defaultModel},
                  ...models.options.map((option) => ({value: option.key, label: option.label})),
                ]}
                value={draftSettings.modelKey}
                onChange={(modelKey) => setDraftSettings((current) => ({...current, modelKey}))}
              />
              <TextArea
                label={copy.systemPrompt}
                description={copy.systemPromptDescription}
                placeholder={copy.systemPromptPlaceholder}
                value={draftSettings.systemPrompt}
                onChange={(systemPrompt) => setDraftSettings((current) => ({...current, systemPrompt}))}
                rows={4}
                maxLength={2000}
                width="100%"
              />
              {settingsError && <div className="settings-error" role="alert"><Text type="supporting" color="inherit">{settingsError}</Text></div>}
            </VStack>
          </LayoutContent>}
          footer={<LayoutFooter hasDivider>
            <HStack gap={2} hAlign="end">
              <Button label={copy.cancel} variant="secondary" size="md" isDisabled={savingSettings} onClick={() => setSettingsOpen(false)} />
              <Button label={copy.save} variant="primary" size="md" isLoading={savingSettings} onClick={() => void saveSettings()} />
            </HStack>
          </LayoutFooter>}
        />
      </Dialog>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Theme theme={neutralTheme} mode={themeMode}><MiniChat /></Theme></StrictMode>,
);
