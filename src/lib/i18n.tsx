import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

export const LANGUAGES: { id: Lang; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'zh', label: '中文' },
];

type Dict = Record<string, string>;

const en: Dict = {
  newChat: 'New chat',
  noConversations: 'No conversations yet',
  settings: 'Settings',
  delete: 'Delete',
  conversations: 'Chats',
  searchPlaceholder: 'Search chats',
  noMatches: 'No matching chats',
  groupToday: 'Today',
  groupYesterday: 'Yesterday',
  groupWeek: 'Previous 7 days',
  groupOlder: 'Older',
  groupPinned: 'Pinned',
  rename: 'Rename',
  pin: 'Pin',
  unpin: 'Unpin',
  duplicate: 'Duplicate',
  exportChat: 'Export',
  cmdClear: 'Clear conversation',
  cmdClearDesc: 'Remove all messages in this chat',
  cmdCompact: 'Compact context',
  cmdCompactDesc: 'Summarize older messages now',
  cmdInit: 'Generate AGENTS.md',
  cmdInitDesc: 'Have the agent write project instructions',
  cmdModel: 'Switch model',
  cmdModelDesc: 'Toggle DeepSeek V3 / R1',
  cmdCwd: 'Set working directory',
  cmdCwdDesc: 'Choose the folder tools operate in',
  cmdPlan: 'Plan mode',
  cmdPlanDesc: 'Investigate and plan; make no changes',
  cmdLoop: 'Loop mode',
  cmdLoopDesc: 'Work autonomously until done',
  cmdDiff: 'Show git diff',
  cmdDiffDesc: 'Show uncommitted changes in the working dir',
  executeIn: 'Execute',
  planTitle: 'Plan',
  initPrompt:
    'Explore this project (read key files) and create an AGENTS.md at the working-directory root summarizing what it is, its structure, conventions, and how to build/run it. Use write_file to save it.',

  welcomeGreeting: 'How can I help you today?',
  welcomeSubtitle: 'Chat, reason, and act on your files — powered by DeepSeek.',
  apiKeyBanner: 'Add your DeepSeek API key to start — click to open Settings.',
  suggestion1: 'List the files in my working directory',
  suggestion2: 'Write a Python script that prints the first 20 primes',
  suggestion3: 'Explain async / await with a clear example',
  suggestion4: 'Summarize the README in my working directory',

  composerPlaceholder: 'Message DeepSeek…',
  composerPlaceholderNoKey: 'Add your API key in Settings to start chatting…',
  composerHint: 'Enter to send · Shift+Enter for a new line',
  disclaimer: 'DeepSeek can make mistakes. Consider checking important information.',
  attachFile: 'Insert a file path',
  insertCode: 'Insert a code block',
  webSearch: 'Web search',
  voiceInput: 'Voice input',
  voiceUnsupported: 'Voice input is not available in this environment',
  send: 'Send',
  stop: 'Stop',
  approvalAsk: 'Ask for approval',
  approvalAuto: 'Approve for me',
  approvalFull: 'Full access',
  approvalCustom: 'Custom access',
  approvalAskDesc: 'Always ask before editing files or using the internet',
  approvalAutoDesc: 'Only ask before running shell commands',
  approvalFullDesc: 'Unrestricted file and internet access',
  approvalCustomDesc: 'Per-tool permissions set in Settings',
  approvalHeading: 'How should tools be approved?',
  modeChat: 'Chat',
  modePlan: 'Plan',
  modeLoop: 'Loop',
  modeChatDesc: 'Normal — answer and use tools as needed',
  modePlanDesc: 'Investigate and propose a plan; make no changes',
  modeLoopDesc: 'Work autonomously across steps until done',
  modeHeading: 'Agent mode',
  planReady: 'Plan ready',
  executePlan: 'Execute plan',
  executePlanPrompt: 'Go ahead and implement the plan above.',

  allowActionTitle: 'Allow {action}?',
  allow: 'Allow',
  deny: 'Deny',
  approvalNote: 'The assistant wants to act on your machine.',

  thinking: 'Thinking…',
  thoughtProcess: 'Thought process',

  tool_read_file: 'Read file',
  tool_list_dir: 'List directory',
  tool_find_files: 'Find files',
  tool_search_files: 'Search in files',
  tool_web_search: 'Web search',
  tool_read_url: 'Read web page',
  tool_update_plan: 'Update plan',
  tool_edit_file: 'Edit file',
  tool_write_file: 'Write file',
  tool_run_command: 'Run command',
  statusRunning: 'running',
  statusDone: 'done',
  statusFailed: 'failed',

  model_chat_blurb: 'Fast chat & tools',
  model_reasoner_blurb: 'Deep reasoning',
  toolsBadge: 'Tools',
  reasoningBadge: 'Reasoning',

  settingsTitle: 'Settings',
  secModel: 'Model',
  secApi: 'API',
  secPermissions: 'Tool permissions',
  secBehavior: 'Behavior',
  secAppearance: 'Appearance',
  permAllow: 'Allow',
  permAsk: 'Ask',
  permOff: 'Off',
  permsHint: 'Allow = run automatically · Ask = confirm each time · Off = not offered to the model.',
  searchEndpointLabel: 'Search endpoint (SearXNG)',
  searchEndpointHint: 'Optional. Leave empty to use keyless DuckDuckGo. Point this at a SearXNG JSON URL (e.g. browser-search) for better results.',
  apiKeyLabel: 'DeepSeek API Key',
  apiKeyHint: 'Get a key at platform.deepseek.com. Stored locally on this machine only.',
  show: 'Show',
  hide: 'Hide',
  baseUrlLabel: 'API Base URL',
  workingDirLabel: 'Working Directory',
  workingDirHint: 'Relative file paths and commands run inside this folder.',
  browse: 'Browse…',
  temperatureLabel: 'Temperature',
  temperatureHint: 'Lower is focused, higher is creative (DeepSeek V3 only).',
  autoApproveLabel: 'Auto-approve tools',
  autoApproveDesc: 'Skip confirmation for writing files and running commands.',
  autoApproveWarn: 'When on, the assistant can modify files and run commands without asking.',
  systemPromptLabel: 'System Prompt',
  resetDefault: 'Reset to default',
  notifyLabel: 'Notify when done',
  notifyDesc: 'Show a desktop notification when a reply finishes and the window is in the background',
  languageLabel: 'Language',
  themeLabel: 'Theme',
  themeSystem: 'System',
  themeLight: 'Light',
  themeDark: 'Dark',
  about: 'DeepSeek Desktop · built on the QiangQiang WebView2 shell.',

  copy: 'Copy',
  copied: 'Copied',
  compacted: 'Earlier messages compacted to save context',
};

const zh: Dict = {
  newChat: '新对话',
  noConversations: '暂无对话',
  settings: '设置',
  delete: '删除',
  conversations: '对话',
  searchPlaceholder: '搜索对话',
  noMatches: '没有匹配的对话',
  groupToday: '今天',
  groupYesterday: '昨天',
  groupWeek: '前 7 天',
  groupOlder: '更早',
  groupPinned: '置顶',
  rename: '重命名',
  pin: '置顶',
  unpin: '取消置顶',
  duplicate: '复制',
  exportChat: '导出',
  cmdClear: '清空对话',
  cmdClearDesc: '删除当前对话的所有消息',
  cmdCompact: '压缩上下文',
  cmdCompactDesc: '立即总结较早的消息',
  cmdInit: '生成 AGENTS.md',
  cmdInitDesc: '让助手写入项目须知',
  cmdModel: '切换模型',
  cmdModelDesc: '在 DeepSeek V3 / R1 间切换',
  cmdCwd: '设置工作目录',
  cmdCwdDesc: '选择工具操作的文件夹',
  cmdPlan: '计划模式',
  cmdPlanDesc: '只调研出计划,不做改动',
  cmdLoop: '循环模式',
  cmdLoopDesc: '自主执行直到完成',
  cmdDiff: '查看 git diff',
  cmdDiffDesc: '显示工作目录未提交的改动',
  executeIn: '执行',
  planTitle: '计划',
  initPrompt:
    '请浏览这个项目(读取关键文件),在工作目录根下创建 AGENTS.md,概括它是什么、目录结构、约定、以及如何构建/运行。用 write_file 保存。',

  welcomeGreeting: '今天有什么可以帮你？',
  welcomeSubtitle: '对话、推理，并直接操作你的文件 —— 由 DeepSeek 驱动。',
  apiKeyBanner: '请先填入 DeepSeek API Key —— 点击打开设置。',
  suggestion1: '列出我工作目录里的文件',
  suggestion2: '写一个打印前 20 个质数的 Python 脚本',
  suggestion3: '用一个清晰的例子解释 async / await',
  suggestion4: '总结一下我工作目录里的 README',

  composerPlaceholder: '给 DeepSeek 发消息…',
  composerPlaceholderNoKey: '先在设置里填入 API Key 才能开始对话…',
  composerHint: 'Enter 发送 · Shift+Enter 换行',
  disclaimer: 'DeepSeek 可能会出错,请核查重要信息。',
  attachFile: '插入文件路径',
  insertCode: '插入代码块',
  webSearch: '联网搜索',
  voiceInput: '语音输入',
  voiceUnsupported: '此环境不支持语音输入',
  send: '发送',
  stop: '停止',
  approvalAsk: '每次询问',
  approvalAuto: '半自动批准',
  approvalFull: '完全访问',
  approvalCustom: '自定义',
  approvalAskDesc: '编辑文件或联网前总是先询问',
  approvalAutoDesc: '仅在执行命令前询问',
  approvalFullDesc: '不受限的文件与联网访问',
  approvalCustomDesc: '按工具在设置里单独配置',
  approvalHeading: '工具如何获得批准?',
  modeChat: '对话',
  modePlan: '计划',
  modeLoop: '循环',
  modeChatDesc: '常规:回答并按需使用工具',
  modePlanDesc: '只调研并给出计划,不做任何改动',
  modeLoopDesc: '自主连续执行,直到完成',
  modeHeading: '智能体模式',
  planReady: '计划已就绪',
  executePlan: '执行此计划',
  executePlanPrompt: '请按上面的计划开始执行。',

  allowActionTitle: '允许{action}吗？',
  allow: '允许',
  deny: '拒绝',
  approvalNote: '助手想要在你的电脑上执行操作。',

  thinking: '思考中…',
  thoughtProcess: '思考过程',

  tool_read_file: '读取文件',
  tool_list_dir: '列出目录',
  tool_find_files: '查找文件',
  tool_search_files: '搜索文件内容',
  tool_web_search: '联网搜索',
  tool_read_url: '读取网页',
  tool_update_plan: '更新计划',
  tool_edit_file: '修改文件',
  tool_write_file: '写入文件',
  tool_run_command: '执行命令',
  statusRunning: '执行中',
  statusDone: '完成',
  statusFailed: '失败',

  model_chat_blurb: '快速对话与工具',
  model_reasoner_blurb: '深度推理',
  toolsBadge: '工具',
  reasoningBadge: '推理',

  settingsTitle: '设置',
  secModel: '模型',
  secApi: 'API',
  secPermissions: '工具权限',
  secBehavior: '行为',
  secAppearance: '外观',
  permAllow: '允许',
  permAsk: '询问',
  permOff: '禁用',
  permsHint: '允许=自动执行 · 询问=每次确认 · 禁用=不提供给模型。',
  searchEndpointLabel: '搜索服务地址 (SearXNG)',
  searchEndpointHint: '可选。留空则用免 key 的 DuckDuckGo。填入 SearXNG 的 JSON 地址(如 browser-search)可获得更好结果。',
  apiKeyLabel: 'DeepSeek API Key',
  apiKeyHint: '在 platform.deepseek.com 获取。仅保存在本机。',
  show: '显示',
  hide: '隐藏',
  baseUrlLabel: 'API 地址',
  workingDirLabel: '工作目录',
  workingDirHint: '相对路径和命令都会在这个目录下执行。',
  browse: '浏览…',
  temperatureLabel: '温度',
  temperatureHint: '越低越聚焦，越高越发散（仅 DeepSeek V3）。',
  autoApproveLabel: '自动批准工具',
  autoApproveDesc: '写文件、执行命令时跳过确认。',
  autoApproveWarn: '开启后，助手可不经询问直接修改文件、执行命令。',
  systemPromptLabel: '系统提示词',
  resetDefault: '恢复默认',
  notifyLabel: '完成时通知',
  notifyDesc: '回复结束且窗口在后台时,弹出系统通知',
  languageLabel: '语言',
  themeLabel: '主题',
  themeSystem: '跟随系统',
  themeLight: '浅色',
  themeDark: '深色',
  about: 'DeepSeek Desktop · 基于强强 WebView2 框架构建。',

  copy: '复制',
  copied: '已复制',
  compacted: '已压缩较早的消息以节省上下文',
};

const DICTS: Record<Lang, Dict> = { en, zh };

export type TFn = (key: string, vars?: Record<string, string>) => string;

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nContext = createContext<I18nValue>({
  lang: 'en',
  setLang: () => {},
  t: (k) => k,
});

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  children: ReactNode;
}) {
  const t = useCallback<TFn>(
    (key, vars) => {
      let s = DICTS[lang]?.[key] ?? en[key] ?? key;
      if (vars) for (const k in vars) s = s.replace(`{${k}}`, vars[k]);
      return s;
    },
    [lang],
  );
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function detectLang(locale: string | null | undefined): Lang {
  return locale && locale.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
