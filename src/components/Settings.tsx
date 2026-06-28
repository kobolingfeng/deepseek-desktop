import { useEffect, useState } from 'react';
import { ArrowLeft, Star, Heart } from 'lucide-react';
import { dialog, shell } from '../api';
import wechatQr from '../../assets/wechat-reward.jpg?inline';
import appCfg from '../../app.config.json';
import { DEFAULT_SYSTEM_PROMPT, type Lang, type ThemePref, type ToolPerm } from '../lib/types';
import { LANGUAGES, useI18n } from '../lib/i18n';
import { TOOL_LIST, deriveApprovalMode } from '../lib/tools';
import type { ChatController } from '../lib/useChat';

const PERMS: ToolPerm[] = ['allow', 'ask', 'off'];
const PERM_KEY: Record<ToolPerm, string> = { allow: 'permAllow', ask: 'permAsk', off: 'permOff' };

export function Settings({ controller, onClose }: { controller: ChatController; onClose: () => void }) {
  const { settings, updateSettings } = controller;
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);
  // Edit working dir as a draft; only commit a normalized path on blur/Enter/Browse
  // so per-project profile switching doesn't fire on every keystroke.
  const [dirDraft, setDirDraft] = useState(settings.workingDir);
  useEffect(() => setDirDraft(settings.workingDir), [settings.workingDir]);
  const commitDir = () => {
    const v = dirDraft.trim();
    if (v !== settings.workingDir) updateSettings({ workingDir: v });
  };

  const browseDir = async () => {
    try {
      const dir = await dialog.openFolder();
      if (dir) updateSettings({ workingDir: dir });
    } catch {
      /* ignore */
    }
  };

  const THEMES: { id: ThemePref; key: string }[] = [
    { id: 'system', key: 'themeSystem' },
    { id: 'light', key: 'themeLight' },
    { id: 'dark', key: 'themeDark' },
  ];

  const setPerm = (tool: string, perm: ToolPerm) => {
    const next = { ...(settings.toolPermissions || {}), [tool]: perm };
    // Keep the composer chip in sync: if the edited map matches a preset, adopt that mode
    // (we never surface "custom"), otherwise leave approvalMode as-is.
    const mode = deriveApprovalMode(next);
    updateSettings({ toolPermissions: next, ...(mode !== 'custom' ? { approvalMode: mode } : {}) });
  };

  const cmds = settings.customCommands || [];
  const setCmds = (next: typeof cmds) => updateSettings({ customCommands: next });
  const mcps = settings.mcpServers || [];
  const setMcps = (next: typeof mcps) => updateSettings({ mcpServers: next });

  // Codex-style settings: a left category nav; each section is its own sub-page.
  const [tab, setTab] = useState('general');
  const CATS: { id: string; key: string }[] = [
    { id: 'general', key: 'secApi' },
    { id: 'permissions', key: 'secPermissions' },
    { id: 'behavior', key: 'secBehavior' },
    { id: 'commands', key: 'secCommands' },
    { id: 'mcp', key: 'secMcp' },
    { id: 'appearance', key: 'secAppearance' },
    { id: 'about', key: 'secAbout' },
  ];

  return (
    <div className="settings">
      <nav className="settings-nav">
        <button className="settings-back" onClick={onClose}>
          <ArrowLeft size={16} strokeWidth={2} /> {t('backToApp')}
        </button>
        <div className="settings-nav-list">
          {CATS.map((c) => (
            <button
              key={c.id}
              className={`settings-nav-item ${tab === c.id ? 'active' : ''}`}
              onClick={() => setTab(c.id)}
            >
              {t(c.key)}
            </button>
          ))}
        </div>
      </nav>
      <div className="settings-pane">
        {/* API */}
        <div className="settings-section" hidden={tab !== 'general'}>
          <div className="section-title">{t('secApi')}</div>
          <div className="section-card">
            <div className="field">
              <label>{t('apiKeyLabel')}</label>
              <div className="row">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  spellCheck={false}
                  placeholder="sk-…"
                  onChange={(e) => updateSettings({ apiKey: e.target.value })}
                />
                <button className="ghost" onClick={() => setShowKey((s) => !s)}>
                  {showKey ? t('hide') : t('show')}
                </button>
              </div>
              <p className="hint">{t('apiKeyHint')}</p>
            </div>

            <div className="field">
              <label>{t('baseUrlLabel')}</label>
              <input
                type="text"
                value={settings.baseUrl}
                spellCheck={false}
                onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              />
            </div>

            <div className="field">
              <label>{t('workingDirLabel')}</label>
              <div className="row">
                <input
                  type="text"
                  value={dirDraft}
                  spellCheck={false}
                  placeholder="D:\\projects\\my-app"
                  onChange={(e) => setDirDraft(e.target.value)}
                  onBlur={commitDir}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitDir();
                  }}
                />
                <button className="ghost" onClick={browseDir}>
                  {t('browse')}
                </button>
              </div>
              <p className="hint">{t('workingDirHint')}</p>
            </div>

            <div className="field">
              <label>{t('searchEndpointLabel')}</label>
              <input
                type="text"
                value={settings.searchEndpoint}
                spellCheck={false}
                placeholder="http://localhost:8080"
                onChange={(e) => updateSettings({ searchEndpoint: e.target.value })}
              />
              <p className="hint">{t('searchEndpointHint')}</p>
            </div>
          </div>
        </div>

        {/* Tool permissions */}
        <div className="settings-section" hidden={tab !== 'permissions'}>
          <div className="section-title">{t('secPermissions')}</div>
          <div className="section-card">
            {TOOL_LIST.map((tool) => {
              const perm = settings.toolPermissions?.[tool.name] ?? tool.defaultPerm;
              return (
                <div className="switch-row" key={tool.name}>
                  <label>{t('tool_' + tool.name)}</label>
                  <div className="seg">
                    {PERMS.map((p) => (
                      <button
                        key={p}
                        className={`seg-option ${perm === p ? 'active' : ''}`}
                        onClick={() => setPerm(tool.name, p)}
                      >
                        {t(PERM_KEY[p])}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <p className="hint">{t('permsHint')}</p>
          </div>
        </div>

        {/* Behavior */}
        <div className="settings-section" hidden={tab !== 'behavior'}>
          <div className="section-title">{t('secBehavior')}</div>
          <div className="section-card">
            <div className="field">
              <div className="field-head">
                <label>{t('temperatureLabel')}</label>
                <span className="field-value">{settings.temperature.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
              />
              <p className="hint">{t('temperatureHint')}</p>
            </div>

            <div className="field">
              <div className="switch-row">
                <div className="switch-text">
                  <strong>{t('notifyLabel')}</strong>
                  <span>{t('notifyDesc')}</span>
                </div>
                <button
                  className={`switch ${settings.notifyOnDone ? 'on' : ''}`}
                  role="switch"
                  aria-checked={settings.notifyOnDone}
                  onClick={() => updateSettings({ notifyOnDone: !settings.notifyOnDone })}
                />
              </div>
            </div>

            <div className="field">
              <label>{t('systemPromptLabel')}</label>
              <textarea
                rows={6}
                value={settings.systemPrompt}
                onChange={(e) => updateSettings({ systemPrompt: e.target.value })}
              />
              <button className="ghost" onClick={() => updateSettings({ systemPrompt: DEFAULT_SYSTEM_PROMPT })}>
                {t('resetDefault')}
              </button>
            </div>

            <div className="field">
              <label>{t('globalMemoryLabel')}</label>
              <textarea
                rows={5}
                value={settings.globalMemory}
                placeholder="e.g. Always answer in Chinese. Prefer TypeScript. My name is …"
                onChange={(e) => updateSettings({ globalMemory: e.target.value })}
              />
              <p className="hint">{t('globalMemoryHint')}</p>
            </div>
          </div>
        </div>

        {/* Custom commands */}
        <div className="settings-section" hidden={tab !== 'commands'}>
          <div className="section-title">{t('secCommands')}</div>
          <div className="section-card">
            <p className="hint">{t('secCommandsDesc')}</p>
            {cmds.map((c, i) => (
              <div className="list-row" key={i}>
                <span className="list-prefix">/</span>
                <input
                  className="list-name"
                  value={c.name}
                  placeholder={t('cmdNamePh')}
                  spellCheck={false}
                  onChange={(e) =>
                    setCmds(cmds.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9-]/g, '') } : x)))
                  }
                />
                <input
                  className="list-val"
                  value={c.prompt}
                  placeholder={t('cmdPromptPh')}
                  onChange={(e) => setCmds(cmds.map((x, j) => (j === i ? { ...x, prompt: e.target.value } : x)))}
                />
                <button className="ghost list-del" onClick={() => setCmds(cmds.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </div>
            ))}
            <button className="ghost" onClick={() => setCmds([...cmds, { name: '', prompt: '' }])}>
              + {t('addCommand')}
            </button>
          </div>
        </div>

        {/* MCP servers */}
        <div className="settings-section" hidden={tab !== 'mcp'}>
          <div className="section-title">{t('secMcp')}</div>
          <div className="section-card">
            <p className="hint">{t('secMcpDesc')}</p>
            {mcps.map((m, i) => {
              const st = controller.mcpStatus.find((s) => s.name === m.name.trim());
              return (
                <div className="list-row" key={i}>
                  <input
                    className="list-name"
                    value={m.name}
                    placeholder={t('mcpNamePh')}
                    spellCheck={false}
                    onChange={(e) =>
                      setMcps(mcps.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/[^a-zA-Z0-9-]/g, '') } : x)))
                    }
                  />
                  <input
                    className="list-val"
                    value={m.url}
                    placeholder={t('mcpUrlPh')}
                    spellCheck={false}
                    onChange={(e) => setMcps(mcps.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                  />
                  <span className="mcp-state" title={st?.error || ''}>
                    {st ? (
                      <>
                        <span className={`status-dot ${st.ok ? 'ok' : 'fail'}`} />
                        {st.ok ? st.tools.length : ''}
                      </>
                    ) : (
                      ''
                    )}
                  </span>
                  <button className="ghost list-del" onClick={() => setMcps(mcps.filter((_, j) => j !== i))}>
                    ✕
                  </button>
                </div>
              );
            })}
            <button className="ghost" onClick={() => setMcps([...mcps, { name: '', url: '' }])}>
              + {t('addServer')}
            </button>
          </div>
        </div>

        {/* Appearance */}
        <div className="settings-section" hidden={tab !== 'appearance'}>
          <div className="section-title">{t('secAppearance')}</div>
          <div className="section-card">
            <div className="field">
              <div className="switch-row">
                <label>{t('languageLabel')}</label>
                <div className="seg">
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.id}
                      className={`seg-option ${settings.language === l.id ? 'active' : ''}`}
                      onClick={() => updateSettings({ language: l.id as Lang })}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="field">
              <div className="switch-row">
                <label>{t('themeLabel')}</label>
                <div className="seg">
                  {THEMES.map((th) => (
                    <button
                      key={th.id}
                      className={`seg-option ${settings.theme === th.id ? 'active' : ''}`}
                      onClick={() => updateSettings({ theme: th.id })}
                    >
                      {t(th.key)}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* About & support */}
        <div className="settings-section" hidden={tab !== 'about'}>
          <div className="section-title">{t('secAbout')}</div>
          <div className="section-card">
            <p className="hint">{t('aboutBlurb')}</p>
            <div className="about-links">
              <button className="ghost about-link" onClick={() => shell.open('https://github.com/kobolingfeng/deepseek-desktop').catch(() => {})}>
                <Star size={15} strokeWidth={1.9} /> GitHub
              </button>
              <button className="ghost about-link" onClick={() => shell.open('https://paypal.me/koboling').catch(() => {})}>
                <Heart size={15} strokeWidth={1.9} /> PayPal
              </button>
            </div>
            <div className="about-reward">
              <div className="about-reward-label">{t('aboutWechat')}</div>
              <img className="about-qr" src={wechatQr} alt={t('aboutWechat')} width={200} height={200} />
            </div>
            <p className="about-foot">v{appCfg.version} · {t('about')}</p>
          </div>
        </div>

        {tab === 'appearance' && <div className="about">{t('about')}</div>}
      </div>
    </div>
  );
}
