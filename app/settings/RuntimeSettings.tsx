'use client';

import { useEffect, useState } from 'react';
import { Alert, Button } from '@/components/ui';

type Notice = { tone: 'ok' | 'error'; text: string } | null;

export default function RuntimeSettings({ localMode }: { localMode: boolean }) {
  const [browser, setBrowser] = useState<DesktopBrowserState | null>(null);
  const [policy, setPolicy] = useState<DesktopBrowserPolicy | null>(null);
  const [updates, setUpdates] = useState<DesktopUpdateState | null>(null);
  const [updateSettings, setUpdateSettings] = useState<DesktopUpdateSettings | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    const desktop = typeof window !== 'undefined' ? window.xeoDesktop : undefined;
    setBridgeReady(Boolean(desktop));
    if (!desktop || !localMode) return;
    let alive = true;
    Promise.all([desktop.getBrowserState(), desktop.getUpdateState(), desktop.getUpdateSettings()]).then(([nextBrowser, nextUpdates, nextSettings]) => {
      if (!alive) return;
      setBrowser(nextBrowser);
      setPolicy(nextBrowser.browserPolicy);
      setUpdates(nextUpdates);
      setUpdateSettings(nextSettings);
    }).catch((error) => setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not load runtime state.' }));
    const unsubscribe = window.xeoDesktopEvents?.onUpdateStatus((state) => alive && setUpdates(state));
    return () => { alive = false; unsubscribe?.(); };
  }, [localMode]);

  async function refresh() {
    if (!window.xeoDesktop) return;
    setBusy(true); setNotice(null);
    try { setUpdates(await window.xeoDesktop.checkForUpdate()); setNotice({ tone: 'ok', text: 'Update check completed.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Update check failed.' }); }
    finally { setBusy(false); }
  }

  async function openExtensionFolder() {
    if (!window.xeoDesktop) return;
    try {
      await window.xeoDesktop.openBrowserExtension();
      setNotice({ tone: 'ok', text: 'Extension folder opened. Load it from chrome://extensions using Load unpacked.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not open extension folder.' });
    }
  }

  async function savePolicy(patch: Partial<DesktopBrowserPolicy>) {
    if (!window.xeoDesktop || !policy) return;
    try {
      const next = await window.xeoDesktop.setBrowserPolicy({ ...policy, ...patch });
      setBrowser(next); setPolicy(next.browserPolicy); setNotice({ tone: 'ok', text: 'Browser safety policy saved locally.' });
    } catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save browser policy.' }); }
  }

  async function saveUpdates(patch: Partial<DesktopUpdateSettings>) {
    if (!window.xeoDesktop || !updateSettings) return;
    try { setUpdateSettings(await window.xeoDesktop.setUpdateSettings({ ...updateSettings, ...patch })); setNotice({ tone: 'ok', text: 'Update preferences saved locally.' }); }
    catch (error) { setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not save update preferences.' }); }
  }

  const browserConnected = Boolean(browser?.connected);
  const selectedProfile = browser?.selectedProfile;

  return (
    <div className="settings-page settings-page-narrow">
      <header className="settings-page-header">
        <div><span className="codex-kicker">02 / Desktop runtime</span><h2>Runtime</h2><p>Control updates, browser setup, and the local safety boundary from one place.</p></div>
      </header>
      {notice && <div className="settings-notice"><Alert tone={notice.tone === 'error' ? 'error' : 'success'} title={notice.tone === 'error' ? 'Action needed' : 'Saved'}>{notice.text}</Alert></div>}

      <section className="settings-panel browser-setup-panel">
        <div className="settings-panel-head">
          <div><span className="codex-kicker">Browser setup</span><h3>Connect your browser to Work</h3><p>Install the local extension in the browser profile you want Xeo Forge to control. The bridge stays on your machine.</p></div>
          <span className={browserConnected ? 'settings-status-chip is-on' : 'settings-status-chip is-off'}>{browserConnected ? 'Connected' : 'Not connected'}</span>
        </div>
        <div className="browser-setup-callout">
          <div><strong>Load the Xeo Forge extension</strong><p>The extension is bundled with the Desktop app and connects only to the local bridge on <code>127.0.0.1</code>. It does not upload cookies or browsing content.</p></div>
          <Button variant="secondary" disabled={!localMode || !bridgeReady} onClick={() => void openExtensionFolder()}>Open extension folder</Button>
        </div>
        <ol className="browser-setup-steps">
          <li><span>1</span><p>Click <strong>Open extension folder</strong>, or locate <code>desktop/browser-extension</code> in the Xeo Forge project.</p></li>
          <li><span>2</span><p>Open <code>chrome://extensions</code> in Chrome or Chromium and enable <strong>Developer mode</strong>.</p></li>
          <li><span>3</span><p>Choose <strong>Load unpacked</strong> and select the <code>browser-extension</code> folder itself.</p></li>
          <li><span>4</span><p>Open the extension’s <strong>Options</strong>, paste the local token below, keep the displayed port, name the profile, and choose <strong>Save and connect</strong>.</p></li>
        </ol>
        {!localMode || !bridgeReady ? <p className="browser-setup-note">Browser setup actions are available in the Xeo Forge Desktop app. This web preview can show the instructions but cannot open a local folder or expose the bridge token.</p> : browser?.token ? <div className="browser-token-card"><div><span className="codex-kicker">Local extension token · port {browser.port}</span><code>{showToken ? browser.token : '••••••••••••••••••••••••••••••••'}</code></div><div className="settings-header-actions"><Button variant="ghost" size="sm" onClick={() => setShowToken((value) => !value)}>{showToken ? 'Hide token' : 'Reveal token'}</Button><Button variant="ghost" size="sm" onClick={() => browser.token && navigator.clipboard.writeText(browser.token)}>Copy token</Button></div></div> : <p className="browser-setup-note">Start the Desktop app to generate a local token, then paste it in the extension Options page.</p>}
      </section>

      {!localMode || !bridgeReady ? <div className="settings-info-card"><span className="settings-empty-mark">i</span><div><h3>Runtime controls are available in the Desktop app</h3><p>The browser bridge, local token, update channel, and profile selection are intentionally local-only. The web preview keeps these controls read-only.</p></div></div> : <div className="settings-stack">
        <section className="settings-panel">
          <div className="settings-panel-head"><div><span className="codex-kicker">Updates</span><h3>Release channel</h3><p>{updates?.message || 'No update check has run in this session.'}</p></div><Button size="sm" variant="secondary" loading={busy} onClick={() => void refresh()}>Check now</Button></div>
          {updateSettings && <div className="settings-inline-controls"><label>Channel<select className="settings-input" value={updateSettings.channel} onChange={(event) => void saveUpdates({ channel: event.target.value as DesktopUpdateSettings['channel'] })}><option value="latest">Stable</option><option value="beta">Preview</option></select></label><label className="settings-check"><input type="checkbox" checked={updateSettings.autoCheck} onChange={(event) => void saveUpdates({ autoCheck: event.target.checked })} /> Check automatically</label></div>}
        </section>

        <section className="settings-panel">
          <div className="settings-panel-head"><div><span className="codex-kicker">Browser boundary</span><h3>{browserConnected ? 'Browser connected' : 'No browser connected'}</h3><p>{selectedProfile?.browserName || 'Connect the extension, then select a profile for Work.'}</p></div><span className={browserConnected ? 'settings-status-chip is-on' : 'settings-status-chip is-off'}>{browserConnected ? 'Connected' : 'Optional'}</span></div>
          {policy && <div className="settings-policy-list"><label className="settings-check"><input type="checkbox" checked={policy.interactionEnabled} onChange={(event) => void savePolicy({ interactionEnabled: event.target.checked })} /> Allow browser interaction</label><label className="settings-check"><input type="checkbox" checked={policy.redactSensitiveData} onChange={(event) => void savePolicy({ redactSensitiveData: event.target.checked })} /> Redact sensitive data</label><label className="settings-check"><input type="checkbox" checked={policy.allowSensitiveActions} onChange={(event) => void savePolicy({ allowSensitiveActions: event.target.checked })} /> Allow sensitive actions</label></div>}
          {browser?.profiles?.length ? <div className="browser-profile-grid">{browser.profiles.map((profile) => { const selected = profile.browserId === browser.selectedBrowserId; return <div key={profile.browserId} className={`browser-profile-card ${selected ? 'is-selected' : ''}`}><div className="browser-profile-head"><div><strong>{profile.profileName}</strong><small>{profile.browserName} · {profile.connected ? 'connected' : 'disconnected'}</small></div><span className={profile.connected ? 'settings-status-chip is-on' : 'settings-status-chip is-off'}>{selected ? 'Selected' : profile.connected ? 'Ready' : 'Offline'}</span></div><p>{profile.tab?.title || 'No active tab reported'}</p><small>{profile.tab?.url || '—'}</small><Button variant="ghost" size="sm" disabled={!profile.connected || selected} onClick={() => window.xeoDesktop?.selectBrowser(profile.browserId).then(setBrowser).catch((error) => setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not select browser profile.' }))}>{selected ? 'Using this profile' : 'Use for Work'}</Button></div>; })}</div> : <p className="browser-setup-note">No browser profile is connected yet. Load the unpacked extension, paste the token, and create a profile in the extension Options.</p>}
        </section>
      </div>}
    </div>
  );
}
