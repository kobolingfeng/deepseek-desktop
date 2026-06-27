import { useState } from 'react';
import { dialog } from '../api';
import { DEFAULT_SYSTEM_PROMPT, type Lang, type ThemePref, type ToolPerm } from '../lib/types';
import { LANGUAGES, useI18n } from '../lib/i18n';
import { TOOL_LIST } from '../lib/tools';
import type { ChatController } from '../lib/useChat';

const PERMS: ToolPerm[] = ['allow', 'ask', 'off'];
const PERM_KEY: Record<ToolPerm, string> = { allow: 'permAllow', ask: 'permAsk', off: 'permOff' };

export function Settings({ controller, onClose }: { controller: ChatController; onClose: () => void }) {
  const { settings, updateSettings } = controller;
  const { t } = useI18n();
  const [showKey, setShowKey] = useState(false);

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

  const setPerm = (tool: string, perm: ToolPerm) =>
    updateSettings({ toolPermissions: { ...(settings.toolPermissions || {}), [tool]: perm } });

  return (
    <div className="settings">
      <div className="settings-head">
        <h2>{t('settingsTitle')}</h2>
        <button className="settings-close" onClick={onClose} title="Close">
          ✕
        </button>
      </div>

      <div className="settings-body">
        {/* API */}
        <div className="settings-section">
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
                  value={settings.workingDir}
                  spellCheck={false}
                  placeholder="D:\\projects\\my-app"
                  onChange={(e) => updateSettings({ workingDir: e.target.value })}
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
        <div className="settings-section">
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
        <div className="settings-section">
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
          </div>
        </div>

        {/* Appearance */}
        <div className="settings-section">
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

        <div className="about">{t('about')}</div>
      </div>
    </div>
  );
}
