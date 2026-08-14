// Derived from the MIT-licensed Astryx `ai-chat` template generated with:
// npx @astryxdesign/cli template ai-chat ./src/app/ai-chat
import {StrictMode, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Theme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral/built';
import {VStack, HStack, StackItem} from '@astryxdesign/core/Layout';
import {Text, Heading} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Markdown} from '@astryxdesign/core/Markdown';
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
  PlusIcon,
  Bars3BottomLeftIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

type Conversation = {id: string; title: string; createdAt: string; updatedAt: string};
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
  subtitle: '轻量对话 · 不加载 Agent 提示词、记忆和工具',
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
} : {
  title: 'Mini Chat',
  subtitle: 'Lightweight chat · no Agent prompt, memory, or tools',
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

  const active = useMemo(() => conversations.find((item) => item.id === activeId) || null, [conversations, activeId]);
  const retryable = [...messages].reverse().find((message) => message.role === 'assistant')?.status !== 'completed';

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
    if (!activeId || busy || !window.confirm(copy.deleteConfirm)) return;
    try {
      await api(`/conversations/${activeId}`, {method: 'DELETE'});
      setMessages([]);
      setActiveId('');
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
                <Text type="supporting" color="secondary">{copy.subtitle}</Text>
              </VStack>
            </StackItem>
            {active && <Button label={copy.delete} variant="ghost" size="sm" isIconOnly icon={<Icon icon={TrashIcon} size="sm" />} isDisabled={busy} onClick={() => void removeConversation()} />}
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
                <ChatMessageBubble variant="ghost">
                  {message.status === 'pending' ? message.content
                    ? <div className="streaming-reply"><Markdown density="compact">{message.content}</Markdown></div>
                    : <span className="thinking"><i /><i /><i /><span>{copy.loading}</span></span>
                    : message.status === 'completed' ? <Markdown density="compact">{message.content}</Markdown>
                    : <ChatSystemMessage>{statusText(message)}</ChatSystemMessage>}
                </ChatMessageBubble>
                <ChatMessageMetadata
                  timestamp={formatTime(message.createdAt)}
                  footer={message.status === 'completed' ? <button className="message-action" type="button" onClick={() => void copyMessage(message)}><ClipboardDocumentIcon />{copiedId === message.id ? copy.copied : copy.copy}</button> : undefined}
                />
              </ChatMessage>
            ))}
            {!busy && retryable && messages.length > 0 && <div className="retry-row"><Button label={copy.retry} variant="secondary" size="sm" icon={<Icon icon={ArrowPathIcon} size="sm" />} onClick={() => void retry()} /></div>}
          </ChatMessageList>
        </ChatLayout>
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><Theme theme={neutralTheme} mode={themeMode}><MiniChat /></Theme></StrictMode>,
);
