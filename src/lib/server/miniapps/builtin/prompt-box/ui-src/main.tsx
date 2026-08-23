import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';
import { VStack, HStack, Layout, LayoutHeader, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { Button } from '@astryxdesign/core/Button';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Card } from '@astryxdesign/core/Card';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Selector } from '@astryxdesign/core/Selector';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import {
  MagnifyingGlassIcon,
  PlusIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  PencilSquareIcon,
  TrashIcon,
  PaperAirplaneIcon,
  EyeIcon,
  SparklesIcon,
  KeyIcon,
  CloudArrowDownIcon,
  XMarkIcon,
  PhotoIcon,
  CodeBracketIcon,
  LinkIcon,
  CommandLineIcon,
  VariableIcon,
  ArrowsUpDownIcon
} from '@heroicons/react/24/outline';

export interface PromptItem {
  id: string;
  remoteId?: string;
  title: string;
  content: string;
  description?: string;
  tags: string[];
  exampleImageUrl?: string;
  createdAt: string;
  updatedAt: string;
  syncedAt?: string;
}

export interface PromptBoxSettings {
  apiKey: string;
  apiKeyMasked: string;
  apiKeyPresent: boolean;
  apiUrl: string;
  lastSyncTime: string | null;
}

type SortOption = 'updated_desc' | 'created_desc' | 'title_asc' | 'title_desc' | 'length_desc';

const params = new URLSearchParams(window.location.search);
const zh = (params.get('locale') || navigator.language).toLowerCase().startsWith('zh');
const themeMode = params.get('theme') === 'dark' ? 'dark' : params.get('theme') === 'light' ? 'light' : 'system';

const copy = zh ? {
  title: 'PB',
  searchPlaceholder: '搜索提示词…',
  allTags: '全部',
  addPrompt: '新建提示词',
  editPrompt: '编辑提示词',
  deletePrompt: '删除提示词',
  sync: '同步',
  syncing: '同步中…',
  settings: '设置',
  settingsSubtitle: '配置 pb.onlinestool.com API Key 以启用云端双向同步',
  apiKey: 'API Key',
  apiKeyPlaceholder: '输入 API Key',
  apiKeyDescription: '从 pb.onlinestool.com 获取的 API Key',
  apiUrl: 'API 服务地址',
  apiUrlPlaceholder: 'https://pb.onlinestool.com/api',
  save: '保存 (⌘+Enter)',
  cancel: '取消',
  delete: '删除',
  deleteConfirm: '确定要删除这个提示词吗？此操作不可撤销。',
  promptTitle: '标题',
  promptTitlePlaceholder: '提示词标题…',
  promptDescription: '描述 / 备注（可选）',
  promptDescriptionPlaceholder: '简短说明…',
  promptExampleImage: '示例图片 URL（可选）',
  promptExampleImagePlaceholder: 'https://… (支持外链图片或在正文中插入 Markdown 图片)',
  promptTags: '标签',
  promptTagsPlaceholder: '输入标签后回车…',
  quickTags: '推荐标签',
  promptContent: '提示词正文',
  promptContentPlaceholder: '输入提示词正文，支持 Markdown 及变量占位符…',
  insertComposer: '填入输入框',
  inserted: '已填入',
  copyContent: '复制提示词',
  copied: '已复制',
  viewDetails: '查看详情',
  close: '关闭',
  emptyTitle: '暂无提示词',
  emptyDescription: '配置 API Key 同步云端数据，或点击右上角「+」开始新建。',
  noSearchResultsTitle: '无匹配提示词',
  noSearchResultsDescription: '请更换搜索词或清除选中的标签筛选。',
  clearFilters: '清除筛选',
  configAndSync: '配置并同步',
  lastSynced: '上次同步',
  neverSynced: '未同步',
  syncSuccessTwoWay: '同步完成：拉取 {pulled} 条，上传 {pushed} 条',
  syncSuccessLocal: '已刷新本地数据（配置 API Key 可开启云端同步）',
  syncFailed: '同步失败，请检查 API Key 和网络',
  saveSuccess: '已保存',
  deleteSuccess: '已删除',
  remoteSynced: '已同步',
  localOnly: '本地',
  loadFailed: '加载失败，请重试',
  testAndSync: '保存并同步',
  sortUpdatedDesc: '更新时间',
  sortCreatedDesc: '创建时间',
  sortTitleAsc: '标题 A-Z',
  sortTitleDesc: '标题 Z-A',
  sortLengthDesc: '内容长度',
  editTab: '编辑',
  previewTab: '实时预览',
  hasVariables: '变量',
  wordCount: '{chars} 字符 · {words} 词',
  snippetVar: '变量',
  snippetImg: '图片',
  snippetLink: '链接',
  snippetCode: '代码',
  snippetRole: '角色',
  previewImage: '图片预览'
} : {
  title: 'PB',
  searchPlaceholder: 'Search prompts…',
  allTags: 'All',
  addPrompt: 'New Prompt',
  editPrompt: 'Edit Prompt',
  deletePrompt: 'Delete Prompt',
  sync: 'Sync',
  syncing: 'Syncing…',
  settings: 'Settings',
  settingsSubtitle: 'Configure pb.onlinestool.com API Key for two-way sync',
  apiKey: 'API Key',
  apiKeyPlaceholder: 'Enter API Key',
  apiKeyDescription: 'API Key from pb.onlinestool.com',
  apiUrl: 'API Base URL',
  apiUrlPlaceholder: 'https://pb.onlinestool.com/api',
  save: 'Save (⌘+Enter)',
  cancel: 'Cancel',
  delete: 'Delete',
  deleteConfirm: 'Are you sure you want to delete this prompt?',
  promptTitle: 'Title',
  promptTitlePlaceholder: 'Prompt title…',
  promptDescription: 'Description (Optional)',
  promptDescriptionPlaceholder: 'Brief description…',
  promptExampleImage: 'Example Image URL (Optional)',
  promptExampleImagePlaceholder: 'https://…',
  promptTags: 'Tags',
  promptTagsPlaceholder: 'Type tag and press Enter…',
  quickTags: 'Quick Tags',
  promptContent: 'Content',
  promptContentPlaceholder: 'Enter prompt content, supports Markdown & variables…',
  insertComposer: 'Insert to Composer',
  inserted: 'Inserted',
  copyContent: 'Copy Content',
  copied: 'Copied',
  viewDetails: 'Details',
  close: 'Close',
  emptyTitle: 'No Prompts',
  emptyDescription: 'Configure API Key to sync or click "+" to add one.',
  noSearchResultsTitle: 'No Matching Prompts',
  noSearchResultsDescription: 'Try adjusting your search terms or tags.',
  clearFilters: 'Clear',
  configAndSync: 'Config & Sync',
  lastSynced: 'Last synced',
  neverSynced: 'Never',
  syncSuccessTwoWay: 'Synced: Pulled {pulled}, Pushed {pushed}',
  syncSuccessLocal: 'Local prompts refreshed (Set API Key to enable cloud sync)',
  syncFailed: 'Sync failed. Please check API Key and network.',
  saveSuccess: 'Saved successfully',
  deleteSuccess: 'Deleted',
  remoteSynced: 'Synced',
  localOnly: 'Local',
  loadFailed: 'Failed to load data',
  testAndSync: 'Save & Sync',
  sortUpdatedDesc: 'Updated',
  sortCreatedDesc: 'Created',
  sortTitleAsc: 'Title A-Z',
  sortTitleDesc: 'Title Z-A',
  sortLengthDesc: 'Length',
  editTab: 'Edit',
  previewTab: 'Live Preview',
  hasVariables: 'Variables',
  wordCount: '{chars} chars · {words} words',
  snippetVar: 'Variable',
  snippetImg: 'Image',
  snippetLink: 'Link',
  snippetCode: 'Code',
  snippetRole: 'Role',
  previewImage: 'Image Preview'
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error || 'Request failed'), { status: response.status });
  }
  return body as T;
}

function insertIntoComposer(text: string) {
  window.parent.postMessage(
    {
      protocol: 'molibot-miniapp',
      version: 1,
      action: 'composer.insert',
      payload: { text: String(text), mode: 'append' }
    },
    '*'
  );
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
      month: 'numeric',
      day: 'numeric'
    }).format(date);
  } catch {
    return '';
  }
}

function hasVariablePlaceholders(text: string): boolean {
  return /\{\{[^{}]+\}\}|\[[A-Z0-9_\u4e00-\u9fa5]+\]/i.test(text);
}

function countWords(str: string): number {
  const matches = str.match(/[\u4e00-\u9fa5]|\b\w+\b/g);
  return matches ? matches.length : 0;
}

/**
 * Normalizes URL and resolves first image from exampleImageUrl or markdown content
 */
function resolvePromptImage(item: PromptItem): string | null {
  if (item.exampleImageUrl && typeof item.exampleImageUrl === 'string' && item.exampleImageUrl.trim()) {
    const clean = item.exampleImageUrl.trim().replace(/^https?:/i, (m) => m.toLowerCase());
    if (/^https?:\/\//i.test(clean)) return clean;
  }
  const combined = `${item.description || ''}\n${item.content || ''}`;
  // 1. Markdown image ![alt](url)
  const mdMatch = combined.match(/!\[.*?\]\((https?:\/\/[^\s\)]+)\)/i);
  if (mdMatch) return mdMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
  // 2. HTML <img> tag
  const htmlMatch = combined.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  if (htmlMatch) return htmlMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
  // 3. tutu.onlinestool.com link with image extension
  const tutuMatch = combined.match(/(https?:\/\/tutu\.onlinestool\.com\/[^\s"'<>\)]+\.(?:png|jpg|jpeg|gif|webp|svg))/i);
  if (tutuMatch) return tutuMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
  // 4. Raw image URL in text
  const urlMatch = combined.match(/(https?:\/\/[^\s"'<>\)]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s"'<>\)]*)?)/i);
  if (urlMatch) return urlMatch[1].replace(/^https?:/i, (m) => m.toLowerCase());
  return null;
}

/**
 * Strips markdown image syntax and raw URLs to produce clean excerpt text for description fallback
 */
function getExcerptText(item: PromptItem): string {
  if (item.description && item.description.trim()) {
    return item.description.trim();
  }
  const clean = (item.content || '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1')
    .replace(/<img[^>]+>/gi, '')
    .replace(/(https?:\/\/[^\s\)]+\.(?:png|jpg|jpeg|gif|webp|svg)(?:\?[^\s\)]*)?)/gi, '')
    .replace(/[`#*_\->~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || '—';
}

function PromptBoxApp() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [settings, setSettings] = useState<PromptBoxSettings>({
    apiKey: '',
    apiKeyMasked: '',
    apiKeyPresent: false,
    apiUrl: 'https://pb.onlinestool.com/api',
    lastSyncTime: null
  });
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortOption>('updated_desc');

  // Dialog States
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Partial<PromptItem> | null>(null);
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>('edit');
  const [tagInputText, setTagInputText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [settingsFormKey, setSettingsFormKey] = useState('');
  const [settingsFormUrl, setSettingsFormUrl] = useState('');
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [activeDetailPrompt, setActiveDetailPrompt] = useState<PromptItem | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [promptToDelete, setPromptToDelete] = useState<PromptItem | null>(null);

  // Image Lightbox Preview
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);

  // Status feedback toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [insertedId, setInsertedId] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2500);
  };

  const loadData = async () => {
    try {
      const [promptsRes, settingsRes] = await Promise.all([
        api<{ prompts: PromptItem[] }>('/prompts'),
        api<{ settings: PromptBoxSettings }>('/settings')
      ]);
      setPrompts(promptsRes.prompts || []);
      setSettings(settingsRes.settings);
    } catch (e: any) {
      showToast(e.message || copy.loadFailed);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

    // Check deep link for specific prompt ID
    const urlPromptId = params.get('promptId');
    if (urlPromptId) {
      api<{ prompt: PromptItem }>(`/prompts/${urlPromptId}`)
        .then((res) => {
          if (res.prompt) {
            setActiveDetailPrompt(res.prompt);
            setDetailDialogOpen(true);
          }
        })
        .catch(() => {});
    }
  }, []);

  const handleSyncOrRefresh = async () => {
    setSyncing(true);
    try {
      if (settings.apiKeyPresent) {
        const res = await api<{
          success: boolean;
          pulledCount: number;
          pushedCount: number;
          syncedCount: number;
          lastSyncTime: string;
        }>('/sync', { method: 'POST' });
        showToast(
          copy.syncSuccessTwoWay
            .replace('{pulled}', String(res.pulledCount ?? 0))
            .replace('{pushed}', String(res.pushedCount ?? 0))
        );
      } else {
        showToast(copy.syncSuccessLocal);
      }
      await loadData();
    } catch (e: any) {
      showToast(e.message || copy.syncFailed);
    } finally {
      setSyncing(false);
    }
  };

  const handleSaveSettings = async (andSync = false) => {
    try {
      const res = await api<{ settings: PromptBoxSettings }>('/settings', {
        method: 'POST',
        body: JSON.stringify({ apiKey: settingsFormKey, apiUrl: settingsFormUrl })
      });
      setSettings(res.settings);
      setSettingsDialogOpen(false);
      showToast(copy.saveSuccess);

      if (andSync && settingsFormKey) {
        setSyncing(true);
        try {
          const syncRes = await api<{ success: boolean; pulledCount: number; pushedCount: number }>('/sync', {
            method: 'POST'
          });
          showToast(
            copy.syncSuccessTwoWay
              .replace('{pulled}', String(syncRes.pulledCount ?? 0))
              .replace('{pushed}', String(syncRes.pushedCount ?? 0))
          );
          await loadData();
        } catch (syncErr: any) {
          showToast(syncErr.message || copy.syncFailed);
        } finally {
          setSyncing(false);
        }
      }
    } catch (e: any) {
      showToast(e.message || 'Failed to save settings');
    }
  };

  const handleSavePrompt = async () => {
    if (!editingPrompt) return;
    if (!editingPrompt.title?.trim() && !editingPrompt.content?.trim()) {
      showToast(zh ? '请填写标题或内容' : 'Please provide title or content');
      return;
    }

    const payload = {
      title: editingPrompt.title?.trim() || '',
      content: editingPrompt.content?.trim() || '',
      description: editingPrompt.description?.trim() || '',
      tags: editingPrompt.tags || [],
      exampleImageUrl: editingPrompt.exampleImageUrl?.trim() || undefined
    };

    try {
      if (editingPrompt.id) {
        await api<{ prompt: PromptItem }>(`/prompts/${editingPrompt.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
      } else {
        await api<{ prompt: PromptItem }>('/prompts', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      setEditDialogOpen(false);
      setEditingPrompt(null);
      setTagInputText('');
      showToast(copy.saveSuccess);
      await loadData();
    } catch (e: any) {
      showToast(e.message || 'Failed to save prompt');
    }
  };

  const handleDeletePrompt = async () => {
    if (!promptToDelete) return;
    try {
      await api(`/prompts/${promptToDelete.id}`, { method: 'DELETE' });
      setDeleteDialogOpen(false);
      setPromptToDelete(null);
      if (activeDetailPrompt?.id === promptToDelete.id) {
        setDetailDialogOpen(false);
        setActiveDetailPrompt(null);
      }
      showToast(copy.deleteSuccess);
      await loadData();
    } catch (e: any) {
      showToast(e.message || 'Failed to delete prompt');
    }
  };

  const handleInsertComposer = (item: PromptItem) => {
    insertIntoComposer(item.content);
    setInsertedId(item.id);
    showToast(copy.inserted);
    setTimeout(() => {
      setInsertedId((prev) => (prev === item.id ? null : prev));
    }, 1500);
  };

  const handleCopyContent = async (item: PromptItem) => {
    try {
      await navigator.clipboard.writeText(item.content);
      setCopiedId(item.id);
      showToast(copy.copied);
      setTimeout(() => {
        setCopiedId((prev) => (prev === item.id ? null : prev));
      }, 1500);
    } catch {
      showToast('Copy failed');
    }
  };

  // Tag Helpers in Editor
  const handleAddTag = (rawTag: string) => {
    const clean = rawTag.trim().replace(/^#/, '');
    if (!clean) return;
    const current = editingPrompt?.tags || [];
    if (!current.includes(clean)) {
      setEditingPrompt((prev) => ({ ...prev, tags: [...current, clean] }));
    }
    setTagInputText('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const current = editingPrompt?.tags || [];
    setEditingPrompt((prev) => ({ ...prev, tags: current.filter((t) => t !== tagToRemove) }));
  };

  // Snippet Insertion Helper in Editor
  const handleInsertSnippet = (snippet: string) => {
    const current = editingPrompt?.content || '';
    const textarea = textareaRef.current || (document.querySelector('.prompt-box-editor-textarea textarea') as HTMLTextAreaElement);
    if (textarea) {
      const start = textarea.selectionStart || current.length;
      const end = textarea.selectionEnd || current.length;
      const next = current.slice(0, start) + snippet + current.slice(end);
      setEditingPrompt((prev) => ({ ...prev, content: next }));
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + snippet.length, start + snippet.length);
      }, 50);
    } else {
      setEditingPrompt((prev) => ({ ...prev, content: current ? `${current}\n${snippet}` : snippet }));
    }
  };

  // Keyboard shortcut listener for Dialogs (Cmd/Ctrl + Enter to save)
  const handleEditorKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSavePrompt();
    }
  };

  // All unique tags with occurrence counts
  const allTagsWithCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of prompts || []) {
      for (const t of p.tags || []) {
        const clean = t.trim();
        if (clean) {
          map.set(clean, (map.get(clean) || 0) + 1);
        }
      }
    }
    return Array.from(map.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }, [prompts]);

  const toggleTagFilter = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // Filtered & Locally Sorted Prompts
  const filteredAndSortedPrompts = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    // 1. Filter
    const filtered = (prompts || []).filter((p) => {
      const matchQuery =
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q)) ||
        (p.tags && p.tags.some((t) => t.toLowerCase().includes(q)));

      const matchTags =
        selectedTags.length === 0 ||
        (p.tags && selectedTags.every((st) => p.tags.includes(st)));

      return matchQuery && matchTags;
    });

    // 2. Sort
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'created_desc':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'title_asc':
          return (a.title || '').localeCompare(b.title || '', zh ? 'zh-CN' : 'en');
        case 'title_desc':
          return (b.title || '').localeCompare(a.title || '', zh ? 'zh-CN' : 'en');
        case 'length_desc':
          return (b.content || '').length - (a.content || '').length;
        case 'updated_desc':
        default:
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      }
    });
  }, [prompts, searchQuery, selectedTags, sortBy]);

  return (
    <div className="prompt-box-root">
      <Layout
        height="100%"
        header={
          <LayoutHeader>
            <div className="prompt-box-header">
              {/* Ultra-compact Left Morandi Logo & Count */}
              <div className="prompt-box-header-left">
                <div className="prompt-box-logo-badge">
                  <span>PB</span>
                </div>
                <span className="prompt-box-count-pill">{prompts.length}</span>
              </div>

              {/* Compact Icon-only Actions */}
              <div className="prompt-box-header-right">
                <button
                  type="button"
                  className="prompt-box-header-btn"
                  title={syncing ? copy.syncing : copy.sync}
                  disabled={syncing}
                  onClick={handleSyncOrRefresh}
                >
                  <ArrowPathIcon width={14} height={14} strokeWidth={1.8} className={syncing ? 'spin-animation' : ''} />
                </button>
                <button
                  type="button"
                  className="prompt-box-header-btn primary"
                  title={copy.addPrompt}
                  onClick={() => {
                    setEditingPrompt({ title: '', content: '', description: '', tags: [] });
                    setEditorMode('edit');
                    setTagInputText('');
                    setEditDialogOpen(true);
                  }}
                >
                  <PlusIcon width={14} height={14} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  className="prompt-box-header-btn"
                  title={copy.settings}
                  onClick={() => {
                    setSettingsFormKey(settings.apiKey || '');
                    setSettingsFormUrl(settings.apiUrl || 'https://pb.onlinestool.com/api');
                    setSettingsDialogOpen(true);
                  }}
                >
                  <Cog6ToothIcon width={14} height={14} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </LayoutHeader>
        }
        content={
          <LayoutContent>
            <div className="prompt-box-body">
              {/* Search & Sort & Filter Bar */}
              <div className="prompt-box-filter-bar">
                <div className="prompt-box-search-row">
                  <div className="prompt-box-search-input">
                    <TextInput
                      label=""
                      placeholder={copy.searchPlaceholder}
                      value={searchQuery}
                      onChange={(val) => setSearchQuery(val)}
                      isClearable
                      icon={<MagnifyingGlassIcon width={15} height={15} />}
                    />
                  </div>

                  {/* Local Sort Selector */}
                  <div className="prompt-box-sort-selector">
                    <Selector
                      label=""
                      width="100%"
                      value={sortBy}
                      options={[
                        { value: 'updated_desc', label: copy.sortUpdatedDesc },
                        { value: 'created_desc', label: copy.sortCreatedDesc },
                        { value: 'title_asc', label: copy.sortTitleAsc },
                        { value: 'title_desc', label: copy.sortTitleDesc },
                        { value: 'length_desc', label: copy.sortLengthDesc }
                      ]}
                      onChange={(val) => setSortBy(val as SortOption)}
                      icon={<ArrowsUpDownIcon width={14} height={14} />}
                    />
                  </div>
                </div>

                {/* Multi-Tag Filter Chips */}
                {allTagsWithCounts.length > 0 && (
                  <div className="prompt-box-tags-scroll">
                    <span
                      className={`prompt-box-tag-chip ${selectedTags.length === 0 ? 'active' : ''}`}
                      onClick={() => setSelectedTags([])}
                    >
                      {copy.allTags}
                    </span>
                    {allTagsWithCounts.map(({ tag, count }) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <span
                          key={tag}
                          className={`prompt-box-tag-chip ${isSelected ? 'active' : ''}`}
                          onClick={() => toggleTagFilter(tag)}
                        >
                          #{tag}
                          <span className="prompt-box-tag-chip-count">{count}</span>
                        </span>
                      );
                    })}

                    {(selectedTags.length > 0 || searchQuery) && (
                      <button
                        type="button"
                        className="prompt-box-clear-filters-btn"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedTags([]);
                        }}
                      >
                        <XMarkIcon width={12} height={12} />
                        <span>{copy.clearFilters}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Prompts Cards Grid */}
              {loading ? (
                <div className="prompt-box-loading">
                  <ArrowPathIcon width={24} height={24} className="spin-animation" />
                </div>
              ) : prompts.length === 0 ? (
                <div className="prompt-box-empty-wrap">
                  <EmptyState
                    title={copy.emptyTitle}
                    description={copy.emptyDescription}
                    icon={<SparklesIcon width={32} height={32} />}
                    actions={
                      <HStack gap={2} hAlign="center">
                        <Button
                          label={copy.configAndSync}
                          variant="primary"
                          size="sm"
                          icon={<CloudArrowDownIcon width={14} height={14} />}
                          onClick={() => {
                            setSettingsFormKey(settings.apiKey || '');
                            setSettingsFormUrl(settings.apiUrl || 'https://pb.onlinestool.com/api');
                            setSettingsDialogOpen(true);
                          }}
                        />
                        <Button
                          label={copy.addPrompt}
                          variant="secondary"
                          size="sm"
                          icon={<PlusIcon width={14} height={14} />}
                          onClick={() => {
                            setEditingPrompt({ title: '', content: '', description: '', tags: [] });
                            setEditorMode('edit');
                            setTagInputText('');
                            setEditDialogOpen(true);
                          }}
                        />
                      </HStack>
                    }
                  />
                </div>
              ) : filteredAndSortedPrompts.length === 0 ? (
                <div className="prompt-box-empty-wrap">
                  <EmptyState
                    title={copy.noSearchResultsTitle}
                    description={copy.noSearchResultsDescription}
                    icon={<MagnifyingGlassIcon width={32} height={32} />}
                    actions={
                      <Button
                        label={copy.clearFilters}
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearchQuery('');
                          setSelectedTags([]);
                        }}
                      />
                    }
                  />
                </div>
              ) : (
                <div className="prompt-box-cards-grid">
                  {filteredAndSortedPrompts.map((item) => {
                    const hasVars = hasVariablePlaceholders(item.content);
                    const imageUrl = resolvePromptImage(item);
                    const excerpt = getExcerptText(item);
                    const firstTag = item.tags && item.tags.length > 0 ? item.tags[0] : null;

                    return (
                      <Card key={item.id} variant="default" className="prompt-box-card">
                        <div className="prompt-box-card-layout">
                          {/* Left Column: Title, Description, Actions */}
                          <div
                            className="prompt-box-card-left"
                            onClick={() => {
                              setActiveDetailPrompt(item);
                              setDetailDialogOpen(true);
                            }}
                          >
                            <div className="prompt-box-card-title-row">
                              <span className="prompt-box-card-title" title={item.title}>
                                {item.title || 'Untitled Prompt'}
                              </span>
                              {hasVars && (
                                <span className="prompt-box-mini-badge" title={copy.hasVariables}>
                                  {copy.hasVariables}
                                </span>
                              )}
                              {item.remoteId && (
                                <span className="prompt-box-sync-dot" title={copy.remoteSynced} />
                              )}
                            </div>

                            {/* Clean 2-Line Description / Excerpt */}
                            <p className="prompt-box-card-desc">{excerpt}</p>

                            {/* Bottom bar with icon-only actions & metadata */}
                            <div className="prompt-box-card-bottom-bar" onClick={(e) => e.stopPropagation()}>
                              <div className="prompt-box-card-icon-actions">
                                <button
                                  type="button"
                                  className={`prompt-box-icon-action-btn ${insertedId === item.id ? 'active' : ''}`}
                                  title={insertedId === item.id ? copy.inserted : copy.insertComposer}
                                  onClick={() => handleInsertComposer(item)}
                                >
                                  {insertedId === item.id ? (
                                    <CheckIcon width={13} height={13} strokeWidth={2.2} />
                                  ) : (
                                    <PaperAirplaneIcon width={13} height={13} strokeWidth={1.8} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className={`prompt-box-icon-action-btn ${copiedId === item.id ? 'active' : ''}`}
                                  title={copiedId === item.id ? copy.copied : copy.copyContent}
                                  onClick={() => handleCopyContent(item)}
                                >
                                  {copiedId === item.id ? (
                                    <CheckIcon width={13} height={13} strokeWidth={2.2} />
                                  ) : (
                                    <ClipboardDocumentIcon width={13} height={13} strokeWidth={1.8} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="prompt-box-icon-action-btn"
                                  title={copy.editPrompt}
                                  onClick={() => {
                                    setEditingPrompt({ ...item });
                                    setEditorMode('edit');
                                    setTagInputText('');
                                    setEditDialogOpen(true);
                                  }}
                                >
                                  <PencilSquareIcon width={13} height={13} strokeWidth={1.8} />
                                </button>
                                <button
                                  type="button"
                                  className="prompt-box-icon-action-btn danger"
                                  title={copy.deletePrompt}
                                  onClick={() => {
                                    setPromptToDelete(item);
                                    setDeleteDialogOpen(true);
                                  }}
                                >
                                  <TrashIcon width={13} height={13} strokeWidth={1.8} />
                                </button>
                              </div>

                              <div className="prompt-box-card-meta">
                                {firstTag && (
                                  <span className="prompt-box-card-tag-preview" title={item.tags.join(', ')}>
                                    #{firstTag}
                                  </span>
                                )}
                                <span className="prompt-box-card-time">{formatRelativeTime(item.updatedAt)}</span>
                              </div>
                            </div>
                          </div>

                          {/* Right Column: Image Thumbnail (if exists) */}
                          {imageUrl && (
                            <div
                              className="prompt-box-card-image-wrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewImageUrl(imageUrl);
                              }}
                              title={copy.previewImage}
                            >
                              <img
                                src={imageUrl}
                                alt={item.title}
                                className="prompt-box-card-img"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                              />
                              <div className="prompt-box-img-hover-overlay">
                                <EyeIcon width={16} height={16} strokeWidth={1.8} />
                              </div>
                            </div>
                          )}
                        </div>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </LayoutContent>
        }
      />

      {/* Floating Action Toast Notification */}
      {toastMessage && (
        <div className="prompt-box-toast" role="status">
          <SparklesIcon width={14} height={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Image Lightbox Preview Dialog */}
      {previewImageUrl && (
        <Dialog
          isOpen={Boolean(previewImageUrl)}
          onOpenChange={(open) => !open && setPreviewImageUrl(null)}
          width="min(680px, calc(100vw - 24px))"
          maxHeight="min(800px, calc(100vh - 24px))"
        >
          <Layout
            height="auto"
            header={
              <DialogHeader
                title={copy.previewImage}
                onOpenChange={(open) => !open && setPreviewImageUrl(null)}
              />
            }
            content={
              <LayoutContent>
                <div className="prompt-box-lightbox-wrap">
                  <img
                    src={previewImageUrl}
                    alt="Preview"
                    className="prompt-box-lightbox-img"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </LayoutContent>
            }
            footer={
              <LayoutFooter hasDivider>
                <HStack gap={2} hAlign="end">
                  <Button
                    label={copy.close}
                    variant="secondary"
                    size="sm"
                    onClick={() => setPreviewImageUrl(null)}
                  />
                </HStack>
              </LayoutFooter>
            }
          />
        </Dialog>
      )}

      {/* Create / Edit Prompt Dialog */}
      <Dialog
        isOpen={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        width="min(620px, calc(100vw - 24px))"
        height="min(780px, calc(100vh - 36px))"
        purpose="form"
      >
        <Layout
          height="fill"
          header={
            <DialogHeader
              title={editingPrompt?.id ? copy.editPrompt : copy.addPrompt}
              onOpenChange={setEditDialogOpen}
            />
          }
          content={
            <LayoutContent>
              <div className="prompt-box-editor-wrap" onKeyDown={handleEditorKeyDown}>
                <VStack gap={3}>
                  {/* Title & Description */}
                  <TextInput
                    label={copy.promptTitle}
                    placeholder={copy.promptTitlePlaceholder}
                    value={editingPrompt?.title || ''}
                    onChange={(val) => setEditingPrompt((prev) => ({ ...prev, title: val }))}
                  />
                  <TextInput
                    label={copy.promptDescription}
                    placeholder={copy.promptDescriptionPlaceholder}
                    value={editingPrompt?.description || ''}
                    onChange={(val) => setEditingPrompt((prev) => ({ ...prev, description: val }))}
                  />
                  <TextInput
                    label={copy.promptExampleImage}
                    placeholder={copy.promptExampleImagePlaceholder}
                    value={editingPrompt?.exampleImageUrl || ''}
                    onChange={(val) => setEditingPrompt((prev) => ({ ...prev, exampleImageUrl: val }))}
                    icon={<PhotoIcon width={15} height={15} />}
                  />

                  {/* Interactive Tag Manager */}
                  <div className="prompt-box-tag-editor-section">
                    <label className="prompt-box-field-label">{copy.promptTags}</label>
                    <div className="prompt-box-tag-chips-container">
                      {(editingPrompt?.tags || []).map((tag) => (
                        <span key={tag} className="prompt-box-tag-editable-chip">
                          #{tag}
                          <button
                            type="button"
                            className="prompt-box-chip-del"
                            onClick={() => handleRemoveTag(tag)}
                          >
                            <XMarkIcon width={10} height={10} />
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        className="prompt-box-tag-inline-input"
                        placeholder={copy.promptTagsPlaceholder}
                        value={tagInputText}
                        onChange={(e) => setTagInputText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ',' || e.key === '，' || e.key === ' ') {
                            e.preventDefault();
                            handleAddTag(tagInputText);
                          } else if (e.key === 'Backspace' && !tagInputText && (editingPrompt?.tags || []).length > 0) {
                            const lastTag = editingPrompt!.tags![editingPrompt!.tags!.length - 1];
                            handleRemoveTag(lastTag);
                          }
                        }}
                        onBlur={() => handleAddTag(tagInputText)}
                      />
                    </div>

                    {/* Quick Tag Recommendations */}
                    {allTagsWithCounts.length > 0 && (
                      <div className="prompt-box-quick-tags-wrap">
                        <span className="prompt-box-quick-tags-title">{copy.quickTags}:</span>
                        <div className="prompt-box-quick-tags-list">
                          {allTagsWithCounts.map(({ tag }) => {
                            const alreadyAdded = (editingPrompt?.tags || []).includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                className={`prompt-box-quick-tag-btn ${alreadyAdded ? 'added' : ''}`}
                                onClick={() => (alreadyAdded ? handleRemoveTag(tag) : handleAddTag(tag))}
                              >
                                {alreadyAdded ? '✓ ' : '+ '}#{tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Content Area with Markdown & Snippet Toolbar */}
                  <div className="prompt-box-content-editor-section">
                    <div className="prompt-box-content-editor-header">
                      <label className="prompt-box-field-label">{copy.promptContent}</label>
                      <SegmentedControl
                        value={editorMode}
                        onChange={(next) => setEditorMode(next as 'edit' | 'preview')}
                        label="Editor mode"
                      >
                        <SegmentedControlItem value="edit" label={copy.editTab} />
                        <SegmentedControlItem value="preview" label={copy.previewTab} />
                      </SegmentedControl>
                    </div>

                    {editorMode === 'edit' ? (
                      <div className="prompt-box-textarea-container">
                        {/* Quick Snippet Insertion Bar */}
                        <div className="prompt-box-snippet-toolbar">
                          <button
                            type="button"
                            className="prompt-box-snippet-btn"
                            title="Insert Variable placeholder"
                            onClick={() => handleInsertSnippet('{{variable}}')}
                          >
                            <VariableIcon width={12} height={12} />
                            <span>{copy.snippetVar}</span>
                          </button>
                          <button
                            type="button"
                            className="prompt-box-snippet-btn"
                            title="Insert Image Markdown"
                            onClick={() => handleInsertSnippet('![Image](https://example.com/image.png)')}
                          >
                            <PhotoIcon width={12} height={12} />
                            <span>{copy.snippetImg}</span>
                          </button>
                          <button
                            type="button"
                            className="prompt-box-snippet-btn"
                            title="Insert Link Markdown"
                            onClick={() => handleInsertSnippet('[Link](https://example.com)')}
                          >
                            <LinkIcon width={12} height={12} />
                            <span>{copy.snippetLink}</span>
                          </button>
                          <button
                            type="button"
                            className="prompt-box-snippet-btn"
                            title="Insert Code Block"
                            onClick={() => handleInsertSnippet('```python\n# Code\n```')}
                          >
                            <CodeBracketIcon width={12} height={12} />
                            <span>{copy.snippetCode}</span>
                          </button>
                          <button
                            type="button"
                            className="prompt-box-snippet-btn"
                            title="Insert Role Preset"
                            onClick={() => handleInsertSnippet('You are a professional assistant. Your task is to:\n1. ')}
                          >
                            <CommandLineIcon width={12} height={12} />
                            <span>{copy.snippetRole}</span>
                          </button>
                        </div>

                        <div className="prompt-box-editor-textarea">
                          <TextArea
                            label=""
                            placeholder={copy.promptContentPlaceholder}
                            rows={8}
                            value={editingPrompt?.content || ''}
                            onChange={(val) => setEditingPrompt((prev) => ({ ...prev, content: val }))}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="prompt-box-preview-container">
                        {editingPrompt?.content ? (
                          <Markdown>{editingPrompt.content}</Markdown>
                        ) : (
                          <span className="prompt-box-preview-placeholder">
                            {copy.promptContentPlaceholder}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Word and Character Count Footer */}
                    <div className="prompt-box-content-count-bar">
                      <span>
                        {copy.wordCount
                          .replace('{chars}', String((editingPrompt?.content || '').length))
                          .replace('{words}', String(countWords(editingPrompt?.content || '')))}
                      </span>
                      <span>⌘ + Enter</span>
                    </div>
                  </div>
                </VStack>
              </div>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button
                  label={copy.cancel}
                  variant="secondary"
                  size="sm"
                  onClick={() => setEditDialogOpen(false)}
                />
                <Button
                  label={copy.save}
                  variant="primary"
                  size="sm"
                  onClick={handleSavePrompt}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      {/* Prompt Detail Dialog */}
      <Dialog
        isOpen={detailDialogOpen}
        onOpenChange={setDetailDialogOpen}
        width="min(600px, calc(100vw - 24px))"
        height="min(720px, calc(100vh - 36px))"
      >
        <Layout
          height="fill"
          header={
            <DialogHeader
              title={activeDetailPrompt?.title || 'Prompt Detail'}
              subtitle={activeDetailPrompt?.description}
              onOpenChange={setDetailDialogOpen}
            />
          }
          content={
            <LayoutContent>
              {activeDetailPrompt && (
                <VStack gap={3}>
                  <HStack gap={2} vAlign="center" className="prompt-box-detail-meta-row">
                    {activeDetailPrompt.tags && activeDetailPrompt.tags.length > 0 && (
                      <HStack gap={1} vAlign="center" className="prompt-box-detail-tags">
                        {activeDetailPrompt.tags.map((tag) => (
                          <span key={tag} className="prompt-box-card-tag-pill">
                            #{tag}
                          </span>
                        ))}
                      </HStack>
                    )}
                    {hasVariablePlaceholders(activeDetailPrompt.content) && (
                      <span className="prompt-box-mini-badge">
                        <VariableIcon width={10} height={10} />
                        <span>{copy.hasVariables}</span>
                      </span>
                    )}
                  </HStack>

                  {/* Detail Image Preview if available */}
                  {resolvePromptImage(activeDetailPrompt) && (
                    <div
                      className="prompt-box-detail-image-wrap"
                      onClick={() => setPreviewImageUrl(resolvePromptImage(activeDetailPrompt)!)}
                    >
                      <img
                        src={resolvePromptImage(activeDetailPrompt)!}
                        alt={activeDetailPrompt.title}
                        className="prompt-box-detail-img"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}

                  <div className="prompt-box-detail-markdown">
                    <Markdown>{activeDetailPrompt.content}</Markdown>
                  </div>
                </VStack>
              )}
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="between">
                <Button
                  label={copy.editPrompt}
                  variant="secondary"
                  size="sm"
                  icon={<PencilSquareIcon width={14} height={14} />}
                  onClick={() => {
                    if (activeDetailPrompt) {
                      setEditingPrompt({ ...activeDetailPrompt });
                      setEditorMode('edit');
                      setTagInputText('');
                      setDetailDialogOpen(false);
                      setEditDialogOpen(true);
                    }
                  }}
                />
                <HStack gap={2}>
                  {activeDetailPrompt && (
                    <>
                      <Button
                        label={copy.copyContent}
                        variant="secondary"
                        size="sm"
                        icon={<ClipboardDocumentIcon width={14} height={14} />}
                        onClick={() => handleCopyContent(activeDetailPrompt)}
                      />
                      <Button
                        label={copy.insertComposer}
                        variant="primary"
                        size="sm"
                        icon={<PaperAirplaneIcon width={14} height={14} />}
                        onClick={() => {
                          handleInsertComposer(activeDetailPrompt);
                        }}
                      />
                    </>
                  )}
                </HStack>
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      {/* Settings Dialog */}
      <Dialog
        isOpen={settingsDialogOpen}
        onOpenChange={setSettingsDialogOpen}
        width="min(440px, calc(100vw - 24px))"
        purpose="form"
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title={copy.settings}
              subtitle={copy.settingsSubtitle}
              onOpenChange={setSettingsDialogOpen}
            />
          }
          content={
            <LayoutContent>
              <VStack gap={3}>
                <TextInput
                  label={copy.apiKey}
                  placeholder={copy.apiKeyPlaceholder}
                  description={
                    settings.apiKeyPresent
                      ? `${copy.apiKeyDescription} (${settings.apiKeyMasked})`
                      : copy.apiKeyDescription
                  }
                  value={settingsFormKey}
                  onChange={(val) => setSettingsFormKey(val)}
                  type="password"
                  icon={<KeyIcon width={15} height={15} />}
                />
                <TextInput
                  label={copy.apiUrl}
                  placeholder={copy.apiUrlPlaceholder}
                  value={settingsFormUrl}
                  onChange={(val) => setSettingsFormUrl(val)}
                />
              </VStack>
            </LayoutContent>
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button
                  label={copy.cancel}
                  variant="secondary"
                  size="sm"
                  onClick={() => setSettingsDialogOpen(false)}
                />
                <Button
                  label={copy.testAndSync}
                  variant="secondary"
                  size="sm"
                  icon={<ArrowPathIcon width={14} height={14} />}
                  onClick={() => handleSaveSettings(true)}
                />
                <Button
                  label={copy.save}
                  variant="primary"
                  size="sm"
                  onClick={() => handleSaveSettings(false)}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        width="min(360px, calc(100vw - 24px))"
        purpose="form"
      >
        <Layout
          height="auto"
          header={
            <DialogHeader
              title={copy.deletePrompt}
              subtitle={copy.deleteConfirm}
              onOpenChange={setDeleteDialogOpen}
            />
          }
          footer={
            <LayoutFooter hasDivider>
              <HStack gap={2} hAlign="end">
                <Button
                  label={copy.cancel}
                  variant="secondary"
                  size="sm"
                  onClick={() => setDeleteDialogOpen(false)}
                />
                <Button
                  label={copy.delete}
                  variant="primary"
                  size="sm"
                  onClick={handleDeletePrompt}
                />
              </HStack>
            </LayoutFooter>
          }
        />
      </Dialog>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme theme={neutralTheme} mode={themeMode}>
      <PromptBoxApp />
    </Theme>
  </StrictMode>
);
